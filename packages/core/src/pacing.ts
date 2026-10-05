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

/**
 * Hard daily ceiling for a number that has **never received an inbound message**. Outbound-only is
 * exactly the pattern the graph heuristics punish — a real account gets replies — so a sender that
 * only ever sends is capped here regardless of its warmup day, until it receives its first inbound
 * (docs/08-antiban.md, Layer 1). Not raisable; it only ever lowers the computed ceiling.
 */
const OUTBOUND_ONLY_DAILY_CAP = 20;

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
  /**
   * The number's local timezone (IANA, e.g. `Asia/Kolkata`) for circadian pacing. **Opt-in:**
   * null or absent leaves the gate as layers 1–2 alone, which is why every test that is not
   * about circadian pacing keeps passing without change.
   */
  readonly circadianTimezone?: string | null;
  /**
   * Layer 6 recovery scaling (docs/08-antiban.md): a fraction in (0, 1] that a recovering number's
   * daily ceiling is multiplied by while it ramps back up. Absent or 1 means no recovery scaling.
   * Like `dailyCapOverride` it can only *lower* the ceiling, so it cannot be abused to send faster.
   */
  readonly recoveryCapFraction?: number;
  /**
   * When this sender last received an inbound message, or `null` when it never has. **`null` caps
   * the daily ceiling hard** (outbound-only is a top ban pattern — Layer 1). `undefined` means the
   * caller did not evaluate it, so the cap is skipped — which keeps every pre-existing caller, and
   * the whole test suite, behaving exactly as before.
   */
  readonly lastInboundAt?: Date | null;
}

/** Whether a send may proceed, and if not, why and for how long. */
export type PacingDecision =
  | { readonly allowed: true; readonly delayMs: number }
  | {
      readonly allowed: false;
      /** Machine-readable, so the caller can log and the dispatcher can branch. */
      readonly reason: 'per_minute' | 'per_hour' | 'per_day' | 'warmup' | 'circadian';
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
  let base = (limits.warmupStartedAt === null || dormant)
    ? Math.min(steady, WARMUP_RAMP[0]!)
    : warmupCeiling(steady, limits.warmupStartedAt, now);

  // Outbound-only clamp: a number that has never received an inbound is held at the hard cap
  // regardless of warmup day, until its first reply arrives (docs/08-antiban.md, Layer 1).
  if (limits.lastInboundAt === null) base = Math.min(base, OUTBOUND_ONLY_DAILY_CAP);

  return applyRecovery(base, limits.recoveryCapFraction);
}

/** The warmup ceiling for a number that started warming at `startedAt`. The override may lower it. */
function warmupCeiling(steady: number, startedAt: Date, now: Date): number {
  const days = Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000);
  if (days >= WARMUP_RAMP.length) return steady;
  return Math.min(steady, WARMUP_RAMP[Math.max(0, days)]!);
}

/**
 * Scales a computed ceiling by the Layer 6 recovery fraction when one is in force.
 *
 * Only ever lowers (the fraction is ≤ 1), and never to zero while ramping: a recovering number is
 * meant to send a *little*, and the full hold is the pause phase, enforced separately by the
 * dispatcher — not by starving the ceiling here.
 */
