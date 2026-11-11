import { describe, expect, it } from 'vitest';
import { campaignZone, etaLine, formatWhen } from './campaign-time';
import type { CampaignEta } from './crm';

const IST = 'Asia/Kolkata';
const eta = (finishAt: string | null): CampaignEta => ({
  finishAt, goNow: 0, afterReset: 0, resetAt: null, basis: 'time_only', delayedBy: []
});

describe('formatWhen', () => {
  it('writes the month as a word, with no seconds', () => {
    // 2026-11-01 16:08:11 UTC is 21:38 in India.
    expect(formatWhen('2026-11-01T16:08:11Z', IST)).toBe('1 Nov 2026, 9:38 pm');
  });

  it('follows the zone it is given', () => {
    expect(formatWhen('2026-11-01T16:08:11Z', 'UTC')).toBe('1 Nov 2026, 4:08 pm');
  });
});

describe('etaLine', () => {
  const now = new Date('2026-11-02T08:44:00Z'); // 14:14 in India

  it('says nothing without an estimate or a finish', () => {
    expect(etaLine(null, now, IST)).toBeNull();
    expect(etaLine(eta(null), now, IST)).toBeNull();
  });

  it('gives the clock time and the minutes left, on the same day', () => {
    expect(etaLine(eta('2026-11-02T09:22:00Z'), now, IST)).toBe('Finishes about 2:52 pm · 38 min left');
  });

  it('switches to hours past an hour', () => {
    expect(etaLine(eta('2026-11-02T10:59:00Z'), now, IST)).toBe('Finishes about 4:29 pm · 2 h 15 min left');
  });

  it('adds the date when the finish is on another day', () => {
    expect(etaLine(eta('2026-11-03T03:30:00Z'), now, IST)).toBe('Finishes about 3 Nov, 9:00 am · 18 h 46 min left');
  });

  it('never shows negative minutes for a finish that is already past', () => {
    expect(etaLine(eta('2026-11-02T08:40:00Z'), now, IST)).toBe('Finishes about 2:10 pm · 0 min left');
  });
});

describe('campaignZone', () => {
  it('keeps a valid zone and falls back to UTC for a bad one', () => {
    expect(campaignZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(campaignZone('Not/AZone')).toBe('UTC');
  });
});
