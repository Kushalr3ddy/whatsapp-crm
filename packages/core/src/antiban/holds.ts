import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { Hold } from '../antiban.js';

/** The part of a database handle these lookups need; a transaction has it too. */
export type Queryable = Pick<Database, 'execute'>;

/**
 * Holds that stop one contact, looked up in one place.
 *
 * Today that is only the 463 refusal (AC-2.6). The stories that come next add their own here and nowhere else: a contact marked
 * `likely_blocked` (S4), a retry receipt not yet resolved (`decrypt_retry`, S5), a contact on the do-not-contact list for
 * campaigns and AI (S6). The lane, the policy and the campaign dispatcher all ask this function, so a hold added here applies
 * to every source at once.
 */
export async function contactHoldOf(db: Queryable, input: { readonly conversationId: string }): Promise<Hold | null> {
  const row = (await db.execute(sql`
    SELECT v.refused_463_at AS "refused463At"
    FROM conversation v
    WHERE v.id = ${input.conversationId}`) as unknown as Array<{ refused463At: string | null }>)[0];
  if (row?.refused463At !== undefined && row.refused463At !== null) return { reason: 'refused_463', until: null };
  return null;
}

/**
 * Holds that stop a whole number, looked up in one place. None yet: `many_undelivered` (S4) and `decrypt_wave` (S5) are returned from
 * here when those stories land. An unlinked number is not decided here: the lane refuses it before the policy is asked (AC-2.7).
 */
export async function numberHoldOf(_db: Queryable, _input: { readonly senderIdentityId: string }): Promise<Hold | null> {
  return null;
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
