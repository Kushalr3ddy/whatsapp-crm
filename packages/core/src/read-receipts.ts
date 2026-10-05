import { createHash } from 'node:crypto';

/**
 * Read behaviour — P6 anti-ban Layer 3 (docs/08-antiban.md).
 *
 * A person reads a message some minutes after it arrives, not the instant it lands, and not at
 * 4 a.m. An account that blue-ticks every inbound immediately, at any hour, is a documented bot
 * tell. So the gateway marks an inbound message read only after a per-message delay of 10–60
 * minutes, and only while the number is in its active hours. This module is the pure part: how
 * long to wait, and whether a given message is due.
 */
export const READ_DELAY_MIN_MS = 10 * 60_000;

/** Upper end of the read delay. */
export const READ_DELAY_MAX_MS = 60 * 60_000;

/** An inbound message older than this is never marked read — it would be a backlog dump. */
export const READ_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * The delay before a given message is marked read, 10–60 minutes, derived from the message id.
 * Deterministic rather than random-per-call so a restart cannot reshuffle it (the sweep re-asks
 * every minute), yet it varies from message to message like a person's attention would.
 */
export function readDelayMs(messageId: string): number {
  const digest = createHash('sha256').update(messageId).digest();
  const unit = digest.readUInt32BE(0) / 0xffffffff;          // 0..1, stable per id
  return Math.round(READ_DELAY_MIN_MS + unit * (READ_DELAY_MAX_MS - READ_DELAY_MIN_MS));
}

/**
 * Whether an inbound message should be marked read now: its personal delay has passed, it is not
 * a stale backlog item, and the number is in active hours (`activity` is the circadian level in
 * [0, 1], or null when circadian pacing is off, which never blocks).
 */
export function readIsDue(
  messageId: string, receivedAt: Date, now: Date, activity: number | null
): boolean {
  const age = now.getTime() - receivedAt.getTime();
  if (age > READ_MAX_AGE_MS) return false;
  if (age < readDelayMs(messageId)) return false;
  return activity === null || activity >= 0.5;
}
