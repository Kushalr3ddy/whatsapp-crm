/**
 * Background entropy — P6 anti-ban Layer 3 (docs/08-antiban.md).
 *
 * A real account has idle-time noise: someone starts typing and changes their mind, the app is
 * opened and closed. A number that only ever does something when a send is queued is machine-
 * shaped. So every 2–6 hours, per connected number, in active hours, the gateway emits a short
 * "typing…" that is abandoned and a brief available→unavailable presence blip. This module is the
 * pure scheduling and sizing; the gateway owns the presence calls.
 */
export const ENTROPY_MIN_INTERVAL_MS = 2 * 60 * 60_000;

/** Longest gap between two noise events for one number. */
export const ENTROPY_MAX_INTERVAL_MS = 6 * 60 * 60_000;

/** A random source in [0, 1). Injectable so tests are deterministic. */
export type Rng = () => number;

/** The shape of one noise event: how long the abandoned typing lasts and how long "online" does. */
export interface EntropyPlan {
  /** The abandoned "typing…" bubble, 3–8 s. */
  readonly typingMs: number;
  /** How long the number shows as available before going away again, 30–120 s. */
  readonly presenceMs: number;
}

/** Draws one event's sizes. */
export function entropyPlan(rng: Rng = Math.random): EntropyPlan {
  return {
    typingMs: Math.round(3_000 + rng() * 5_000),
    presenceMs: Math.round(30_000 + rng() * 90_000)
  };
}

/** Draws the wait until the next event, 2–6 hours. */
export function nextEntropyDelayMs(rng: Rng = Math.random): number {
  return Math.round(ENTROPY_MIN_INTERVAL_MS + rng() * (ENTROPY_MAX_INTERVAL_MS - ENTROPY_MIN_INTERVAL_MS));
}

/**
 * Decides, per sender, when noise is due. The first sighting of a sender schedules its first event
 * a random 2–6 h out (so a restart never fires a burst of events across every number at once), and
 * each firing reschedules. In memory on purpose: losing it on a restart just re-randomises a gap
 * that was already random.
 */
export class EntropyScheduler {
  readonly #next = new Map<string, number>();

  /** True when `senderId` is due now; schedules its following event as a side effect. */
  due(senderId: string, now: Date, rng: Rng = Math.random): boolean {
    const t = now.getTime();
    const at = this.#next.get(senderId);
    if (at === undefined) {
      this.#next.set(senderId, t + nextEntropyDelayMs(rng));
      return false;
    }
    if (t < at) return false;
    this.#next.set(senderId, t + nextEntropyDelayMs(rng));
    return true;
  }
}
