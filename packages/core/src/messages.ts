import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';

/** One inbound message, already normalised by whichever channel adapter received it. */
export interface InboundMessage {
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly providerMessageId: string;
  /** E.164 phone number, or null for a privacy address that carries no number. */
  readonly fromPhoneE164: string | null;
  readonly fromProviderAddress: string;
  readonly body: string;
  readonly contentType: string;
  readonly receivedAt: Date;
}

/** What storing an inbound message produced, so a caller can report or react. */
export interface StoredInbound {
  readonly contactId: string;
  readonly conversationId: string;
  /** False when this exact message had already been stored — a redelivery, not new traffic. */
  readonly isNew: boolean;
  /**
   * The row just written, or null for a redelivery that inserted nothing.
   *
   * Needed to attach an attachment afterwards, and null is the right answer on a redelivery:
   * the file is already stored against the original, and downloading it again would cost a
   * round trip to WhatsApp to arrive at a duplicate.
   */
  readonly messageId: string | null;
}

/**
 * Stores an inbound message, creating the contact and conversation if they are new.
 *
 * Runs as one statement so two messages arriving at the same instant cannot produce two
 * contacts or two conversations for the same person. The previous system did this as a
 * sequence of reads and writes and needed an in-process lock to paper over the race, which
 * stopped working the moment there was more than one process (docs/00-prior-art.md, M13).
 */
export async function storeInboundMessage(
  db: Database, kms: KmsDriver, msg: InboundMessage
): Promise<StoredInbound> {
  // A privacy address ("@lid") carries no phone number. It is not a lesser contact — it is
  // simply a different way of reaching the same person, so it becomes its own identity kind.
  const hasPhone = msg.fromPhoneE164 !== null && msg.fromPhoneE164 !== '';
  // Drizzle's `sql` tag cannot bind a Date through `db.execute` on the postgres.js driver —
  // it throws "the string argument must be of type string ... received an instance of Date".
  // Send an ISO-8601 string and let Postgres cast it.
  const receivedAt = msg.receivedAt.toISOString();
  const kind = hasPhone ? 'phone' : 'wa_lid';
  const value = hasPhone ? msg.fromPhoneE164! : msg.fromProviderAddress;

  const rows = await db.execute(sql`
    WITH existing AS (
      SELECT contact_id FROM contact_identity
      WHERE org_id = ${msg.orgId} AND kind = ${kind} AND value_normalized = ${value}
    ), new_contact AS (
      INSERT INTO contact (org_id, display_name, source, last_inbound_at)
      SELECT ${msg.orgId}, ${value}, 'inbound_message', ${receivedAt}
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    ), new_identity AS (
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary, verified_at)
      SELECT ${msg.orgId}, id, ${kind}, ${value}, true, ${receivedAt} FROM new_contact
      RETURNING contact_id
    ), resolved AS (
      SELECT contact_id FROM existing
      UNION ALL SELECT contact_id FROM new_identity
    ), touched AS (
      UPDATE contact SET last_inbound_at = ${receivedAt}, updated_at = now()
      WHERE id = (SELECT contact_id FROM resolved) RETURNING id
    ), conv AS (
      INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at, unread_count)
      SELECT ${msg.orgId}, contact_id, ${msg.senderIdentityId}, ${receivedAt}, 1 FROM resolved
      ON CONFLICT (contact_id, sender_identity_id) DO UPDATE
        SET last_inbound_at = ${receivedAt},
            unread_count = conversation.unread_count + 1,
            status = CASE WHEN conversation.status = 'closed' THEN 'open' ELSE conversation.status END,
            updated_at = now()
      RETURNING id
    ), ins AS (
      INSERT INTO message (org_id, conversation_id, direction, provider_message_id,
                           content_type, body_enc, body_hmac, status, sent_by, created_at)
      SELECT ${msg.orgId}, conv.id, 'inbound', ${msg.providerMessageId}, ${msg.contentType},
             ${Buffer.from(kms.encrypt(new TextEncoder().encode(msg.body)))},
             ${kms.blindIndex(msg.body)}, 'delivered', 'system', ${receivedAt}
      FROM conv
      -- WhatsApp redelivers notifications for up to seven days. This makes a duplicate a
      -- no-op in the database rather than in application code, where it could race.
      ON CONFLICT (org_id, provider_message_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT contact_id FROM resolved) AS contact_id,
           (SELECT id FROM conv) AS conversation_id,
           (SELECT id FROM ins) AS message_id,
           EXISTS (SELECT 1 FROM ins) AS is_new`);

  const row = (rows as unknown as Array<{
    contact_id: string; conversation_id: string; message_id: string | null; is_new: boolean;
  }>)[0];
  if (!row) throw new Error('storing the inbound message returned nothing');
  return {
    contactId: row.contact_id, conversationId: row.conversation_id,
    isNew: row.is_new, messageId: row.message_id
  };
}

