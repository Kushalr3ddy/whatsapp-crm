import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/**
 * Decrypt-failure signal — P6 anti-ban Layer 5 (docs/08-antiban.md).
 *
 * A burst of "Bad MAC" frames means the companion session has diverged from its peer: sends still
 * work but inbound is silently dropped (D-14), and WhatsApp tends to penalise that state. Three
 * failures inside a minute is the spec's trip-wire. The window is deliberately in memory — it is a
 * 60-second burst detector, so losing it on a restart costs at most one minute of evidence; what
 * must outlive a restart is the *result*, which `markDecryptBurst` writes to the database.
 */
export const DECRYPT_BURST_COUNT = 3;

/** The sliding window, in ms, in which `DECRYPT_BURST_COUNT` failures make a burst. */
export const DECRYPT_BURST_WINDOW_MS = 60_000;

/** How long a recorded burst keeps counting against a sender's risk score before it lapses. */
export const DECRYPT_BURST_LIVE_MS = 15 * 60_000;

/** Sliding-window counter per sender: reports when the burst threshold is crossed. */
export class DecryptFailureTracker {
  readonly #seen = new Map<string, number[]>();

  /**
   * Records one failure and returns true when this one completes a burst. The window is cleared
   * on a trip, so one burst is reported once rather than on every further failure.
   */
  record(senderId: string, at: Date): boolean {
    const t = at.getTime();
    const recent = (this.#seen.get(senderId) ?? []).filter((x) => t - x < DECRYPT_BURST_WINDOW_MS);
    recent.push(t);
    if (recent.length >= DECRYPT_BURST_COUNT) {
      this.#seen.delete(senderId);
      return true;
    }
    this.#seen.set(senderId, recent);
    return false;
  }
}

/** True while a recorded burst is recent enough to count as a live risk signal. */
export function decryptBurstIsLive(burstAt: Date | null, now: Date): boolean {
  return burstAt !== null && now.getTime() - burstAt.getTime() < DECRYPT_BURST_LIVE_MS;
}

/** Writes a burst onto the sender's session row, for the next health sweep to score. */
export async function markDecryptBurst(db: Database, senderId: string, at: Date): Promise<void> {
  await db.execute(sql`
    UPDATE channel_session SET decrypt_burst_at = ${at.toISOString()}::timestamptz, updated_at = now()
    WHERE sender_identity_id = ${senderId}`);
}

/**
 * Writes a burst of undecryptable messages from this account's OWN other devices (the owner's phone or WhatsApp Web) onto the session
 * row. Kept apart from `markDecryptBurst` on purpose: it is not evidence that WhatsApp is penalising the number, so the health scorer
 * ignores it; it is shown to the owner because those messages never reach the inbox (D-102) and relinking the number fixes it.
 */
export async function markOwnDecryptBurst(db: Database, senderId: string, at: Date): Promise<void> {
  await db.execute(sql`
    UPDATE channel_session SET own_decrypt_burst_at = ${at.toISOString()}::timestamptz, updated_at = now()
    WHERE sender_identity_id = ${senderId}`);
}

/**
 * Notes that a recipient's phone asked us to send one of our messages again because it could not decrypt it (it shows "Waiting for
 * this message"). `providerMessageId` is WhatsApp's id for the message. Returns true when a message of this sender was found.
 * The thread reads `retry_requests` to say the other phone could not read the message yet (D-101).
 */
export async function recordRetryRequest(db: Database, senderId: string, providerMessageId: string, at: Date): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE message m SET retry_requests = m.retry_requests + 1, last_retry_at = ${at.toISOString()}::timestamptz
    FROM conversation v
    WHERE m.provider_message_id = ${providerMessageId} AND m.direction = 'outbound'
      AND v.id = m.conversation_id AND v.sender_identity_id = ${senderId}
    RETURNING m.id`);
  return (rows as unknown as unknown[]).length > 0;
}
