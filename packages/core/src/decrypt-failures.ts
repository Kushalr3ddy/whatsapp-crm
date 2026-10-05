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