/** A message the owner typed on their own phone (or another linked device) to a contact, as WhatsApp reported it (D-94). */
export interface OwnMessage {
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly providerMessageId: string;
  /** The OTHER person in the chat: E.164, or null for a privacy address that carries no number. */
  readonly toPhoneE164: string | null;
  readonly toProviderAddress: string;
  readonly body: string;
  readonly contentType: string;
  /** When the owner sent it, by WhatsApp's clock: the thread shows this time, not the time the CRM learned of it. */
  readonly sentAt: Date;
}

/**
 * Stores a message the owner sent from their own phone, so a thread shows both halves of the conversation (D-94).
 *
 * It is an ordinary outbound message (`sent_by = 'phone'`) at WhatsApp's own time. It deliberately does **not** count as unread, does not
 * touch `last_inbound_at`, reopens nothing, and never wakes the AI assistant (the caller does not offer it to one). A person the CRM has
 * never heard of becomes a contact, exactly as an inbound message would create one. Idempotent on the provider's message id: a redelivery,
 * or a message the CRM itself sent, inserts nothing and reports `isNew: false`.
 */
export async function storeOwnMessage(
  db: Database, kms: KmsDriver, msg: OwnMessage
): Promise<StoredInbound> {
  const hasPhone = msg.toPhoneE164 !== null && msg.toPhoneE164 !== '';
  const sentAt = msg.sentAt.toISOString();
  const kind = hasPhone ? 'phone' : 'wa_lid';
  const value = hasPhone ? msg.toPhoneE164! : msg.toProviderAddress;

  const rows = await db.execute(sql`
    WITH already AS (
      SELECT 1 FROM message WHERE org_id = ${msg.orgId} AND provider_message_id = ${msg.providerMessageId}
    ), existing AS (
      SELECT contact_id FROM contact_identity
      WHERE org_id = ${msg.orgId} AND kind = ${kind} AND value_normalized = ${value}
    ), new_contact AS (
      INSERT INTO contact (org_id, display_name, source)
      SELECT ${msg.orgId}, ${value}, 'phone_message'
      WHERE NOT EXISTS (SELECT 1 FROM already) AND NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    ), new_identity AS (
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary, verified_at)
      SELECT ${msg.orgId}, id, ${kind}, ${value}, true, ${sentAt} FROM new_contact
      RETURNING contact_id
    ), resolved AS (
      SELECT contact_id FROM existing
      UNION ALL SELECT contact_id FROM new_identity
    ), conv AS (
      INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_outbound_at, unread_count)
      SELECT ${msg.orgId}, contact_id, ${msg.senderIdentityId}, ${sentAt}, 0 FROM resolved
      WHERE NOT EXISTS (SELECT 1 FROM already)
      ON CONFLICT (contact_id, sender_identity_id) DO UPDATE
        SET last_outbound_at = greatest(coalesce(conversation.last_outbound_at, ${sentAt}::timestamptz), ${sentAt}::timestamptz),
            updated_at = now()
      RETURNING id
    ), ins AS (
      INSERT INTO message (org_id, conversation_id, direction, provider_message_id,
                           content_type, body_enc, body_hmac, status, sent_by, created_at, sent_at)
      SELECT ${msg.orgId}, conv.id, 'outbound', ${msg.providerMessageId}, ${msg.contentType},
             ${Buffer.from(kms.encrypt(new TextEncoder().encode(msg.body)))},
             ${kms.blindIndex(msg.body)}, 'sent', 'phone', ${sentAt}, ${sentAt}
      FROM conv
      ON CONFLICT (org_id, provider_message_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT contact_id FROM resolved) AS contact_id,
           (SELECT id FROM conv) AS conversation_id,
           (SELECT id FROM ins) AS message_id,
           EXISTS (SELECT 1 FROM ins) AS is_new`);

  const row = (rows as unknown as Array<{
    contact_id: string | null; conversation_id: string | null; message_id: string | null; is_new: boolean;
  }>)[0];
  if (!row) throw new Error('storing the owner\'s own message returned nothing');
  return {
    contactId: row.contact_id ?? '', conversationId: row.conversation_id ?? '',
    isNew: row.is_new, messageId: row.message_id
  };
}

/** Marks a queued outbound message as accepted by the provider. */
export async function markMessageSent(
  db: Database, messageId: string, providerMessageId: string, at: Date = new Date()
): Promise<void> {
  // The send time comes from the caller's clock, not the database's, so the gap to the next send is measured on one clock.
  await db.execute(sql`
    UPDATE message SET status = 'sent', provider_message_id = ${providerMessageId}, sent_at = ${at.toISOString()},
        hold_reason = NULL, hold_until = NULL
    WHERE id = ${messageId}`);
  await db.execute(sql`
    UPDATE conversation SET last_outbound_at = ${at.toISOString()}, updated_at = now()
    WHERE id = (SELECT conversation_id FROM message WHERE id = ${messageId})`);
}

/** How long a send may stay in flight before it is treated as lost track of. Long enough for a slow media upload. */
export const UNCONFIRMED_AFTER_MS = 10 * 60_000;

