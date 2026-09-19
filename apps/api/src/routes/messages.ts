import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import { normalisePhone } from '@crm/shared';

/** Body for queueing an outbound message. */
const sendMessage = z.object({
  to: z.string().min(4),
  body: z.string().min(1).max(4096),
  senderId: z.string().uuid().optional()
});

/**
 * Conversations and messages.
 *
 * `POST /messages` **queues**, it does not send. The socket lives in the gateway, and more
 * importantly every outbound message must pass the pacing and policy gates that will live in
 * the dispatcher (P6) — a route that could reach a provider directly would be a way to bypass
 * them, which is precisely the hole the previous system had (docs/00-prior-art.md, M12).
 */
export function messagesRouter(db: Database, kms: KmsDriver, defaultCountry: string): Router {
  const router = Router();

  /** Lists conversations, most recently active first. */
  router.get('/conversations', async (req: Request, res: Response) => {
    const rows = await db.execute(sql`
      SELECT v.id, v.status, v.unread_count AS "unreadCount",
             v.last_inbound_at AS "lastInboundAt", v.last_outbound_at AS "lastOutboundAt",
             c.id AS "contactId", c.display_name AS "contactName",
             -- A subquery rather than a join: a contact may hold more than one phone
             -- identity, and joining would silently duplicate the conversation row.
             -- Prefers the primary, falls back to the oldest, always yields exactly one.
             (SELECT ci.value_normalized FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.kind = 'phone'
               ORDER BY ci.is_primary DESC, ci.created_at ASC
               LIMIT 1) AS "contactPhone",
             si.label AS "senderLabel",
             (SELECT count(*)::int FROM message m WHERE m.conversation_id = v.id) AS "messageCount"
      FROM conversation v
      JOIN contact c ON c.id = v.contact_id
      JOIN sender_identity si ON si.id = v.sender_identity_id
      WHERE v.org_id = ${req.crm!.orgId}
      ORDER BY GREATEST(COALESCE(v.last_inbound_at, v.created_at),
                        COALESCE(v.last_outbound_at, v.created_at)) DESC
      LIMIT 100`);
    res.json({ data: rows });
  });

  /** Returns one thread, oldest first, with bodies decrypted for display. */
  router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
    const rows = await db.execute(sql`
      SELECT m.id, m.direction, m.content_type AS "contentType", m.status,
             m.error_code AS "errorCode", m.body_enc AS "bodyEnc", m.sent_by AS "sentBy",
             m.created_at AS "createdAt", m.sent_at AS "sentAt", m.read_at AS "readAt"
      FROM message m
      JOIN conversation v ON v.id = m.conversation_id
      WHERE v.id = ${req.params.id} AND v.org_id = ${req.crm!.orgId}
      ORDER BY m.created_at ASC
      LIMIT 500`);

    const messages = (rows as unknown as Array<{ bodyEnc: Uint8Array | null }>).map((m) => {
      const { bodyEnc, ...rest } = m;
      // Decrypt for display only. A body that cannot be decrypted is reported rather than
      // hidden — usually it means the encryption key has changed, and silently showing an
      // empty message would make that look like data loss.
      let body: string | null = null;
      let undecryptable = false;
      if (bodyEnc !== null) {
        try { body = new TextDecoder().decode(kms.decrypt(bodyEnc)); }
        catch { undecryptable = true; }
      }
      return { ...rest, body, undecryptable };
    });
    res.json({ data: messages });
  });

  /** Queues an outbound message. The gateway sends it; poll the thread for status. */
  router.post('/messages', async (req: Request, res: Response) => {
    const parsed = sendMessage.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { to, body, senderId } = parsed.data;

    // One normalisation boundary for the whole system. The previous system had this function
    // and never called it on the way in, so one person became several contacts (M8).
    const phone = normalisePhone(to, defaultCountry);
    if (!phone.ok) {
      res.status(422).json(problem(req, `PHONE_${phone.reason.toUpperCase()}`, phone.message));
      return;
    }
    if (!phone.value.reachableOnWhatsApp) {
      // Caught here rather than at send time: a doomed send costs the sender's delivery ratio,
      // which feeds its health score (docs/08-antiban.md).
      res.status(422).json(problem(req, 'NOT_REACHABLE',
        `${phone.value.e164} looks like a ${phone.value.type} number, which cannot receive WhatsApp.`));
      return;
    }

    const orgId = req.crm!.orgId;
    const rows = await db.execute(sql`
      WITH chosen_sender AS (
        SELECT id FROM sender_identity
        WHERE org_id = ${orgId}
          AND (${senderId ?? null}::uuid IS NULL OR id = ${senderId ?? null}::uuid)
          AND status IN ('active','degraded')
        ORDER BY created_at ASC LIMIT 1
      ), existing AS (
        SELECT contact_id FROM contact_identity
        WHERE org_id = ${orgId} AND kind = 'phone' AND value_normalized = ${phone.value.e164}
      ), new_contact AS (
        INSERT INTO contact (org_id, display_name, source)
        SELECT ${orgId}, ${phone.value.e164}, 'api'
        WHERE NOT EXISTS (SELECT 1 FROM existing) AND EXISTS (SELECT 1 FROM chosen_sender)
        RETURNING id
      ), new_identity AS (
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        SELECT ${orgId}, id, 'phone', ${phone.value.e164}, true FROM new_contact
        RETURNING contact_id
      ), resolved AS (
        SELECT contact_id FROM existing UNION ALL SELECT contact_id FROM new_identity
      ), conv AS (
        INSERT INTO conversation (org_id, contact_id, sender_identity_id)
        SELECT ${orgId}, r.contact_id, s.id FROM resolved r, chosen_sender s
        ON CONFLICT (contact_id, sender_identity_id) DO UPDATE SET updated_at = now()
        RETURNING id
      )
      INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                           body_enc, body_hmac, sent_by)
      SELECT ${orgId}, conv.id, 'outbound', 'queued', 'text',
             ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
             ${kms.blindIndex(body)}, 'api'
      FROM conv
      RETURNING id, conversation_id AS "conversationId", status`);

    const created = (rows as unknown as Array<{ id: string; conversationId: string; status: string }>)[0];
    if (!created) {
      // The only way the chain produces nothing is having no usable sender.
      res.status(409).json(problem(req, 'NO_ACTIVE_SENDER',
        'No linked WhatsApp number is available to send from. Link one first: POST /api/v1/senders/:id/link'));
      return;
    }

    // 202, not 201: accepted for sending, not sent. The gateway decides when it actually goes.
    res.status(202).json({ data: { ...created, to: phone.value.e164 } });
  });

  return router;
}

/** Builds an RFC 7807 problem response with a stable machine-readable code. */
function problem(req: Request, code: string, detail: string) {
  return { type: 'about:blank', title: code, status: 0, code, detail, request_id: req.id };
}
