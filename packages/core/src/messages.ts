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
           EXISTS (SELECT 1 FROM ins) AS is_new`);

  const row = (rows as unknown as Array<{ contact_id: string; conversation_id: string; is_new: boolean }>)[0];
  if (!row) throw new Error('storing the inbound message returned nothing');
  return { contactId: row.contact_id, conversationId: row.conversation_id, isNew: row.is_new };
}

/** Marks a queued outbound message as accepted by the provider. */
export async function markMessageSent(
  db: Database, messageId: string, providerMessageId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE message SET status = 'sent', provider_message_id = ${providerMessageId}, sent_at = now()
    WHERE id = ${messageId}`);
  await db.execute(sql`
    UPDATE conversation SET last_outbound_at = now(), updated_at = now()
    WHERE id = (SELECT conversation_id FROM message WHERE id = ${messageId})`);
}

/**
 * Marks a queued outbound message as failed, recording why.
 *
 * Failure is per-message and never touches the connection. In the previous system one
 * unsendable recipient threw and took down the whole engine, so the watchdog restarted it, the
 * recruiter retried, and it died again — a permanent crash loop for one contact (M26).
 */
export async function markMessageFailed(
  db: Database, messageId: string, errorCode: string
): Promise<void> {
  await db.execute(sql`
    UPDATE message SET status = 'failed', error_code = ${errorCode.slice(0, 200)}
    WHERE id = ${messageId}`);
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
