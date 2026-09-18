import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { ChannelProvider } from '@crm/channels';
import { markMessageFailed, markMessageSent } from '@crm/core';
import type { Logger } from '@crm/shared';

/** A queued outbound message, joined to everything needed to actually send it. */
interface QueuedSend {
  readonly messageId: string;
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly senderPhone: string | null;
  readonly recipientValue: string;
  readonly recipientKind: string;
  readonly bodyEnc: Uint8Array | null;
}

/** A pending request from the API to link a number. */
interface PendingLink {
  readonly sessionId: string;
  readonly senderIdentityId: string;
  readonly mode: 'qr' | 'pairing_code';
  readonly phone: string | null;
}

/** Everything the work handlers need. Passed in, never imported, so they stay testable. */
export interface WorkContext {
  readonly db: Database;
  readonly provider: ChannelProvider;
  readonly logger: Logger;
  /** Decrypts a stored message body back to text for sending. */
  readonly decrypt: (cipher: Uint8Array) => string;
}

/**
 * Starts the linking handshake the API asked for, and writes the challenge back.
 *
 * The API cannot call the provider itself — the socket lives in this process — so the request
 * is left on `channel_session` and the QR or pairing code is returned through the same row.
 */
export async function handleLinkRequest(ctx: WorkContext, sessionId: string): Promise<void> {
  const rows = await ctx.db.execute(sql`
    SELECT cs.id            AS "sessionId",
           cs.sender_identity_id AS "senderIdentityId",
           cs.link_requested_mode AS mode,
           cs.link_requested_phone AS phone
    FROM channel_session cs
    WHERE cs.id = ${sessionId}
      AND cs.link_requested_at IS NOT NULL
      AND cs.link_challenge IS NULL`);
  const req = (rows as unknown as PendingLink[])[0];
  if (!req) return;                     // already handled, or superseded

  try {
    const challenge = await ctx.provider.link(
      req.senderIdentityId, req.mode, req.phone ?? undefined
    );
    await ctx.db.execute(sql`
      UPDATE channel_session
      SET link_challenge = ${JSON.stringify(challenge)}::jsonb,
          qr_expires_at = ${challenge.expiresAt.toISOString()},
          link_error = NULL,
          connection_state = 'connecting',
          updated_at = now()
      WHERE id = ${req.sessionId}`);
    ctx.logger.info({ senderId: req.senderIdentityId, mode: req.mode }, 'link challenge issued');
  } catch (error) {
    // Surface the failure on the row so the API can tell the caller, rather than leaving them
    // polling an endpoint that never resolves.
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db.execute(sql`
      UPDATE channel_session SET link_error = ${message.slice(0, 500)}, updated_at = now()
      WHERE id = ${req.sessionId}`);
    ctx.logger.error({ senderId: req.senderIdentityId, err: message }, 'link request failed');
  }
}

/**
 * Sends one queued message.
 *
 * Every failure is recorded against that message and nothing else. In the previous system one
 * unsendable recipient threw and took down the whole engine, so the watchdog restarted it, the
 * operator retried, and it died again — a permanent crash loop for a single contact
 * (docs/00-prior-art.md, M26).
 *
 * There is no retry here yet, deliberately. Retrying into WhatsApp is exactly how a number gets
 * banned, so it belongs in the dispatcher with the rest of the pacing (P6) rather than in a
 * loop that has no idea how fast it is going.
 */
export async function handleSend(ctx: WorkContext, messageId: string): Promise<void> {
  const rows = await ctx.db.execute(sql`
    SELECT m.id AS "messageId", m.org_id AS "orgId", m.body_enc AS "bodyEnc",
           si.id AS "senderIdentityId", si.phone_e164 AS "senderPhone",
           ci.value_normalized AS "recipientValue", ci.kind AS "recipientKind"
    FROM message m
    JOIN conversation v   ON v.id = m.conversation_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
    JOIN contact_identity ci ON ci.contact_id = v.contact_id
                            AND ci.kind IN ('phone','wa_jid','wa_lid')
    WHERE m.id = ${messageId} AND m.direction = 'outbound' AND m.status = 'queued'
    ORDER BY CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END,
             ci.is_primary DESC
    LIMIT 1`);
  const job = (rows as unknown as QueuedSend[])[0];
  if (!job) return;                     // already sent, cancelled, or has no reachable identity

  if (job.bodyEnc === null) {
    await markMessageFailed(ctx.db, messageId, 'empty_body');
    return;
  }

  try {
    const health = await ctx.provider.health(job.senderIdentityId);
    if (health.state !== 'open') {
      // Leave it queued rather than failing it: the boot sweep will pick it up once the
      // sender reconnects. A send is not wrong just because the socket is briefly down.
      ctx.logger.warn(
        { messageId, senderId: job.senderIdentityId, state: health.state },
        'sender not connected — leaving message queued'
      );
      return;
    }

    const result = await ctx.provider.send(
      { id: job.senderIdentityId, phoneE164: job.senderPhone ?? '' },
      job.recipientKind === 'phone'
        ? { phoneE164: job.recipientValue }
        : { phoneE164: '', providerAddress: job.recipientValue },
      { kind: 'freeform', body: ctx.decrypt(job.bodyEnc) }
    );
    await markMessageSent(ctx.db, messageId, result.providerMessageId);
    ctx.logger.info({ messageId, providerMessageId: result.providerMessageId }, 'message sent');
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    await markMessageFailed(ctx.db, messageId, code);
    ctx.logger.error({ messageId, err: code }, 'send failed');
  }
}

/**
 * Picks up work left behind while this process was down.
 *
 * The reason the command channel is a durable table and not only a NOTIFY: a notification sent
 * while the gateway was stopped is gone forever, but a queued row is still there.
 */
export async function sweepPendingWork(ctx: WorkContext): Promise<{ links: number; sends: number }> {
  const linkRows = await ctx.db.execute(sql`
    SELECT id FROM channel_session
    WHERE link_requested_at IS NOT NULL AND link_challenge IS NULL
      AND link_requested_at > now() - interval '10 minutes'`);
  const links = (linkRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const id of links) await handleLinkRequest(ctx, id);

  const sendRows = await ctx.db.execute(sql`
    SELECT id FROM message
    WHERE direction = 'outbound' AND status = 'queued'
    ORDER BY created_at ASC LIMIT 200`);
  const sends = (sendRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const id of sends) await handleSend(ctx, id);

  return { links: links.length, sends: sends.length };
}

/**
 * Reconnects every number that was linked before this process restarted.
 *
 * Credentials live in Postgres precisely so this is possible without anyone scanning a QR
 * again — the previous system needed every session reconnected by hand after each restart
 * (M29/M30).
 */
export async function restoreSessions(ctx: WorkContext): Promise<number> {
  const rows = await ctx.db.execute(sql`
    SELECT si.id, si.phone_e164 AS phone FROM sender_identity si
    WHERE si.provider = 'baileys' AND si.status IN ('active','degraded')`);
  const senders = rows as unknown as Array<{ id: string; phone: string | null }>;

  let restored = 0;
  for (const s of senders) {
    try {
      await ctx.provider.connect({ id: s.id, phoneE164: s.phone ?? '' });
      restored += 1;
      ctx.logger.info({ senderId: s.id }, 'session restored from stored credentials');
    } catch (error) {
      // One number failing to reconnect must not stop the others.
      ctx.logger.warn(
        { senderId: s.id, err: error instanceof Error ? error.message : String(error) },
        'could not restore session'
      );
    }
  }
  return restored;
}
