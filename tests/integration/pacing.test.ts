import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  checkSendAllowance, dailyCeiling, humanDelayMs,
  circadianActivity, circadianDelayMs, localHour, typingDelayMs, recoveryState,
  renderBody, resolveSpintax, fillVariables
} from '@crm/core';
import { createLogger } from '@crm/shared';
import { handleSend, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * The anti-ban gate (P6 layers 1 and 2, `docs/08-antiban.md`).
 *
 * This is the one piece of this system whose failure is unrecoverable. Baileys is unofficial,
 * a banned number is gone with no appeal, and there is no test that can tell you the ceiling
 * was high enough — only tests that prove a ceiling exists and holds. That is what these are.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let orgId: string;
let senderId: string;
let contactId: string;
let conversationId: string;

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('p','pacing') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 'pacer', '+919000000001', 'active')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'them', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', '+919876500001', true)`);
  conversationId = (await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Records a message as already sent, `ago` milliseconds in the past. */
async function alreadySent(ago: number, count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.now() - ago).toISOString();
    await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                           provider_message_id, sent_at, created_at)
      VALUES (${orgId}, ${conversationId}, 'outbound', 'sent', 'text',
              ${`past-${randomUUID()}`}, ${at}, ${at})`);
  }
}

/** Queues one outbound message and returns its id. */
async function queueOne(): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode('hello')))})
    RETURNING id`);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}

const limits = { perMinute: 8, perDay: 1500, dailyCapOverride: null, warmupStartedAt: null };

describe('the warmup ramp', () => {
  it('starts a brand new number at 20 a day, not at the steady cap', async () => {
    // A number that has never sent is the most suspicious thing on the network. The steady
    // cap is 1500; day one is 20, and no configuration may raise that.
    expect(dailyCeiling({ ...limits, warmupStartedAt: null }, null, new Date())).toBe(20);
  });

  it('ramps at 1.8× a day and reaches the steady cap after a week', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const at = (n: number) =>
      dailyCeiling({ ...limits, warmupStartedAt: daysAgo(n) }, daysAgo(0), now);

    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)])
      .toEqual([20, 36, 65, 117, 210, 378, 680]);
    expect(at(7)).toBe(1500);
    expect(at(30)).toBe(1500);
  });

  it('re-enters warmup after 72 hours of silence', () => {
    // A dormant number that suddenly starts sending is the pattern that gets banned, so
    // warmup is keyed off actual sending rather than off when the number was linked.
    const now = new Date();
    const linkedLongAgo = new Date(now.getTime() - 30 * 86_400_000);
    const lastSent = new Date(now.getTime() - 96 * 60 * 60 * 1000);

    expect(dailyCeiling({ ...limits, warmupStartedAt: linkedLongAgo }, lastSent, now)).toBe(20);
  });

  it('lets an override lower the ceiling but never raise it', () => {
    const warm = new Date(Date.now() - 30 * 86_400_000);
    const recent = new Date();

    expect(dailyCeiling({ ...limits, warmupStartedAt: warm, dailyCapOverride: 50 }, recent, recent))
      .toBe(50);
    // The one that matters. An override that could raise the ceiling would be used the first
    // time somebody was in a hurry, which is exactly when the ceiling matters.
    expect(dailyCeiling({ ...limits, warmupStartedAt: warm, dailyCapOverride: 99_999 }, recent, recent))
      .toBe(1500);
  });
});

