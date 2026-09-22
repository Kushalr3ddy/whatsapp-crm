import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { requireScope } from '../auth.js';
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

  /** Lists senders with their live connection state and risk score. */
  router.get('/', requireScope('senders:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT si.id, si.label, si.provider, si.phone_e164 AS "phoneE164", si.status,
             si.risk_score AS "riskScore", si.warmup_started_at AS "warmupStartedAt",
             si.last_inbound_at AS "lastInboundAt",
             cs.connection_state AS "connectionState", cs.disconnect_reason AS "disconnectReason",
             cs.last_connected_at AS "lastConnectedAt"
      FROM sender_identity si
      LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
      WHERE si.org_id = ${req.crm!.orgId}
      ORDER BY si.created_at ASC`));
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
