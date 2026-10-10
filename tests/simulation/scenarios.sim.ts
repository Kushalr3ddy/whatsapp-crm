import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openSimDatabase, closeSimDatabase, type SimDb } from './sim-clock.js';
import { World } from './world.js';
import { naturalDailyVolume, DOWNGRADE_AT } from './whatsapp-sim.js';

/**
 * The scenarios from docs/12-testing.md, run against the real engine and a simulated WhatsApp that
 * bans when it is misbehaved with. The rule they enforce: the engine must trip its OWN breakers
 * before the simulation trips its ban heuristics. A ban here is a build failure.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 04:30 UTC is 10:00 in the number's own timezone, so a run opens in active hours. */
const START = new Date('2026-11-02T04:30:00Z');

let db: SimDb;
beforeAll(async () => { db = await openSimDatabase(url); });
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await closeSimDatabase(db); });

/** Prints a scenario's headline numbers to the run output (the sim's console is its report). */
function report(label: string, ...values: unknown[]): void {
  process.stdout.write(`${label} ${values.map((v) => JSON.stringify(v)).join(' ')}\n`);
}

/** Hour of day (0–23) in the number's timezone. */
function localHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(d)) % 24;
}

describe('negative control — the simulation can actually ban', () => {
  it('bans a number driven with every protection switched off', async () => {
    // If this ever stops banning, the harness has gone blind and every green result below means nothing.
    const w = await World.create(db, {
      // 30 days old, because the warmup ramp is a hard ceiling nothing can switch off — a day-1
      // number could not be driven fast enough to ban even with everything else disabled.
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0, deliveryRate: 1 },
      limits: { perMinute: 120, perDay: 100_000, circadianTimezone: null, identicalBodyCap: 100_000 },
      ctxOverrides: { typingSimulation: false, readReceipts: false, recipientTimezone: false, sleep: async () => {} }
    });
    // contactGraph is left off by the override below.
    const people = await w.addContacts(300, true);
    await w.startCampaign(people, 'Hello, exactly the same message to everyone');
    delete (w.ctx as { contactGraph?: unknown }).contactGraph;
    await w.run(2 * HOUR, MIN);
    expect(w.sim.bannedAt).not.toBeNull();
    report('control banned by', [...w.sim.byRule.entries()]);
  });
});

describe('cold number, day-1 blast', () => {
  it('to strangers: held to the new-contact allowance, never banned', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 0, hasInboundHistory: false,
      behaviour: { replyRate: 0.1, deliveryRate: 0.97 }
    });
    await w.startCampaign(await w.addContacts(400, false), '{Hi|Hello} {{name}}, quick question for you');
    await w.run(3 * DAY, 15 * MIN);

    expect(w.sim.bannedAt).toBeNull();
    expect(w.sim.peakRisk).toBeLessThan(DOWNGRADE_AT);
    w.sendsPerDay().forEach((n, day) => { expect(n).toBeLessThanOrEqual(naturalDailyVolume(day)); });
    report('day-1 blast to strangers — sends/day', w.sendsPerDay());
  });

  it('to people who already know it: held to the outbound-only clamp and warmup ramp', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 0, hasInboundHistory: false,
      behaviour: { replyRate: 0, deliveryRate: 0.97 }
    });
    await w.startCampaign(await w.addContacts(400, true), '{Hi|Hello} {{name}}, quick question for you');
    await w.run(2 * DAY, 10 * MIN);

    expect(w.sim.bannedAt).toBeNull();
    expect(w.sim.peakRisk).toBeLessThan(DOWNGRADE_AT);
    expect(w.sendsPerDay()[0]).toBeLessThanOrEqual(20);          // never replied → 20/day
    report('day-1 blast to known contacts — sends/day', w.sendsPerDay());
  });
});

describe('a warmed number running a long campaign', () => {
  it('completes without a ban, inside its ceilings, never at night, with human timing', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0.2, deliveryRate: 0.97 },
      limits: { perDay: 600 }
    });
    await w.startCampaign(await w.addContacts(900, true), '{Hi|Hello|Hey} {{name}}, a quick update for you');
    await w.run(2 * DAY, 10 * MIN);

    expect(w.sim.bannedAt).toBeNull();
    expect(w.sim.peakRisk).toBeLessThan(DOWNGRADE_AT);
    const perDay = w.sendsPerDay();
    perDay.forEach((n) => { expect(n).toBeLessThanOrEqual(600); });
    expect(w.sim.sends.length).toBeGreaterThan(400);             // it made real progress
    // Circadian: nothing between 02:00 and 06:00 local.
    expect(w.sim.sends.filter((s) => { const h = localHour(s.at); return h >= 2 && h < 6; })).toHaveLength(0);

    // Timing: not a fixed interval. Look only at gaps inside one working burst.
    const gaps = w.sim.sends.slice(1).map((s, i) => s.at.getTime() - w.sim.sends[i]!.at.getTime()).filter((g) => g < MIN);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(sd / mean).toBeGreaterThan(0.1);
    expect(new Set(gaps.map((g) => Math.round(g / 100))).size).toBeGreaterThan(20);
    report('warmed campaign — sends/day', perDay, 'gap cv', (sd / mean).toFixed(2), 'peak risk', w.sim.peakRisk);
  });
});

