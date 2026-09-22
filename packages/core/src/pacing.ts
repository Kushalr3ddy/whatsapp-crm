import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/**
 * Send pacing — the first gate between a queued message and WhatsApp.
 *
 * This is P6 Layers 1 and 2 (`docs/08-antiban.md`). Until it existed there was **nothing**
 * between a loop and a permanent ban: Baileys is unofficial, a banned number is gone with no
 * appeal, and the number is the asset. Everything here is a ceiling, never a target.
 *
 * Two properties are deliberate:
 *
 * **Counts come from the `message` table, not from memory.** A token bucket in a process
 * resets on every restart and counts separately per replica — and `tsx watch` restarts the
 * gateway on every file save, which would hand a developer an unlimited sender. The database
 * already records exactly what was sent and when, so it is the only source that cannot lie.
 * The spec's cache-driver buckets (M13) are an optimisation for later, not a prerequisite.
 *
 * **The warmup ceiling cannot be raised.** `daily_cap_override` may only lower a limit. An
 * override that could raise it would be used the first time someone was in a hurry, which is
 * precisely when the ceiling matters.
 */

/**
 * Maximum sends per day during warmup, from `warmup_started_at`. Exponential at 1.8×/day, as
 * specced. Day 8 onwards is the steady-state cap.
 */
const WARMUP_RAMP = [20, 36, 65, 117, 210, 378, 680] as const;

/** Re-enter warmup after this long with nothing sent — a dormant number that wakes up sending. */
const DORMANT_MS = 72 * 60 * 60 * 1000;

/** Per-hour ceiling. Specced at 200; no config knob, because it sits between two that exist. */
const PER_HOUR = 200;

/** Inter-send delay bounds. A fixed interval is a perfect fingerprint (M10). */
const DELAY_MIN_MS = 1500;
const DELAY_MAX_MS = 4000;

/** The ceilings a sender is subject to right now. */
export interface PacingLimits {
  readonly perMinute: number;
  readonly perDay: number;
  /** Lowers the daily ceiling only. Null when the sender has no override. */
  readonly dailyCapOverride: number | null;
  /** When this sender started warming up. Null means it has never been through warmup. */
  readonly warmupStartedAt: Date | null;
}

/** Whether a send may proceed, and if not, why and for how long. */
export type PacingDecision =
  | { readonly allowed: true; readonly delayMs: number }
  | {
      readonly allowed: false;
      /** Machine-readable, so the caller can log and the dispatcher can branch. */
      readonly reason: 'per_minute' | 'per_hour' | 'per_day' | 'warmup';
      readonly detail: string;
      /** Roughly when it is worth trying again. Never a promise, always a floor. */
      readonly retryAfterMs: number;
    };

/**
 * How many sends this number is allowed today.
 *
 * Warmup is keyed off the first send rather than the link, because a number that was linked a
 * month ago and has sent nothing is not warm — it is exactly as suspicious as a new one.
 */
export function dailyCeiling(limits: PacingLimits, lastSentAt: Date | null, now: Date): number {
  const steady = limits.dailyCapOverride === null
    ? limits.perDay
    : Math.min(limits.perDay, limits.dailyCapOverride);

  // Never warmed up, or dormant long enough to start again.
  const dormant = lastSentAt !== null && now.getTime() - lastSentAt.getTime() > DORMANT_MS;
  if (limits.warmupStartedAt === null || dormant) return Math.min(steady, WARMUP_RAMP[0]!);

  const days = Math.floor((now.getTime() - limits.warmupStartedAt.getTime()) / 86_400_000);
  if (days >= WARMUP_RAMP.length) return steady;
  // Still ramping. The override may lower this too, but nothing may raise it.
  return Math.min(steady, WARMUP_RAMP[Math.max(0, days)]!);
}

/**
 * A human-ish pause before the next send.
 *
 * Gaussian rather than uniform, because uniform random is itself a detectable signature — real
 * people cluster around a typical pause with occasional outliers. Box–Muller, clamped to the
 * specced 1.5–4 s window.
 */