/**
 * Messages handed to WhatsApp whose send was never recorded: the process died, or the database went, in between. WhatsApp may well
 * have delivered them, so they are not sent again; they are marked failed as `send_unconfirmed`, which tells a person to look at the
 * chat on the phone before sending anything more. Returns how many were marked.
 */
export async function markUnconfirmedSends(db: Database, now: Date = new Date(), afterMs = UNCONFIRMED_AFTER_MS): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE message SET status = 'failed', error_code = 'send_unconfirmed',
        error_detail = 'Handed to WhatsApp, but the send was never confirmed. It may have arrived: check the chat on the phone before sending it again.',
        hold_reason = NULL, hold_until = NULL
    WHERE direction = 'outbound' AND status = 'queued' AND send_started_at IS NOT NULL
      AND send_started_at < ${new Date(now.getTime() - afterMs).toISOString()}
    RETURNING id`);
  return (rows as unknown as unknown[]).length;
}

/**
 * Marks a queued outbound message as failed, recording why (F6 AC-1.9). `detail` is the provider's own words, kept apart from the
 * code so the code stays a short fixed list a screen can match on. A failed message is never retried automatically.
 *
 * Failure is per-message and never touches the connection. In the previous system one
 * unsendable recipient threw and took down the whole engine, so the watchdog restarted it, the
 * recruiter retried, and it died again — a permanent crash loop for one contact (M26).
 */
export async function markMessageFailed(
  db: Database, messageId: string, errorCode: string, detail?: string
): Promise<void> {
  await db.execute(sql`
    UPDATE message SET status = 'failed', error_code = ${errorCode.slice(0, 200)},
        error_detail = ${detail === undefined ? null : detail.slice(0, 500)}, hold_reason = NULL, hold_until = NULL
    WHERE id = ${messageId}`);
}

/**
 * Marks a message failed from a provider-side delivery error (matched on the provider's id).
 * Only a message that has not already been delivered or read is touched: a late error must not
 * undo a success.
 */
export async function markMessageFailedByProviderId(
  db: Database, orgId: string, providerMessageId: string, errorCode: string
): Promise<void> {
  await db.execute(sql`
    UPDATE message SET status = 'failed', error_code = ${errorCode.slice(0, 200)}
    WHERE org_id = ${orgId} AND provider_message_id = ${providerMessageId}
      AND direction = 'outbound' AND status IN ('queued', 'sent')`);
}

/** Applies a delivery receipt, matched on the provider's own message id. */
export async function applyDeliveryStatus(
  db: Database, orgId: string, providerMessageId: string, status: 'sent' | 'delivered' | 'read'
): Promise<void> {
  // Never move a message backwards: a late 'sent' receipt must not undo a 'read'.
  const rank = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 0 };
  await db.execute(sql`
    UPDATE message SET
      status = ${status},
      delivered_at = CASE WHEN ${status} IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      read_at = CASE WHEN ${status} = 'read' THEN COALESCE(read_at, now()) ELSE read_at END
    WHERE org_id = ${orgId} AND provider_message_id = ${providerMessageId}
      AND CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                      WHEN 'read' THEN 3 ELSE 0 END < ${rank[status]}`);
}

/**
 * The text of a message we sent, by WhatsApp's own id, for when a recipient's phone could not decrypt it and asks us to send it again.
 *
 * Baileys needs the original message to re-encrypt it; without it the request fails ("message not available") and their phone shows
 * "Waiting for this message" for ever. Only text we sent from this number can be given back: media, anything we received, and another
 * number's messages return `undefined`, as does a body that no longer decrypts (a retired key).
 */
export async function sentMessageText(
  db: Database, kms: KmsDriver, senderIdentityId: string, providerMessageId: string
): Promise<string | undefined> {
  const rows = await db.execute(sql`
    SELECT m.body_enc AS "bodyEnc"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${senderIdentityId} AND m.provider_message_id = ${providerMessageId}
      AND m.direction = 'outbound' AND m.content_type = 'text' AND m.body_enc IS NOT NULL
    LIMIT 1`) as unknown as Array<{ bodyEnc: Uint8Array }>;
  const body = rows[0]?.bodyEnc;
  if (body === undefined) return undefined;
  try { return new TextDecoder().decode(kms.decrypt(body)); } catch { return undefined; }
}

/**
 * An agent opened a chat: ask the gateway to tell WhatsApp its inbound messages were read (F6 AC-1.7). The API cannot call the
 * provider, so the request is left on the messages and the gateway is woken; if it is down, its next sweep finds them. Messages are
 * never marked read when they arrive, only through this or the reply path in the send lane.
 */
export async function requestRead(
  db: Pick<Database, 'execute'>, orgId: string, conversationId: string
): Promise<void> {
  const asked = await db.execute(sql`
    UPDATE message SET read_requested_at = now()
    WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'inbound'
      AND read_requested_at IS NULL AND read_marked_at IS NULL
    RETURNING id`);
  if ((asked as unknown as unknown[]).length === 0) return;
  await db.execute(sql`SELECT pg_notify('gateway', json_build_object('kind', 'read', 'id', ${conversationId}::text)::text)`);
}
