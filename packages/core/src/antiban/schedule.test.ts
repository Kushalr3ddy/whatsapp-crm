import { describe, expect, it } from 'vitest';
import type { NumberState } from '../antiban.js';
import { GAP_MAX_MS, GAP_MIN_MS, TYPING_MAX_MS, TYPING_MIN_MS } from './constants.js';
import { computeEta, type EtaItem } from './eta.js';
import { drawGapMs, laneWaitMs, seededRandom, startsRun, typingMs } from './gap.js';

const NOW = new Date('2026-11-02T09:00:00.000Z');          // 14:30 in Asia/Kolkata
const OPEN: NumberState = {
  timelock: { active: false, until: null, type: null },
  capping: { status: null, remaining: null, cycleEnd: null }, hold: null, brakeOn: false
};
const QUIET = { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Kolkata' };

describe('AC-1.3 the gap is uniform between 1 and 50 seconds', () => {
  it('AC-1.3 draws whole milliseconds from 1 s to 50 s, both ends reachable', () => {
    expect(drawGapMs(() => 0)).toBe(GAP_MIN_MS);
    expect(drawGapMs(() => 0.9999999999)).toBe(GAP_MAX_MS);
    for (let i = 0; i < 2000; i++) {
      const g = drawGapMs();
      expect(Number.isInteger(g)).toBe(true);
      expect(g).toBeGreaterThanOrEqual(1_000);
      expect(g).toBeLessThanOrEqual(50_000);
    }
  });

  it('AC-1.3 is spread evenly: the mean is near 25.5 s and each fifth of the range gets about a fifth of the draws', () => {
    const rng = seededRandom('spread');
    const buckets = [0, 0, 0, 0, 0];
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const g = drawGapMs(rng);
      sum += g;
      buckets[Math.min(4, Math.floor((g - GAP_MIN_MS) / ((GAP_MAX_MS - GAP_MIN_MS + 1) / 5)))]! += 1;
    }
    expect(sum / n).toBeGreaterThan(25_000);
    expect(sum / n).toBeLessThan(26_000);
    for (const b of buckets) expect(Math.abs(b / n - 0.2)).toBeLessThan(0.02);
  });

  it('AC-1.3 a run ends after a silence of 90 s or more', () => {
    expect(startsRun(null, NOW)).toBe(true);
    expect(startsRun(new Date(NOW.getTime() - 89_999), NOW)).toBe(false);
    expect(startsRun(new Date(NOW.getTime() - 90_000), NOW)).toBe(true);
  });
});

describe('AC-1.4 typing', () => {
  it('AC-1.4 shows typing for chars x 60 ms, no less than 2 s and no more than 25 s', () => {
    expect(typingMs(0)).toBe(TYPING_MIN_MS);
    expect(typingMs(10)).toBe(2_000);
    expect(typingMs(100)).toBe(6_000);
    expect(typingMs(1000)).toBe(TYPING_MAX_MS);
  });

  it('AC-1.4 typing happens inside the wait, so the wait is the longer of the gap and the typing, never their sum', () => {
    expect(laneWaitMs(30_000, 100)).toBe(30_000);
    expect(laneWaitMs(1_000, 100)).toBe(6_000);
    expect(laneWaitMs(0, 100)).toBe(6_000);
  });
});

describe('AC-7.2 variants are a seeded draw', () => {
  it('AC-7.2 the same seed always gives the same draw, and different seeds differ', () => {
    const a = seededRandom('campaign:contact-1');
    const b = seededRandom('campaign:contact-1');
    const c = seededRandom('campaign:contact-2');
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([c(), c(), c()]);
  });
});

/** An item with a short text, so typing is the 2 s floor. */
const item = (gapMs: number, extra: Partial<EtaItem> = {}): EtaItem => ({ gapMs, chars: 2, newChat: false, campaign: true, ...extra });