export function humanDelayMs(random: () => number = Math.random): number {
  const mid = (DELAY_MIN_MS + DELAY_MAX_MS) / 2;
  // Three sigma across the half-range, so clamping is rare rather than the common case.
  const sigma = (DELAY_MAX_MS - DELAY_MIN_MS) / 6;

  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  return Math.round(Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS, mid + gauss * sigma)));
}

/** What the sender has actually sent recently, straight from the message table. */
interface SendCounts {
  readonly lastMinute: number;
  readonly lastHour: number;
  readonly today: number;
  readonly lastSentAt: Date | null;
}

/**
 * Decides whether this sender may send right now.
 *
 * Returns a delay to wait *before* sending when allowed — the caller is expected to honour it,
 * which is what turns a per-minute ceiling into an actually human-looking cadence rather than
 * eight messages in one second followed by 59 seconds of silence.
 */
export async function checkSendAllowance(
  db: Database, senderIdentityId: string, limits: PacingLimits, now: Date = new Date()
): Promise<PacingDecision> {
  const counts = await recentSends(db, senderIdentityId, now);
  const ceiling = dailyCeiling(limits, counts.lastSentAt, now);

  if (counts.today >= ceiling) {
    const warming = limits.warmupStartedAt === null || ceiling < limits.perDay;
    return {
      allowed: false,
      reason: warming ? 'warmup' : 'per_day',
      detail: warming
        ? `sender is in warmup: ${String(counts.today)} of ${String(ceiling)} sends used today`
        : `daily cap reached: ${String(counts.today)} of ${String(ceiling)}`,
      // Midnight is not the right answer either, but it is honest: the window is a rolling
      // day, so the earliest a slot frees up is 24h after the oldest send in it.
      retryAfterMs: 60 * 60 * 1000
    };
  }
  if (counts.lastHour >= PER_HOUR) {
    return {
      allowed: false, reason: 'per_hour',
      detail: `hourly cap reached: ${String(counts.lastHour)} of ${String(PER_HOUR)}`,
      retryAfterMs: 5 * 60 * 1000
    };
  }
  if (counts.lastMinute >= limits.perMinute) {
    return {
      allowed: false, reason: 'per_minute',
      detail: `per-minute cap reached: ${String(counts.lastMinute)} of ${String(limits.perMinute)}`,
      retryAfterMs: 60 * 1000
    };
  }

  return { allowed: true, delayMs: humanDelayMs() };
}

/**
 * Counts what this sender has sent in the last minute, hour and day.
 *
 * One query rather than three, and it counts messages that **left** — `sent_at` rather than
 * `created_at` — because a thousand messages queued at once are not a thousand sends, and
 * pacing a queue by when it was filled would defeat the point.
 */
async function recentSends(
  db: Database, senderIdentityId: string, now: Date
): Promise<SendCounts> {
  const at = now.toISOString();
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE m.sent_at > ${at}::timestamptz - interval '1 minute')::int AS "lastMinute",
      count(*) FILTER (WHERE m.sent_at > ${at}::timestamptz - interval '1 hour')::int   AS "lastHour",
      count(*) FILTER (WHERE m.sent_at > ${at}::timestamptz - interval '1 day')::int    AS "today",
      max(m.sent_at) AS "lastSentAt"
    FROM message m
    JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${senderIdentityId}
      AND m.direction = 'outbound'
      AND m.sent_at IS NOT NULL`);

  const row = (rows as unknown as Array<{
    lastMinute: number; lastHour: number; today: number; lastSentAt: string | null;
  }>)[0];
  return {
    lastMinute: row?.lastMinute ?? 0,
    lastHour: row?.lastHour ?? 0,
    today: row?.today ?? 0,
    lastSentAt: row?.lastSentAt === null || row?.lastSentAt === undefined
      ? null : new Date(row.lastSentAt)
  };
}
