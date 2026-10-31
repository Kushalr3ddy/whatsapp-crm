import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { writeAudit, AUDIT, decodeLinkError, numberHints } from '@crm/core';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/** Body for creating a sender identity. */
const createSender = z.object({
  label: z.string().min(1).max(100),
  provider: z.enum(['baileys', 'meta']).default('baileys'),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional()
});

/** Body for starting the linking handshake. */
const startLink = z.object({
  mode: z.enum(['qr', 'pairing_code']).default('qr'),
  /** Required for pairing-code mode: the number being linked types the code on its phone. */
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional()
});

/**
 * Sender identities — the numbers this install sends from.
 *
 * Linking is asynchronous by necessity: the socket lives in the gateway process, so this
 * records the request and the gateway writes the QR or pairing code back onto the same row.
 * Callers start a link, then poll for the challenge.
 */
export function sendersRouter(): Router {
  const router = Router();

  /** Lists senders with their live connection state. */
  router.get('/', requireScope('senders:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT si.id, si.label, si.provider, si.phone_e164 AS "phoneE164", si.status,
             cs.connection_state AS "connectionState", cs.disconnect_reason AS "disconnectReason",
             cs.last_connected_at AS "lastConnectedAt",
             cs.link_error AS "linkErrorRaw",
             -- What WhatsApp last said about this number's limits (F6 S2).
             cs.timelock_active AS "timelockActive", cs.timelock_until AS "timelockUntil", cs.timelock_type AS "timelockType",
             cs.capping_status AS "cappingStatus", cs.capping_total_quota AS "cappingTotalQuota",
             cs.capping_used_quota AS "cappingUsedQuota", cs.capping_cycle_end AS "cappingCycleEnd",
             cs.linked_since AS "linkedSince",
             -- Whether credentials are stored: the truth of "is this number linked", independent
             -- of the live socket. A corrupt session can be connected but this is the one that
             -- says there is something to unlink, and drives the button state in the UI.
             EXISTS (SELECT 1 FROM channel_auth_state a WHERE a.sender_identity_id = si.id) AS linked
      FROM sender_identity si
      LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
      WHERE si.org_id = ${req.crm!.orgId} AND si.status <> 'removed'
      ORDER BY si.created_at ASC`));

    const data = (rows as unknown as Array<Record<string, unknown> & { linkErrorRaw: string | null }>)
      .map(({ linkErrorRaw, ...sender }) => ({
        ...sender,
        // Advice only, never blocking (F6 AC-7.6): a number linked in the last 7 days, a timelock that wants the phone used too.
        hints: numberHints({
          linkedSince: typeof sender.linkedSince === 'string' ? new Date(sender.linkedSince) : null,
          timelockType: typeof sender.timelockType === 'string' ? sender.timelockType : null,
          now: new Date()
        }),
        // The last link failure, in plain words, so the Numbers page can say why a number is not up.
        linkError: decodeLinkError(linkErrorRaw)
      }));
    res.json({ data });
  });

  /**
   * The timeline for one number: refused connections, sessions ended unasked, devices removed on the phone, newest
   * first. This is how an operator reads *what happened and when*.
   */
  router.get('/:id/health-events', requireUuidParam('id'), requireScope('senders:read'),
    async (req: Request, res: Response) => {
      const rows = await req.tenant!((tx) => tx.execute(sql`
        SELECT id, at, kind, severity, summary, evidence
        FROM sender_health_event
        WHERE sender_identity_id = ${String(req.params.id)} AND org_id = ${req.crm!.orgId}
        ORDER BY at DESC LIMIT 30`));
      res.json({ data: rows });
    });

  /** Creates a sender. It exists but is not connected until it has been linked. */
  router.post('/', requireScope('senders:write'), async (req: Request, res: Response) => {
    const parsed = createSender.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { label, provider, phoneE164 } = parsed.data;
    const rows = await req.tenant!((tx) => tx.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
      VALUES (${req.crm!.orgId}, ${provider}, ${label}, ${phoneE164 ?? null}, 'linking')
      RETURNING id, label, provider, phone_e164 AS "phoneE164", status`));
    res.status(201).json({ data: (rows as unknown as unknown[])[0] });
  });

  /**
   * Starts linking. Returns 202 rather than the challenge itself, because the gateway has to
   * reach WhatsApp first — poll `GET /senders/:id/link` for the QR or code.
   */
  router.post('/:id/link', requireUuidParam('id'), requireScope('senders:write'), async (req: Request, res: Response) => {
    const parsed = startLink.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { mode, phoneE164 } = parsed.data;
    if (mode === 'pairing_code' && phoneE164 === undefined) {
      res.status(422).json(problem(req, 422, 'PHONE_REQUIRED',
        'pairing_code mode needs phoneE164 — the number being linked types the code on its phone'));
      return;
    }

    const owned = await req.tenant!((tx) => tx.execute(sql`
      SELECT id FROM sender_identity WHERE id = ${req.params.id} AND org_id = ${req.crm!.orgId}`));
    if ((owned as unknown as unknown[]).length === 0) {
      // 404 rather than 403: confirming a resource exists in another tenant is itself a leak.
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such sender.'));
      return;
    }

    // Upsert the session row and clear any previous challenge. The trigger on
    // link_requested_at notifies the gateway, which writes the challenge back here.
    const rows = await req.tenant!((tx) => tx.execute(sql`
      INSERT INTO channel_session (sender_identity_id, link_requested_mode, link_requested_phone,
                                   link_requested_at, link_challenge, link_error, connection_state)
      VALUES (${req.params.id}, ${mode}, ${phoneE164 ?? null}, now(), NULL, NULL, 'connecting')
      ON CONFLICT (sender_identity_id) DO UPDATE
        SET link_requested_mode = ${mode}, link_requested_phone = ${phoneE164 ?? null},
            link_requested_at = now(), link_challenge = NULL, link_error = NULL,
            connection_state = 'connecting', updated_at = now()
      RETURNING id`));

    res.status(202).json({
      data: {
        sessionId: (rows as unknown as Array<{ id: string }>)[0]!.id,
        mode,
        poll: `/api/v1/senders/${req.params.id}/link`
      }
    });
  });

  /**
   * Unlinks a number so it can be linked again.
   *
   * Asynchronous like linking: the socket and the credentials live in the gateway process, so
   * this records the request and the gateway logs out and clears the stored credentials. That
   * clearing is the point — a corrupt or logged-out session stays "linked" (it can still send)
   * and a re-link cannot issue a fresh QR while the old credentials remain.
   */
  router.post('/:id/unlink', requireUuidParam('id'), requireScope('senders:write'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const senderId = String(req.params.id);
    const updated = await req.tenant!((tx) => tx.execute(sql`
      UPDATE channel_session SET unlink_requested_at = now(), updated_at = now()
      WHERE sender_identity_id = (
        SELECT id FROM sender_identity WHERE id = ${senderId} AND org_id = ${orgId}
      )
      RETURNING id`));

    if ((updated as unknown as unknown[]).length === 0) {
      // Either no such sender in this org, or it was never linked (no channel_session row) so
      // there is nothing to unlink. 404 either way — and it does not confirm another tenant's.
      res.status(404).json(problem(req, 404, 'NOT_FOUND',
        'No such sender, or it has never been linked.'));
      return;
    }
    res.status(202).json({ data: { senderId, status: 'unlink_requested' } });
  });

  /**
   * Removes a number from the Numbers page (admin only, audited). It is *hidden*, not deleted: its
   * row is marked `removed`, so its conversations and message history stay reachable in the inbox.
   * A number that still has stored credentials must be unlinked first, so this can never cut a live
   * session's credentials.
   */
  router.post('/:id/remove', requireUuidParam('id'), requireRole('admin'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);
      const outcome = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT si.label, si.status,
                 EXISTS (SELECT 1 FROM channel_auth_state a WHERE a.sender_identity_id = si.id) AS linked
          FROM sender_identity si WHERE si.id = ${id} AND si.org_id = ${orgId}`);
        const row = (rows as unknown as Array<{ label: string; status: string; linked: boolean }>)[0];
        if (row === undefined || row.status === 'removed') return 'missing' as const;
        if (row.linked) return 'linked' as const;
        await tx.execute(sql`
          UPDATE sender_identity SET status = 'removed', updated_at = now()
          WHERE id = ${id} AND org_id = ${orgId}`);
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.senderRemoved, targetType: 'sender_identity',
          targetId: id, before: { label: row.label, status: row.status },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return 'ok' as const;
      });
      if (outcome === 'missing') {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such sender.'));
        return;
      }
      if (outcome === 'linked') {
        res.status(409).json(problem(req, 409, 'SENDER_LINKED',
          'This number is still linked. Unlink it first, then remove it.'));
        return;
      }
      res.status(204).end();
    });

  /** Returns the challenge once the gateway has it, or reports that it is still pending. */
  router.get('/:id/link', requireUuidParam('id'), requireScope('senders:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT cs.link_challenge AS challenge, cs.link_error AS error,
             cs.qr_expires_at AS "expiresAt", cs.connection_state AS "connectionState",
             si.status
      FROM sender_identity si
      LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
      WHERE si.id = ${req.params.id} AND si.org_id = ${req.crm!.orgId}`));
    const row = (rows as unknown as Array<{
      challenge: unknown; error: string | null; expiresAt: string | null;
      connectionState: string | null; status: string;
    }>)[0];

    if (!row) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such sender.'));
      return;
    }
    // A failed attempt is a normal answer to "how is the link going", with the reason spelled out.
    const failure = decodeLinkError(row.error);
    res.json({
      data: {
        state: failure !== null ? 'error' : row.challenge !== null ? 'challenge_ready' : 'pending',
        error: failure,
        challenge: row.challenge,
        expiresAt: row.expiresAt,
        connectionState: row.connectionState,
        senderStatus: row.status
      }
    });
  });

  return router;
}
