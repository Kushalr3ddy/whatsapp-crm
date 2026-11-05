import { sql } from 'drizzle-orm';
import { recordHealthEvent } from '../health-events.js';
import { RETRY_RESET_AT, RETRY_WAVE_WINDOW_MS } from './constants.js';
import { isDecryptWave } from './decrypt.js';
import type { Queryable } from './holds.js';

/** What a contact's retry request changed. */
export interface RetryOutcome {
  readonly messageId: string;
  readonly orgId: string;
  readonly conversationId: string;
  readonly contactId: string;
  /** How many times this message has been asked for again, counting this one. */
  readonly retries: number;
  /** This is the second (or later) request for the same message: the session with the contact is to be recreated (AC-5.3). */
  readonly resetSession: boolean;
  /** This request completed a wave across contacts and the number was just held (AC-5.4). */
  readonly waveStarted: boolean;
}

/**
 * A contact's phone asked for one of our messages again because it could not decrypt it (F6 S5). Counts it on the message, holds every
 * new send to that contact until it is resolved (AC-5.1), and checks whether this is a wave across contacts (AC-5.4). Returns null for a
 * message this CRM did not send from this number: that one is not ours to answer.
 *
 * The hold is the whole job here; Baileys sends the message again itself, and we never queue a second copy.
 */
export async function registerRetryRequest(
  db: Queryable, senderIdentityId: string, providerMessageId: string, at: Date
): Promise<RetryOutcome | null> {
  const iso = at.toISOString();
  const hit = (await db.execute(sql`
    UPDATE message m SET retry_requests = m.retry_requests + 1, last_retry_at = ${iso}::timestamptz
    FROM conversation v
    WHERE m.provider_message_id = ${providerMessageId} AND m.direction = 'outbound'
      AND v.id = m.conversation_id AND v.sender_identity_id = ${senderIdentityId}
    RETURNING m.id AS "messageId", m.retry_requests AS retries, v.id AS "conversationId", v.contact_id AS "contactId", v.org_id AS "orgId"`
  ) as unknown as Array<{ messageId: string; retries: number; conversationId: string; contactId: string; orgId: string }>)[0];
  if (hit === undefined) return null;

  await db.execute(sql`UPDATE conversation SET decrypt_retry_at = ${iso}::timestamptz WHERE id = ${hit.conversationId}`);

  const recent = (await db.execute(sql`
    SELECT v.contact_id AS contact, m.last_retry_at AS at
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound'
      AND m.last_retry_at > ${new Date(at.getTime() - RETRY_WAVE_WINDOW_MS).toISOString()}::timestamptz`
  ) as unknown as Array<{ contact: string; at: string }>).map((r) => ({ contact: r.contact, at: new Date(r.at) }));

  let waveStarted = false;
  if (isDecryptWave(recent, at)) {
    // Not already held: a hold lasts until the number is linked again, so a wave seen while held is the same wave.
    const set = await db.execute(sql`
      UPDATE channel_session SET decrypt_wave_at = ${iso}::timestamptz, updated_at = now()
      WHERE sender_identity_id = ${senderIdentityId}
        AND NOT (decrypt_wave_at IS NOT NULL AND (linked_since IS NULL OR decrypt_wave_at >= linked_since))
      RETURNING id`);
    if ((set as unknown as unknown[]).length > 0) {
      waveStarted = true;
      await recordHealthEvent(db, {
        orgId: hit.orgId, senderIdentityId, kind: 'decrypt_wave', severity: 'critical', at,
        summary: `Several contacts could not read our messages within ${String(RETRY_WAVE_WINDOW_MS / 60_000)} minutes. That points at this number's own `
          + 'encryption session, not at the contacts, so all sending is paused. Link the number again to start a fresh session.',
        evidence: { contacts: new Set(recent.map((r) => r.contact)).size }
      });
    }
  }
  return {
    messageId: hit.messageId, orgId: hit.orgId, conversationId: hit.conversationId, contactId: hit.contactId,
    retries: hit.retries, resetSession: hit.retries >= RETRY_RESET_AT, waveStarted
  };
}

/**
 * A delivered or read receipt for a message of ours, stamped after the retry: the contact's phone can read us again, so the hold on
 * new sends to them lifts (F6 AC-5.2). A receipt from before the retry says nothing about it. Returns whether a hold was lifted.
 */
export async function liftRetryOnReceipt(db: Queryable, providerMessageId: string, at: Date): Promise<boolean> {
  const lifted = await db.execute(sql`
    UPDATE conversation v SET decrypt_retry_at = NULL
    FROM message m
    WHERE m.provider_message_id = ${providerMessageId} AND m.direction = 'outbound' AND v.id = m.conversation_id
      AND v.decrypt_retry_at IS NOT NULL AND v.decrypt_retry_at < ${at.toISOString()}::timestamptz
    RETURNING v.id`);
  return (lifted as unknown as unknown[]).length > 0;
}

/**
 * The contact wrote to us and it decrypted: their phone can read us again (F6 AC-5.2) and they have plainly not blocked the number
 * (AC-4.3), so both marks are cleared. Returns whether either was set.
 */
export async function contactWroteAgain(db: Queryable, conversationId: string): Promise<boolean> {
  const cleared = await db.execute(sql`
    UPDATE conversation SET decrypt_retry_at = NULL, likely_blocked_at = NULL
    WHERE id = ${conversationId} AND (decrypt_retry_at IS NOT NULL OR likely_blocked_at IS NOT NULL)
    RETURNING id`);
  return (cleared as unknown as unknown[]).length > 0;
}