describe('S3 the ETA is arithmetic on stored gaps', () => {
  it('AC-3.4 500 recipients, no holds: the ETA is the sum of the stored gaps, plus typing where it is longer, to the second', () => {
    const rng = seededRandom('five hundred');
    const items: EtaItem[] = Array.from({ length: 500 }, (_, i) => item(drawGapMs(rng), { chars: i % 7 === 0 ? 400 : 2 }));
    // The first message has no gap, only its typing; every later one waits the longer of its gap and its typing.
    let expectedMs = typingMs(items[0]!.chars);
    for (const it of items.slice(1)) expectedMs += Math.max(it.gapMs, typingMs(it.chars));
    const eta = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number: OPEN, quietHours: { ...QUIET, enabled: false } });
    expect(eta.finishAt!.getTime() - NOW.getTime()).toBe(expectedMs);
    expect(Math.round((eta.finishAt!.getTime() - NOW.getTime()) / 1000)).toBe(Math.round(expectedMs / 1000));
    expect(eta.goNow).toBe(500);
    expect(eta.afterReset).toBe(0);
    expect(eta.resetAt).toBeNull();
    expect(eta.delayedBy).toEqual([]);
  });

  it('AC-3.2 reports finishAt, goNow, afterReset, resetAt and basis; nothing left means no finish time', () => {
    const eta = computeEta({ now: NOW, lastSentAt: null, items: [], ahead: [], number: OPEN, quietHours: QUIET });
    expect(eta).toMatchObject({ finishAt: null, goNow: 0, afterReset: 0, resetAt: null, basis: 'time_only' });
  });

  it('AC-3.3 with a known quota, new chats beyond what is left are scheduled after the cycle end', () => {
    const cycleEnd = new Date(NOW.getTime() + 6 * 3_600_000);
    const number: NumberState = { ...OPEN, capping: { status: 'FIRST_WARNING', remaining: 3, cycleEnd } };
    const items = Array.from({ length: 5 }, () => item(10_000, { newChat: true }));
    const eta = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number, quietHours: { ...QUIET, enabled: false } });
    expect(eta.basis).toBe('quota');
    expect(eta.goNow).toBe(3);
    expect(eta.afterReset).toBe(2);
    expect(eta.resetAt).toEqual(cycleEnd);
    // Two more messages after the reset: the first needs only its typing (a new run), the second its 20 s gap (new chats are at the first warning).
    expect(eta.finishAt!.getTime()).toBe(cycleEnd.getTime() + typingMs(2) + Math.max(20_000, typingMs(2)));
    expect(eta.delayedBy.some((d) => d.reason === 'new_chat_cap' && d.seconds > 0)).toBe(true);
  });

  it('AC-3.3 known contacts do not count against the quota', () => {
    const number: NumberState = { ...OPEN, capping: { status: 'NONE', remaining: 1, cycleEnd: new Date(NOW.getTime() + 3_600_000) } };
    const items = [item(5_000), item(5_000, { newChat: true }), item(5_000), item(5_000, { newChat: true })];
    const eta = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number, quietHours: { ...QUIET, enabled: false } });
    expect(eta.goNow).toBe(3);
    expect(eta.afterReset).toBe(1);
  });

  it('AC-3.3 with no quota known the basis is time_only and nothing is pushed after a reset', () => {
    const items = Array.from({ length: 4 }, () => item(10_000, { newChat: true }));
    const eta = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number: OPEN, quietHours: { ...QUIET, enabled: false } });
    expect(eta.basis).toBe('time_only');
    expect(eta.goNow).toBe(4);
    expect(eta.afterReset).toBe(0);
  });

  it('AC-3.5 a timelock moves the new chats to when it ends, and says by how much', () => {
    const until = new Date(NOW.getTime() + 3_600_000);
    const number: NumberState = { ...OPEN, timelock: { active: true, until, type: 'DEFAULT' } };
    const items = [item(5_000, { newChat: true }), item(5_000, { newChat: true })];
    const eta = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number, quietHours: { ...QUIET, enabled: false } });
    expect(eta.goNow).toBe(0);
    expect(eta.afterReset).toBe(2);
    expect(eta.resetAt).toEqual(until);
    expect(eta.delayedBy).toContainEqual({ reason: 'timelock', seconds: 3600 });
  });

  it('AC-3.5 replies already waiting go first and move the finish by their time, which the answer states', () => {
    const items = [item(10_000), item(10_000)];
    const plain = computeEta({ now: NOW, lastSentAt: null, items, ahead: [], number: OPEN, quietHours: { ...QUIET, enabled: false } });
    const withReply = computeEta({
      now: NOW, lastSentAt: null, items, ahead: [item(8_000, { campaign: false, chars: 0 })], number: OPEN, quietHours: { ...QUIET, enabled: false }
    });
    const moved = withReply.finishAt!.getTime() - plain.finishAt!.getTime();
    expect(moved).toBeGreaterThan(0);
    expect(withReply.delayedBy).toContainEqual({ reason: 'reply_priority', seconds: Math.round(typingMs(0) / 1000) });
    // The reply took its typing; the campaign's first message now waits its gap behind it instead of starting a fresh run.
    expect(moved).toBe(10_000 - typingMs(2) + typingMs(0));
  });

  it('AC-3.5 quiet hours push the finish to when they end, and say so', () => {
    const night = new Date('2026-11-02T16:25:00.000Z');          // 21:55 in Asia/Kolkata
    const items = Array.from({ length: 8 }, () => item(50_000));
    const eta = computeEta({ now: night, lastSentAt: null, items, ahead: [], number: OPEN, quietHours: QUIET });
    expect(eta.finishAt!.getTime()).toBeGreaterThan(new Date('2026-11-03T02:30:00.000Z').getTime());
    expect(eta.delayedBy.some((d) => d.reason === 'quiet_hours' && d.seconds > 0)).toBe(true);
  });
});