describe('rate windows, counted from what was actually sent', () => {
  it('refuses once the per-minute ceiling is reached', async () => {
    await alreadySent(10_000, 8);
    const decision = await checkSendAllowance(db, senderId, {
      ...limits, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('per_minute');
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('ignores sends that have aged out of the window', async () => {
    // Counted by sent_at, so yesterday's traffic cannot throttle today's.
    await alreadySent(2 * 60 * 1000, 8);
    const decision = await checkSendAllowance(db, senderId, {
      ...limits, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });
    expect(decision.allowed).toBe(true);
  });

  it('counts queued messages as nothing — only what left counts', async () => {
    // A thousand messages queued at once are not a thousand sends. Pacing a queue by when it
    // was filled rather than when it drained would defeat the entire point.
    await queueOne(); await queueOne(); await queueOne();
    const decision = await checkSendAllowance(db, senderId, {
      ...limits, perMinute: 2, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });
    expect(decision.allowed).toBe(true);
  });

  it('refuses at the hourly ceiling, between the minute and the day', async () => {
    // 200/hour sits between two limits that have config knobs and one that does not. Untested
    // it would be the ceiling nobody notices is missing until a number is gone.
    await alreadySent(30 * 60 * 1000, 200);
    const decision = await checkSendAllowance(db, senderId, {
      ...limits, perMinute: 1000, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('per_hour');
  });

  it('applies an override through the real allowance check, not just the ceiling maths', async () => {
    // dailyCeiling is unit-tested; this asserts the override actually reaches it from the
    // sender row, which is the part a refactor would silently break.
    await alreadySent(2 * 60 * 60 * 1000, 5);
    const decision = await checkSendAllowance(db, senderId, {
      ...limits, perMinute: 1000, dailyCapOverride: 5,
      warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.detail).toContain('5');
  });

  it('counts only this sender, not the whole org', async () => {
    // Two numbers on one org must not throttle each other; that is what a per-org ceiling
    // would be for, and it does not exist yet.
    const other = (await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgId}, 'fake', 'other', 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await alreadySent(5_000, 8);

    const decision = await checkSendAllowance(db, other, {
      ...limits, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000)
    });
    expect(decision.allowed).toBe(true);
  });

  it('stops at the daily ceiling for a warming number', async () => {
    await alreadySent(6 * 60 * 60 * 1000, 20);
    const decision = await checkSendAllowance(db, senderId, { ...limits, perMinute: 1000 });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('warmup');
  });
});

describe('easing back after a reconnect', () => {
  const warmed = () => ({ ...limits, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000) });

  it('holds the per-minute ceiling low just after the socket reopens', async () => {
    await alreadySent(10_000, 3);                              // 3 in the last minute: fine normally
    const normal = await checkSendAllowance(db, senderId, warmed());
    expect(normal.allowed).toBe(true);

    const easing = await checkSendAllowance(db, senderId, {
      ...warmed(), lastConnectedAt: new Date(Date.now() - 2 * 60_000)
    });
    expect(easing.allowed).toBe(false);
    if (!easing.allowed) {
      expect(easing.reason).toBe('per_minute');
      expect(easing.detail).toContain('reconnect');
    }
  });

  it('is back to full speed after the ramp, and never raises a lower configured ceiling', async () => {
    await alreadySent(10_000, 3);
    const later = await checkSendAllowance(db, senderId, {
      ...warmed(), lastConnectedAt: new Date(Date.now() - 11 * 60_000)
    });
    expect(later.allowed).toBe(true);

    await alreadySent(10_000, 1);                               // 4 in the minute; configured cap is 2
    const lowCap = await checkSendAllowance(db, senderId, {
      ...warmed(), perMinute: 2, lastConnectedAt: new Date(Date.now() - 2 * 60_000)
    });
    expect(lowCap.allowed).toBe(false);
  });
});

describe('the delay between sends', () => {
  it('stays inside the specced window', () => {
    const samples = Array.from({ length: 500 }, () => humanDelayMs());
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(1500);
    expect(Math.max(...samples)).toBeLessThanOrEqual(4000);
  });

  it('is not a fixed interval, and not uniform either', () => {
    // A constant interval is a perfect fingerprint (M10), and uniform random is itself a
    // detectable signature — real pauses cluster around a typical value.
    const samples = Array.from({ length: 2000 }, () => humanDelayMs());
    expect(new Set(samples).size).toBeGreaterThan(100);

    const mid = 2750;
    const nearMid = samples.filter((d) => Math.abs(d - mid) < 400).length / samples.length;
    const nearEdges = samples.filter((d) => d < 1900 || d > 3600).length / samples.length;
    expect(nearMid).toBeGreaterThan(nearEdges);
  });
});

describe('typing simulation (how long to look like typing)', () => {
  it('stays inside the clamped window whatever the length', () => {
    // Even an empty body waits the floor (no instant send — that is the tell we avoid), and a
    // very long body is capped rather than parking the send behind a minute of fake typing.
    const lengths = [0, 1, 20, 200, 5000];
    for (const len of lengths) {
      const samples = Array.from({ length: 200 }, () => typingDelayMs(len));
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(700);
      expect(Math.max(...samples)).toBeLessThanOrEqual(8000);
    }
  });

  it('takes longer for a longer message, on average', () => {
    const avg = (len: number): number => {
      const s = Array.from({ length: 300 }, () => typingDelayMs(len));
      return s.reduce((a, b) => a + b, 0) / s.length;
    };
    // A short reply hits the floor; a mid-length body sits above it — length drives the beat.
    expect(avg(150)).toBeGreaterThan(avg(5));
  });

  it('is not a fixed interval', () => {
    // A constant typing time is as much a fingerprint as a constant send interval (M10).
    const samples = Array.from({ length: 500 }, () => typingDelayMs(120));
    expect(new Set(samples).size).toBeGreaterThan(50);
  });
});

describe('recovery orchestration (Layer 6)', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('reports no recovery when nothing is set', () => {
    const s = recoveryState({ incident: null, recoveryUntil: null });
    expect(s).toMatchObject({ phase: 'none', capFraction: 1 });
  });

  it('holds sends entirely during the pause window', () => {
    const now = new Date('2026-02-01T12:00:00Z');
    const until = new Date(now.getTime() + 10 * HOUR);          // still cooling off
    const s = recoveryState({ incident: 'timelock_463', recoveryUntil: until }, now);
    expect(s.phase).toBe('paused');
    expect(s.capFraction).toBe(0);
    expect(s.resumesAt?.toISOString()).toBe(until.toISOString());
  });

  it('resumes at the incident fraction and ramps up weekly, then clears', () => {
    const until = new Date('2026-02-01T00:00:00Z');            // pause already lifted
    // 463: resume 10%, +15%/week.
    const atResume = new Date(until.getTime() + HOUR);
    expect(recoveryState({ incident: 'timelock_463', recoveryUntil: until }, atResume))
      .toMatchObject({ phase: 'ramping', capFraction: 0.1 });
    const oneWeek = new Date(until.getTime() + 7 * DAY + HOUR);
    expect(recoveryState({ incident: 'timelock_463', recoveryUntil: until }, oneWeek).capFraction)
      .toBeCloseTo(0.25, 5);
    // 0.10 + 6×0.15 = 1.0 → fully recovered, so it reports none again.
    const sixWeeks = new Date(until.getTime() + 6 * 7 * DAY + HOUR);
    expect(recoveryState({ incident: 'timelock_463', recoveryUntil: until }, sixWeeks).phase)
      .toBe('none');
  });
});

describe('campaign body variation (spintax + variables, D-26)', () => {
  /** A fake random that always picks a fixed index, so a spintax choice is deterministic. */
  const pick = (index: number, count: number): (() => number) => () => index / count;

  it('resolves a spintax group to one of its options', () => {
    expect(resolveSpintax('{Hi|Hey|Hello} there', pick(0, 3))).toBe('Hi there');
    expect(resolveSpintax('{Hi|Hey|Hello} there', pick(2, 3))).toBe('Hello there');
  });

  it('resolves nested spintax inside-out', () => {
    expect(resolveSpintax('{Good {morning|day}|Hi}', () => 0)).toBe('Good morning');
  });

  it('leaves text with no spintax untouched', () => {
    expect(resolveSpintax('plain text, no braces', () => 0)).toBe('plain text, no braces');
  });

  it('fills name variables and empties unknown ones', () => {
    expect(fillVariables('Hi {{name}}', { name: 'Priya' })).toBe('Hi Priya');
    expect(fillVariables('Hi {{contact.name}}', { name: 'Rahul' })).toBe('Hi Rahul');
    expect(fillVariables('Hi {{name}}', { name: '' })).toBe('Hi ');
    expect(fillVariables('{{unknown}} tail', {})).toBe(' tail');
  });

  it('renders spintax first, then variables — so a name with braces or pipes is safe', () => {
    // Spintax runs on the operator template; the contact value is inserted into the chosen literal
    // afterwards, so a display name of "A|B{c}" cannot corrupt the parse.
    const out = renderBody('{Hi|Hey} {{name}}', { name: 'A|B{c}' }, pick(0, 2));
    expect(out).toBe('Hi A|B{c}');
  });

  it('varies the output across recipients', () => {
    // The whole point: 500 sends are not 500 identical strings.
    const seen = new Set(
      Array.from({ length: 200 }, () => renderBody('{Hi|Hey|Hello|Yo} {{name}}', { name: 'x' }))
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('scales the daily ceiling down by the recovery fraction, never below 1, never up', () => {
    const warm = { perMinute: 8, perDay: 1500, dailyCapOverride: null,
      warmupStartedAt: new Date('2026-01-01T00:00:00Z') };                 // long warmed
    const now = new Date('2026-03-01T00:00:00Z');
    const full = dailyCeiling(warm, null, now);
    expect(full).toBe(1500);
    expect(dailyCeiling({ ...warm, recoveryCapFraction: 0.1 }, null, now)).toBe(150);
    // A tiny fraction still leaves room for at least one send (the pause is the full hold).
    expect(dailyCeiling({ ...warm, recoveryCapFraction: 0.0001 }, null, now)).toBe(1);
    // A fraction of 1 (or absent) changes nothing.
    expect(dailyCeiling({ ...warm, recoveryCapFraction: 1 }, null, now)).toBe(1500);
  });
});

describe('the gate in the send path', () => {
  /** A work context whose sleep is instant, so a test costs no real seconds. */
  function ctxWith(perMinute: number, slept: number[]): WorkContext {
    return {
      db, provider: new FakeChannelProvider(), logger,
      decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
      limits: { perMinute, perDay: 1500 },
      sleep: async (ms: number) => { slept.push(ms); await Promise.resolve(); }
    };
  }

  it('leaves a paced message queued rather than failing it', async () => {
    // The distinction that keeps messages: a message that is merely early has not failed, and
    // failing it would lose it. The sweep picks it up later.
    await db.execute(sql`
      UPDATE sender_identity SET warmup_started_at = now() - interval '30 days'
      WHERE id = ${senderId}`);
    await alreadySent(5_000, 3);

    const messageId = await queueOne();
    const ctx = ctxWith(3, []);
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    await handleSend(ctx, messageId);

    const rows = await db.execute(sql`
      SELECT status, error_code AS "errorCode" FROM message WHERE id = ${messageId}`);
    const row = (rows as unknown as Array<{ status: string; errorCode: string | null }>)[0]!;
    expect(row.status).toBe('queued');
    expect(row.errorCode).toBeNull();
    expect(provider.sent).toHaveLength(0);
  });

  it('sends when under the ceiling, and pauses first', async () => {
    await db.execute(sql`
      UPDATE sender_identity SET warmup_started_at = now() - interval '30 days'
      WHERE id = ${senderId}`);

    const messageId = await queueOne();
    const slept: number[] = [];
    const ctx = ctxWith(8, slept);
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    await handleSend(ctx, messageId);

    const rows = await db.execute(sql`SELECT status FROM message WHERE id = ${messageId}`);
    expect((rows as unknown as Array<{ status: string }>)[0]!.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
    // It waited before sending, not after — a burst arriving at once gets spread out.
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(1500);
  });

  it('caps a burst at the ceiling instead of sending all of it', async () => {
    // The scenario this whole layer exists for: a campaign hands the gateway a pile of
    // messages at once. Without the gate every one of them goes, at machine speed, from an
    // unofficial client — which is how a number is lost permanently.
    await db.execute(sql`
      UPDATE sender_identity SET warmup_started_at = now() - interval '30 days'
      WHERE id = ${senderId}`);

    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await queueOne());

    const ctx = ctxWith(4, []);
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    for (const id of ids) await handleSend(ctx, id);

    expect(provider.sent).toHaveLength(4);
    const remaining = await db.execute(sql`
      SELECT count(*)::int AS n FROM message
      WHERE conversation_id = ${conversationId} AND status = 'queued'`);
    // The rest are still there, waiting, rather than sent or lost.
    expect((remaining as unknown as Array<{ n: number }>)[0]!.n).toBe(6);
  });
});

describe('circadian pacing (the daily rhythm)', () => {
  it('is full speed through the working day and dead in the small hours', () => {
    expect(circadianActivity(14)).toBe(1);    // 2 p.m.
    expect(circadianActivity(10)).toBe(1);    // 10 a.m.
    expect(circadianActivity(3)).toBe(0);     // 3 a.m. — dead
    expect(circadianActivity(4.5)).toBe(0);   // still dead
  });

  it('tapers and ramps smoothly, with no step at a round hour', () => {
    // Half-way points of the evening taper (22→02) and morning ramp (06→09) sit near 0.5, and the
    // value moves continuously across each boundary rather than snapping.
    expect(circadianActivity(0)).toBeCloseTo(0.5, 2);    // midnight, mid-taper
    expect(circadianActivity(7.5)).toBeCloseTo(0.5, 2);  // mid morning-ramp
    expect(circadianActivity(21.99)).toBeGreaterThan(0.99);   // still daytime
    expect(circadianActivity(22.5)).toBeLessThan(1);          // just into the taper
    expect(circadianActivity(22.5)).toBeGreaterThan(0.8);     // but only just
  });

  it('wraps midnight and normalises out-of-range hours', () => {
    expect(circadianActivity(26)).toBe(circadianActivity(2));
    expect(circadianActivity(-1)).toBe(circadianActivity(23));
  });

  it('reads the local hour in a timezone via the platform Intl database', () => {
    // 2026-06-01T08:30:00Z is 14:00 in IST (UTC+5:30); midnight UTC is 05:30 IST.
    expect(localHour(new Date('2026-06-01T08:30:00Z'), 'Asia/Kolkata')).toBeCloseTo(14, 5);
    expect(localHour(new Date('2026-06-01T00:00:00Z'), 'Asia/Kolkata')).toBeCloseTo(5.5, 5);
  });

  it('stretches the pause as the day winds down, capped', () => {
    expect(circadianDelayMs(2000, 1)).toBe(2000);       // full day: unchanged
    expect(circadianDelayMs(2000, 0.5)).toBe(4000);     // half: roughly doubled
    expect(circadianDelayMs(4000, 0.1)).toBe(15_000);   // deep shoulder: capped, not unbounded
  });

  const warm = { ...limits, warmupStartedAt: new Date(Date.now() - 30 * 86_400_000) };

  it('defers a send overnight even when every ceiling has room', async () => {
    // 03:00 IST = 2026-06-01T21:30:00Z. Nothing has been sent, so layers 1–2 would allow it —
    // the daily rhythm is the only thing holding it back.
    const at3amIST = new Date('2026-06-01T21:30:00Z');
    const decision = await checkSendAllowance(
      db, senderId, { ...warm, circadianTimezone: 'Asia/Kolkata' }, at3amIST
    );

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('circadian');
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('sends during the day, with a pause at least the base minimum', async () => {
    // 14:00 IST = 2026-06-01T08:30:00Z.
    const at2pmIST = new Date('2026-06-01T08:30:00Z');
    const decision = await checkSendAllowance(
      db, senderId, { ...warm, circadianTimezone: 'Asia/Kolkata' }, at2pmIST
    );

    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.delayMs).toBeGreaterThanOrEqual(1500);
  });

  it('is opt-in: with no timezone, the same 3 a.m. send is allowed', async () => {
    // Proof that circadian pacing does not touch layers 1–2 for a caller that does not ask for
    // it — which is why the rest of this suite passes unchanged.
    const at3amIST = new Date('2026-06-01T21:30:00Z');
    const decision = await checkSendAllowance(db, senderId, warm, at3amIST);
    expect(decision.allowed).toBe(true);
  });
});

describe('the outbound-only clamp (never received an inbound)', () => {
  const warmed = {
    perMinute: 8, perDay: 1500, dailyCapOverride: null,
    warmupStartedAt: new Date('2026-01-01T00:00:00Z')            // long past warmup → steady 1500
  };
  const now = new Date('2026-03-01T00:00:00Z');

  it('caps a number that has never replied at 20/day, whatever its warmup day', () => {
    expect(dailyCeiling({ ...warmed, lastInboundAt: null }, null, now)).toBe(20);
  });

  it('does not clamp once the number has received an inbound', () => {
    expect(dailyCeiling({ ...warmed, lastInboundAt: new Date('2026-02-20T00:00:00Z') }, null, now))
      .toBe(1500);
  });

  it('is skipped entirely when the caller does not evaluate inbound (backward compatible)', () => {
    // No `lastInboundAt` key → the clamp never applies, so every pre-existing caller is unchanged.
    expect(dailyCeiling(warmed, null, now)).toBe(1500);
  });

  it('never raises a lower ceiling — a day-1 warmup number is still 20, not bumped', () => {
    const day1 = { ...warmed, warmupStartedAt: now, lastInboundAt: null };
    expect(dailyCeiling(day1, null, now)).toBe(20);
  });
});
