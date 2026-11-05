import {
  GAP_MAX_MS, GAP_MIN_MS, TYPING_MAX_MS, TYPING_MIN_MS, TYPING_MS_PER_CHAR, RUN_BREAK_MS
} from './constants.js';

/**
 * A gap between two sends from one number, uniform between {@link GAP_MIN_MS} and {@link GAP_MAX_MS} (AC-1.3), in whole
 * milliseconds. Drawn once for a message and stored, so the schedule is known in advance (AC-3.1).
 */
export function drawGapMs(random: () => number = Math.random): number {
  return GAP_MIN_MS + Math.floor(random() * (GAP_MAX_MS - GAP_MIN_MS + 1));
}

/** How long "typing…" is shown before a message of this many characters: `clamp(chars × 60 ms, 2 s, 25 s)` (AC-1.4). */
export function typingMs(chars: number): number {
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, Math.round(chars * TYPING_MS_PER_CHAR)));
}

/**
 * How long a send takes from the moment the lane is free: the gap and the typing run together, so the wait is the longer of
 * the two (AC-1.4). The first message of a run has no gap, only its typing.
 */
export function laneWaitMs(gapMs: number, chars: number): number {
  return Math.max(gapMs, typingMs(chars));
}

/** Whether a send now starts a new run: nothing has been sent for {@link RUN_BREAK_MS} or more (or ever). */
export function startsRun(lastSentAt: Date | null, now: Date): boolean {
  return lastSentAt === null || now.getTime() - lastSentAt.getTime() >= RUN_BREAK_MS;
}

/** A small deterministic random source from a string, so the same recipient always draws the same wording (AC-7.2). */
export function seededRandom(seed: string): () => number {
  // FNV-1a over the seed, then mulberry32. Not for secrets: only for a stable pick.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
