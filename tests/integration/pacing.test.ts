import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { checkSendAllowance, dailyCeiling, humanDelayMs } from '@crm/core';
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

  it('stops at the daily ceiling for a warming number', async () => {
    await alreadySent(6 * 60 * 60 * 1000, 20);
    const decision = await checkSendAllowance(db, senderId, { ...limits, perMinute: 1000 });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('warmup');
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