describe('reconnect, then a backlog', () => {
  it('does not flood the moment the socket returns', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0.2, deliveryRate: 0.97 }
    });
    await w.reconnect();                                         // the socket is down...
    await w.startCampaign(await w.addContacts(200, true), '{Hi|Hello} {{name}}, a quick update');
    await w.run(3 * HOUR, 15 * MIN);                             // ...while the queue fills
    expect(w.sim.sends).toHaveLength(0);
    await w.reopen();                                            // ...and then it comes back
    const back = w.now.getTime();
    await w.run(10 * MIN, 30_000);

    expect(w.sim.bannedAt).toBeNull();
    const firstFive = w.sim.sends.filter((s) => s.at.getTime() - back < 5 * MIN).length;
    report('reconnect — sends in first 5 min', firstFive, 'by rule', [...w.sim.byRule.entries()]);
    expect(firstFive).toBeLessThanOrEqual(30);
  });
});

describe('a low-reply-ratio spiral', () => {
  it('brakes new-contact outreach before the simulated reply-ratio penalty can bite', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 14, hasInboundHistory: true,
      behaviour: { replyRate: 0.03, deliveryRate: 0.95 }
    });
    await w.startCampaign(await w.addContacts(300, false), '{Hi|Hello} {{name}}, a quick question');
    await w.run(4 * DAY, 15 * MIN);

    expect(w.sim.bannedAt).toBeNull();
    expect(w.sim.peakRisk).toBeLessThan(DOWNGRADE_AT);
    // With a ~3% reply rate the reply-ratio floor never lifts the allowance past 5 a day.
    const firstSends = new Map<string, number>();
    for (const s of w.sim.sends) if (!firstSends.has(s.phone)) firstSends.set(s.phone, s.at.getTime());
    const perDay = new Map<number, number>();
    for (const t of firstSends.values()) {
      const d = Math.floor((t - START.getTime()) / DAY);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    perDay.forEach((n) => { expect(n).toBeLessThanOrEqual(5); });
    report('spiral — new contacts started per day', [...perDay.entries()]);
  });
});

describe('a silent restriction — nothing errors, deliveries just stop', () => {
  it('is noticed from delivery evidence, the number is held, and its campaign is paused', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0.2, deliveryRate: 0.97 },
      limits: { perDay: 600 },
      ctxOverrides: { restrictionSweepEveryMs: 0 }
    });
    const campaign = await w.startCampaign(await w.addContacts(700, true), '{Hi|Hello|Hey} {{name}}, an update for you');
    await w.run(3 * HOUR, 5 * MIN);                              // healthy for a while
    expect(await w.restrictionState()).toBe('ok');

    w.restrict('everyone');                                      // WhatsApp starts withholding deliveries
    const restrictedAt = w.now.getTime();
    await w.run(3 * HOUR, 5 * MIN);

    // Noticed, and acted on: the state says so, the campaign is paused, the timeline recorded it.
    expect(await w.restrictionState()).toBe('likely');
    const status = ((await db.execute(sql`SELECT status, pause_reason AS why FROM campaign WHERE id = ${campaign}`)) as
      unknown as Array<{ status: string; why: string | null }>)[0]!;
    expect(status).toEqual({ status: 'paused', why: 'restriction_likely' });
    expect(await w.healthEvents()).toContain('restriction_likely');

    // And it stopped feeding the number: almost nothing left after detection.
    const afterDetection = w.sim.sends.filter((s) => s.at.getTime() > restrictedAt + 2 * HOUR).length;
    report('silent restriction — sends in the 2h after it began', w.sim.sends.filter((s) => s.at.getTime() > restrictedAt && s.at.getTime() <= restrictedAt + 2 * HOUR).length,
      'after detection', afterDetection, 'state', await w.restrictionState());
    expect(afterDetection).toBeLessThanOrEqual(10);
    expect(w.sim.bannedAt).toBeNull();
  });

  it('clears itself once delivery is normal again and the old evidence ages out', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0.2, deliveryRate: 0.97 },
      limits: { perDay: 600 },
      ctxOverrides: { restrictionSweepEveryMs: 0 }
    });
    await w.startCampaign(await w.addContacts(500, true), '{Hi|Hello|Hey} {{name}}, an update for you');
    await w.run(2 * HOUR, 5 * MIN);
    w.restrict('everyone');
    await w.run(3 * HOUR, 5 * MIN);
    expect(await w.restrictionState()).not.toBe('ok');

    w.heal();
    await w.run(14 * HOUR, 15 * MIN);                           // the stuck sends age out of the window
    expect(await w.restrictionState()).toBe('ok');
    const events = await w.healthEvents();
    expect(events).toContain('restriction_cleared');
    report('restriction cleared — timeline', events);
  });

  it('does not cry wolf when a third of recipients simply have their phones off', async () => {
    const w = await World.create(db, {
      start: START, accountAgeDays: 30, hasInboundHistory: true,
      behaviour: { replyRate: 0.2, deliveryRate: 0.7 },
      limits: { perDay: 600 },
      ctxOverrides: { restrictionSweepEveryMs: 0 }
    });
    await w.startCampaign(await w.addContacts(400, true), '{Hi|Hello|Hey} {{name}}, an update for you');
    await w.run(1 * DAY, 10 * MIN);
    expect(await w.restrictionState()).toBe('ok');
    expect(await w.healthEvents()).not.toContain('restriction_suspected');
    expect(await w.healthEvents()).not.toContain('restriction_likely');
  });
});
