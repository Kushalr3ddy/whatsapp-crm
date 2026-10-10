import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { recoveryState, writeAudit, AUDIT } from '@crm/core';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/** Body for creating a sender identity. */
const createSender = z.object({
  label: z.string().min(1).max(100),
  provider: z.enum(['baileys', 'meta']).default('baileys'),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional()
});

/**
 * Body for switching a number between enforcing the anti-ban engine and advisory mode (D-29).
 * A reason is mandatory when going advisory — it is read back out of the audit log later.
 */
const setEnforcement = z.object({
  mode: z.enum(['enforce', 'advisory']),
  reason: z.string().trim().min(10).max(500).optional()
}).refine((v) => v.mode === 'enforce' || v.reason !== undefined, {
  message: 'a reason of at least 10 characters is required to enter advisory mode', path: ['reason']
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

  /** Lists senders with their live connection state and risk score. */
  router.get('/', requireScope('senders:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT si.id, si.label, si.provider, si.phone_e164 AS "phoneE164", si.status,
             si.risk_score AS "riskScore", si.warmup_started_at AS "warmupStartedAt",
             si.last_inbound_at AS "lastInboundAt",
             -- Advisory mode (D-29): enforcement state plus what the engine would have held.
             si.enforcement, si.advisory_reason AS "advisoryReason",
             si.advisory_set_at AS "advisorySetAt",
             si.advisory_bypass_count AS "advisoryBypassCount",
             si.advisory_last_bypass AS "advisoryLastBypass",
             -- Silent-restriction verdict (docs/27-restriction-tracking.md).
             si.restriction_state AS "restrictionState", si.restriction_since AS "restrictionSince",
             -- Layer 6 recovery state, turned into a phase/fraction below for the health panel.
             si.recovery_incident AS "recoveryIncident", si.recovery_until AS "recoveryUntil",
             -- The health scorer's evidence (band, delivery ratio, counts), for the health panel.
             si.health AS health,
             cs.connection_state AS "connectionState", cs.disconnect_reason AS "disconnectReason",
             cs.last_connected_at AS "lastConnectedAt",
             -- Whether credentials are stored: the truth of "is this number linked", independent
             -- of the live socket. A corrupt session can be connected but this is the one that
             -- says there is something to unlink, and drives the button state in the UI.
             EXISTS (SELECT 1 FROM channel_auth_state a WHERE a.sender_identity_id = si.id) AS linked,
             -- Relationship breakdown for the health panel: contacts who have replied vs. those
             -- we have only messaged. A healthy number has replies; outbound-only is the risky shape.
             (SELECT count(*)::int FROM conversation v
                WHERE v.sender_identity_id = si.id
                  AND EXISTS (SELECT 1 FROM message m
                              WHERE m.conversation_id = v.id AND m.direction = 'inbound')
             ) AS "knownContacts",
             (SELECT count(*)::int FROM conversation v
                WHERE v.sender_identity_id = si.id
                  AND NOT EXISTS (SELECT 1 FROM message m
                                  WHERE m.conversation_id = v.id AND m.direction = 'inbound')
                  AND EXISTS (SELECT 1 FROM message m
                              WHERE m.conversation_id = v.id AND m.direction = 'outbound'
                                AND m.sent_at IS NOT NULL)
             ) AS "contactedContacts"
      FROM sender_identity si
      LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
      WHERE si.org_id = ${req.crm!.orgId}
      ORDER BY si.created_at ASC`));

    // Turn the two raw recovery columns into the derived phase/fraction the UI shows, so the client
    // never re-implements the Layer 6 schedule. The raw columns are dropped from the response.
    const data = (rows as unknown as Array<Record<string, unknown> & {
      recoveryIncident: string | null; recoveryUntil: string | null;
    }>).map(({ recoveryIncident, recoveryUntil, ...sender }) => {
      const state = recoveryState({
        incident: recoveryIncident,
        recoveryUntil: recoveryUntil === null ? null : new Date(recoveryUntil)
      });
      return {
        ...sender,
        recovery: state.phase === 'none' ? null : {
          incident: state.incident, phase: state.phase,
          capFraction: state.capFraction,
          resumesAt: state.resumesAt === null ? null : state.resumesAt.toISOString()
        }
      };
    });
    res.json({ data });
  });

  /**
   * Switches a number between `enforce` (the default) and `advisory` (D-29): the engine keeps
   * computing every signal, but the number-protecting holds are recorded instead of obeyed.
   * Admin-only, needs a reason, audited. Do-not-contact and consent are never relaxed. Returning
   * to `enforce` clears the reason and the bypass counters.
   */
  router.post('/:id/enforcement', requireUuidParam('id'), requireRole('admin'),
    async (req: Request, res: Response) => {
      const parsed = setEnforcement.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 
          parsed.error.issues.map((i) => i.message).join('; ')));
        return;
      }
      const { mode, reason } = parsed.data;
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);
      const done = await req.tenant!(async (tx) => {
        const before = (await tx.execute(sql`
          SELECT enforcement FROM sender_identity WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`
        ) as unknown as Array<{ enforcement: string }>)[0];
        if (!before) return false;
        await tx.execute(sql`
          UPDATE sender_identity SET
            enforcement = ${mode},
            advisory_reason = ${mode === 'advisory' ? reason! : null},
            advisory_set_by = ${mode === 'advisory' ? req.crm!.userId ?? null : null},
            advisory_set_at = ${mode === 'advisory' ? sql`now()` : null},
            advisory_bypass_count = 0, advisory_last_bypass = NULL, updated_at = now()
          WHERE id = ${id} AND org_id = ${orgId}`);
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.senderEnforcementChanged,
          targetType: 'sender_identity', targetId: id,
          before: { enforcement: before.enforcement },
          after: { enforcement: mode, ...(reason !== undefined ? { reason } : {}) },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return true;
      });
      if (!done) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such sender.'));
        return;
      }
      res.json({ data: { senderId: id, enforcement: mode } });
    });

  /**
   * The timeline for one number: restrictions suspected or cleared, possible hard bans, newest
   * first. This is how an operator reads *what happened and when*, rather than only today's score.
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
    if (row.error !== null) {
      res.status(502).json(problem(req, 502, 'LINK_FAILED', row.error));
      return;
    }
    res.json({
      data: {
        state: row.challenge !== null ? 'challenge_ready' : 'pending',
        challenge: row.challenge,
        expiresAt: row.expiresAt,
        connectionState: row.connectionState,
        senderStatus: row.status
      }
    });
  });

  return router;
}