function applyRecovery(ceiling: number, fraction: number | undefined): number {
  if (fraction === undefined || fraction >= 1) return ceiling;
  return Math.max(1, Math.floor(ceiling * fraction));
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

/*
 * Circadian pacing — P6 anti-ban, the daily-rhythm layer (docs/08-antiban.md).
 *
 * Layers 1–2 cap how *much* a number sends; this shapes *when*. A real person messages through
 * the day and sleeps at night, so a number sending at a steady rate around the clock — busy at
 * 3 a.m. — is one of the clearest "this is a bot" signals WhatsApp reads. So the cadence follows
 * a daily curve: full speed through the day, tapering in the evening, effectively silent
 * overnight, ramping back up in the morning. The transitions are raised-cosine, never steps,
 * because a hard on/off at a round hour is itself a fingerprint.
 *
 * Opt-in: it applies only when `PacingLimits.circadianTimezone` is set.
 */

/** Below this activity a number is treated as "asleep": sends are deferred to the morning. */
export const CIRCADIAN_QUIET_THRESHOLD = 0.15;

/** Never stretch a pause past this, however slow the hour — an hours-long gap helps nobody. */
const CIRCADIAN_MAX_DELAY_MS = 15_000;

/** Floor on the activity used to stretch a delay, so a shoulder-of-the-day pause stays sane. */
const CIRCADIAN_DELAY_FLOOR = 0.2;

/**
 * How "awake" a number should be at a given local hour, 0 (asleep) … 1 (full daytime).
 *
 * The schedule from docs/08-antiban.md: full speed 09:00–22:00, tapering to nothing 22:00→02:00,
 * dead 02:00–06:00, ramping back 06:00→09:00. Taper and ramp are raised-cosine so there is no
 * detectable step at any boundary. `hour` is a float in [0, 24), e.g. 14.5 for 14:30.
 */
export function circadianActivity(hour: number): number {
  const h = ((hour % 24) + 24) % 24;              // normalise into [0, 24)
  if (h >= 9 && h < 22) return 1;                 // daytime plateau
  if (h >= 2 && h < 6) return 0;                  // dead of night
  if (h >= 6 && h < 9) {                          // morning ramp, 0 → 1
    const t = (h - 6) / 3;
    return 0.5 * (1 - Math.cos(Math.PI * t));
  }
  // Evening taper 22:00 → 02:00 (wraps midnight), 1 → 0.
  const wrapped = h < 2 ? h + 24 : h;             // 22 … 26
  const t = (wrapped - 22) / 4;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * The local hour, as a float (e.g. 22.75 for 22:45), at `now` in an IANA timezone.
 *
 * Uses the platform `Intl` timezone database rather than a dependency or a fixed UTC offset, so
 * daylight saving and every zone are the runtime's problem, not ours. (India has no DST, but the
 * mechanism must not assume that.)
 */
export function localHour(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Some engines render midnight as '24'; fold it back to 0.
  return (hh % 24) + mm / 60;
}

/**
 * Stretches a base inter-send pause as the day winds down, so the shoulders of the day (early
 * morning, late evening) send more slowly than midday without a second rate track. At full
 * daytime activity the pause is unchanged; as activity falls the gap grows, capped so it never
 * becomes an unbounded wait.
 */
export function circadianDelayMs(baseMs: number, activity: number): number {
  const scaled = baseMs / Math.max(activity, CIRCADIAN_DELAY_FLOOR);
  return Math.round(Math.min(CIRCADIAN_MAX_DELAY_MS, scaled));
}

/**
 * Milliseconds until this number is "awake" again, when a send is deferred overnight.
 *
 * Scans forward in 10-minute steps rather than inverting the cosine — cheap, exact enough for a
 * retry hint (the gate treats it as a floor, never a promise), and correct across the midnight
 * wrap and any timezone.
 */
function circadianRetryMs(now: Date, timezone: string): number {
  const step = 10 * 60 * 1000;
  for (let ms = step; ms <= 24 * 60 * 60 * 1000; ms += step) {
    const at = localHour(new Date(now.getTime() + ms), timezone);
    if (circadianActivity(at) >= CIRCADIAN_QUIET_THRESHOLD) return ms;
  }
  return 60 * 60 * 1000;                           // unreachable given the schedule; never 0
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

  // Circadian pacing is the last gate: only once a send is within every ceiling does the time of
  // day get a say. Overnight it defers the send to the morning; through the day it stretches the
  // jittered pause so the shoulders of the day are slower than midday. Opt-in — off when no
  // timezone is set, which is how layers 1–2 behave unchanged for every non-circadian caller.
  const delayMs = humanDelayMs();
  if (limits.circadianTimezone) {
    const activity = circadianActivity(localHour(now, limits.circadianTimezone));
    if (activity < CIRCADIAN_QUIET_THRESHOLD) {
      return {
        allowed: false, reason: 'circadian',
        detail: `outside sending hours: circadian activity ${activity.toFixed(2)} `
          + `(${limits.circadianTimezone})`,
        retryAfterMs: circadianRetryMs(now, limits.circadianTimezone)
      };
    }
    return { allowed: true, delayMs: circadianDelayMs(delayMs, activity) };
  }

  return { allowed: true, delayMs };
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
