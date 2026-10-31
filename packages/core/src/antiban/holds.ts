import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { Hold } from '../antiban.js';

/** The part of a database handle these lookups need; a transaction has it too. */
export type Queryable = Pick<Database, 'execute'>;

/**
 * Holds that stop one contact, looked up in one place: the 463 refusal (AC-2.6), a retry receipt not yet resolved (`decrypt_retry`,
 * AC-5.1) and a contact who probably blocked the number (`likely_blocked`, AC-4.3). The lane, the policy and the campaign dispatcher
 * all ask this function, so a hold added here applies to every source at once; which priorities each one stops is the policy's rule
 * (a probably-blocked contact still gets an agent's message by hand).
 *
 * A contact on the do-not-contact list is not decided here: that gate sits outside the policy and cannot be relaxed by it (AC-9.2),
 * and fails the message instead of holding it.
 */
export async function contactHoldOf(db: Queryable, input: { readonly conversationId: string }): Promise<Hold | null> {
  const row = (await db.execute(sql`
    SELECT v.refused_463_at AS "refused463At", v.decrypt_retry_at AS "decryptRetryAt", v.likely_blocked_at AS "likelyBlockedAt"
    FROM conversation v
    WHERE v.id = ${input.conversationId}`) as unknown as Array<{
      refused463At: string | null; decryptRetryAt: string | null; likelyBlockedAt: string | null }>)[0];
  if (row === undefined) return null;
  if (row.refused463At !== null) return { reason: 'refused_463', until: null };
  if (row.decryptRetryAt !== null) return { reason: 'decrypt_retry', until: null };
  if (row.likelyBlockedAt !== null) return { reason: 'likely_blocked', until: null };
  return null;
}

/**
 * Holds that stop a whole number, looked up in one place: a wave of decrypt retries (`decrypt_wave`, AC-5.4), which lasts until the
 * number is linked again, and many sends that never got their second tick (`many_undelivered`, AC-4.6), which lasts until the count
 * falls or an agent resumes. An unlinked number is not decided here: the lane refuses it before the policy is asked (AC-2.7).
 */
export async function numberHoldOf(db: Queryable, input: { readonly senderIdentityId: string }): Promise<Hold | null> {
  const row = (await db.execute(sql`
    SELECT decrypt_wave_at AS "waveAt", linked_since AS "linkedSince", many_undelivered_at AS "manyAt"
    FROM channel_session WHERE sender_identity_id = ${input.senderIdentityId}`) as unknown as Array<{
      waveAt: string | null; linkedSince: string | null; manyAt: string | null }>)[0];
  if (row === undefined) return null;
  if (decryptWaveActive(row.waveAt, row.linkedSince)) return { reason: 'decrypt_wave', until: null };
  if (row.manyAt !== null) return { reason: 'many_undelivered', until: null };
  return null;
}

/**
 * Whether a decrypt wave still holds the number: it ends when the number is linked again (a logout clears `linked_since` and the next
 * open sets it to a later time than the wave). A reconnect alone does not end it, because the session store is what is suspect.
 */
export function decryptWaveActive(waveAt: string | Date | null, linkedSince: string | Date | null): boolean {
  if (waveAt === null) return false;
  if (linkedSince === null) return true;
  return new Date(waveAt).getTime() >= new Date(linkedSince).getTime();
}

/**
 * Writes why a queued message is still waiting and when that is expected to end (AC-8.1). Returns whether it changed anything,
 * so the caller can log a hold once instead of on every sweep. Best-effort: never blocks the send path.
 */
export async function recordHold(db: Queryable, messageId: string, hold: Hold | { reason: string; until: Date | null }): Promise<boolean> {
  const until = hold.until === null ? null : hold.until.toISOString();
  try {
    const rows = await db.execute(sql`
      UPDATE message SET hold_reason = ${hold.reason}, hold_until = ${until}
      WHERE id = ${messageId}
        AND (hold_reason IS DISTINCT FROM ${hold.reason} OR hold_until IS DISTINCT FROM ${until}::timestamptz)
      RETURNING id`);
    return (rows as unknown as unknown[]).length > 0;
  } catch {
    return false;
  }
}

/** Clears a message's hold: it is next in the lane, or has gone. */
export async function clearHold(db: Queryable, messageId: string): Promise<void> {
  await db.execute(sql`UPDATE message SET hold_reason = NULL, hold_until = NULL WHERE id = ${messageId} AND hold_reason IS NOT NULL`)
    .catch(() => undefined);
}
