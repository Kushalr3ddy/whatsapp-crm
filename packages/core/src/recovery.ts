/**
 * Recovery orchestration — P6 anti-ban, Layer 6 (docs/08-antiban.md).
 *
 * The health scorer (health.ts) reacts to *live* signals: it degrades and quarantines a number,
 * and lifts it back the moment the signals clear. That is the closed loop. This is the other half
 * the spec calls for and the scorer does not do — a **timed** response to a *specific incident*: a
 * WhatsApp 463 timelock, a 429 rate overlimit, or a delivery-collapse soft ban each start a fixed
 * cool-off during which the number sends **nothing**, after which it resumes at a small fraction of
 * its cap that **ramps back up weekly** until it is whole again. A hard ban (401) has no recovery —
 * the number is retired.
 *
 * Mostly pure and storage-light: the state is three columns on `sender_identity`
 * (`recovery_incident`, `recovery_started_at`, `recovery_until`), and everything else — the phase,
 * the cap fraction, when it resumes — is computed from those plus the incident's fixed schedule. So
 * the gateway reads three fields and this module decides; there is nothing to keep in sync. The one
 * writer is `beginRecovery`, kept here so the open-guard lives beside the state it governs.
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** The incident classes that start a timed recovery. A 401 hard ban is retirement, not recovery. */
export type RecoveryIncident = 'timelock_463' | 'rate_429' | 'soft_ban';

/** One incident's timed response: how long to pause, what fraction to resume at, and the weekly ramp. */
interface RecoverySchedule {
  /** Full send-hold from the incident, in hours. */
  readonly pauseHours: number;
  /** Fraction of the normal daily cap allowed the moment the pause ends (0…1). */
  readonly resumeAt: number;
  /** How much that fraction climbs each week after resuming, until it reaches 1. */
  readonly weeklyRamp: number;
}

/** The schedules from docs/08-antiban.md, Layer 6. Not configurable — a ceiling, like the rest. */
const SCHEDULES: Record<RecoveryIncident, RecoverySchedule> = {
  timelock_463: { pauseHours: 24, resumeAt: 0.1, weeklyRamp: 0.15 },
  rate_429: { pauseHours: 4, resumeAt: 0.25, weeklyRamp: 0.25 },
  soft_ban: { pauseHours: 48, resumeAt: 0.05, weeklyRamp: 0.1 }
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** True for a string that names a recovery incident — narrows the stored text column. */
export function isRecoveryIncident(value: string | null): value is RecoveryIncident {
  return value === 'timelock_463' || value === 'rate_429' || value === 'soft_ban';
}

/** The three fields a recovery is stored as. */
export interface RecoveryRow {
  readonly incident: string | null;
  /** When the pause ends and the ramp begins. */
  readonly recoveryUntil: Date | null;
}

/** What a recovery means right now: which phase, how much it may send, and when the pause lifts. */
export interface RecoveryState {
  readonly incident: RecoveryIncident | null;
  /** `none` — not recovering · `paused` — held entirely · `ramping` — sending at a reduced cap. */
  readonly phase: 'none' | 'paused' | 'ramping';
  /** Fraction of the normal daily cap allowed now: 1 when not recovering, 0 while paused. */
  readonly capFraction: number;
  /** When the pause ends (only while `paused`); null otherwise. */
  readonly resumesAt: Date | null;
}

/** The default state: nothing in recovery, full cap. */
const CLEAR: RecoveryState = { incident: null, phase: 'none', capFraction: 1, resumesAt: null };

/**
 * Works out the current recovery phase and cap fraction from the stored row.
 *
 * While the clock is before `recovery_until` the number is paused and sends nothing. After it, the
 * fraction is `resumeAt + weeklyRamp × (whole weeks since resuming)`, capped at 1 — and once it
 * reaches 1 the recovery is over, so this reports `none` and the caller can clear the columns.
 */
export function recoveryState(row: RecoveryRow, now: Date = new Date()): RecoveryState {
  if (!isRecoveryIncident(row.incident) || row.recoveryUntil === null) return CLEAR;
  const schedule = SCHEDULES[row.incident];

  if (now.getTime() < row.recoveryUntil.getTime()) {
    return { incident: row.incident, phase: 'paused', capFraction: 0, resumesAt: row.recoveryUntil };
  }

  const weeks = Math.floor((now.getTime() - row.recoveryUntil.getTime()) / WEEK_MS);
  const fraction = schedule.resumeAt + schedule.weeklyRamp * weeks;
  // A tiny epsilon so a ramp that reaches 1 in floating point (e.g. 0.1 + 6×0.15 = 0.999…) counts
  // as fully recovered rather than sending forever at 99.99% of the cap.
  if (fraction >= 1 - 1e-9) return CLEAR;                // ramped all the way back — recovery done
  return { incident: row.incident, phase: 'ramping', capFraction: fraction, resumesAt: null };
}

/** The row values that open a recovery for an incident — the pause runs `pauseHours` from now. */
export function openRecovery(
  incident: RecoveryIncident, now: Date = new Date()
): { incident: RecoveryIncident; startedAt: Date; until: Date } {
  const until = new Date(now.getTime() + SCHEDULES[incident].pauseHours * 60 * 60 * 1000);
  return { incident, startedAt: now, until };
}

/**
 * Opens a timed recovery for an incident — **unless the number is already paused**.
 *
 * Idempotent under a storm of the same signal: a second 463 arriving while the number is still
 * cooling off is a no-op (the `recovery_until IS NULL OR recovery_until < now()` guard fails), so
 * the pause is not perpetually reset and never lifts. One arriving *after* the pause has lifted
 * restarts the cool-off, which is right — fresh trouble on a still-fragile number warrants it.
 * Runs on the caller's connection (gateway or health sweep), by sender id, like the rest of P6.
 */
export async function beginRecovery(
  db: Database, senderIdentityId: string, incident: RecoveryIncident, now: Date = new Date()
): Promise<void> {
  const { startedAt, until } = openRecovery(incident, now);
  await db.execute(sql`
    UPDATE sender_identity
    SET recovery_incident = ${incident},
        recovery_started_at = ${startedAt.toISOString()},
        recovery_until = ${until.toISOString()},
        updated_at = now()
    WHERE id = ${senderIdentityId}
      AND (recovery_until IS NULL OR recovery_until < now())`);
}
