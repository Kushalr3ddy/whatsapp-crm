import { describe, expect, it } from 'vitest';
import { deliversFast, judgeUnreached, stuckDecision } from './ticks.js';

const before = (photo: boolean, about: boolean) => ({ photo, about, at: '2026-11-01T10:00:00.000Z' });
const min = (n: number): number => n * 60_000;
const T = new Date('2026-11-02T10:00:00.000Z');
const sentAgo = (ms: number): Date => new Date(T.getTime() - ms);

describe('AC-4.3 and AC-4.4 what a missing second tick means', () => {
  it('AC-4.3 both were visible before and both are gone now → likely_blocked', () => {
    expect(judgeUnreached(before(true, true), { photo: false, about: false })).toBe('likely_blocked');
  });

  it('AC-4.4 the photo is still visible → likely_offline', () => {
    expect(judgeUnreached(before(true, true), { photo: true, about: false })).toBe('likely_offline');
  });

  it('AC-4.4 the about is still visible → likely_offline', () => {
    expect(judgeUnreached(before(true, true), { photo: false, about: true })).toBe('likely_offline');
  });

  it('AC-4.4 no earlier snapshot → likely_offline', () => {
    expect(judgeUnreached(null, { photo: false, about: false })).toBe('likely_offline');
  });

  it('AC-4.4 only one of the two was visible before, so losing it proves nothing → likely_offline', () => {
    expect(judgeUnreached(before(true, false), { photo: false, about: false })).toBe('likely_offline');
    expect(judgeUnreached(before(false, true), { photo: false, about: false })).toBe('likely_offline');
  });
});

describe('AC-4.5 a contact that delivers fast', () => {
  it('AC-4.5 one of the last 3 messages delivered within 5 minutes is enough', () => {
    const last = [
      { sentAt: sentAgo(min(60)), deliveredAt: null },
      { sentAt: sentAgo(min(120)), deliveredAt: new Date(sentAgo(min(120)).getTime() + min(4)) },
      { sentAt: sentAgo(min(180)), deliveredAt: null }
    ];
    expect(deliversFast(last)).toBe(true);
  });

  it('AC-4.5 5 minutes exactly counts; slower does not', () => {
    const ok = [{ sentAt: sentAgo(min(60)), deliveredAt: new Date(sentAgo(min(60)).getTime() + min(5)) }];
    const slow = [{ sentAt: sentAgo(min(60)), deliveredAt: new Date(sentAgo(min(60)).getTime() + min(5) + 1) }];
    expect(deliversFast(ok)).toBe(true);
    expect(deliversFast(slow)).toBe(false);
  });

  it('AC-4.5 only the last 3 are looked at, newest first: a fast one further back does not count', () => {
    const slow = (ago: number) => ({ sentAt: sentAgo(ago), deliveredAt: null });
    const old = { sentAt: sentAgo(min(500)), deliveredAt: new Date(sentAgo(min(500)).getTime() + 1000) };
    expect(deliversFast([slow(min(60)), slow(min(120)), slow(min(180)), old])).toBe(false);
  });
});

describe('AC-4.6 and AC-4.7 many stuck', () => {
  it('AC-4.6 8 or more of the last 20 held back → hold the number\'s campaigns', () => {
    expect(stuckDecision({ stuck: 8, held: false })).toBe('hold');
    expect(stuckDecision({ stuck: 20, held: false })).toBe('hold');
    expect(stuckDecision({ stuck: 7, held: false })).toBe('none');
  });

  it('AC-4.7 the hold lifts when the count falls below 4, and stays between 4 and 7', () => {
    expect(stuckDecision({ stuck: 3, held: true })).toBe('lift');
    expect(stuckDecision({ stuck: 0, held: true })).toBe('lift');
    expect(stuckDecision({ stuck: 4, held: true })).toBe('none');
    expect(stuckDecision({ stuck: 7, held: true })).toBe('none');
    expect(stuckDecision({ stuck: 12, held: true })).toBe('none');
  });
});
