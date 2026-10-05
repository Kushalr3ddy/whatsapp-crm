import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  computeRiskScore, riskBand, nextStatus, deliveryRatio, deliveryDelayMultiplier, scoreSenderHealth,
  type HealthSignals
} from '@crm/core';
import { createLogger } from '@crm/shared';
import { handleSend, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * Sender health scoring (P6, `docs/08-antiban.md`): the closed loop that watches send outcomes,
 * scores the risk, and moves a number between active / degraded / quarantined — in BOTH
 * directions, which is the property this project has got wrong three times (M-audit).
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let orgId: string;

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('h','health') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
});

/** A base set of signals; spread over it to describe a specific health picture. */
const healthy: HealthSignals = {
  sentRecent: 0, deliveredRecent: 0, failedRecent: 0,
  connectionState: 'open', disconnectCode: null, reconnectAttempts: 0
};

describe('the scoring maths (pure)', () => {
  it('scores a healthy number at zero', () => {
    expect(computeRiskScore({ ...healthy, sentRecent: 50, deliveredRecent: 49 })).toBe(0);
  });

  it('adds for poor delivery, but only with enough volume to judge', () => {
    // Two sends, none delivered, is not evidence — a new number, not a sick one.
    expect(computeRiskScore({ ...healthy, sentRecent: 2, deliveredRecent: 0 })).toBe(0);
    // Twelve sends, none delivered, is.
    expect(computeRiskScore({ ...healthy, sentRecent: 12, deliveredRecent: 0 })).toBe(40);
    // A middling ratio scores less than a collapsed one.
    expect(computeRiskScore({ ...healthy, sentRecent: 12, deliveredRecent: 8 })).toBe(20);
  });

  it('adds for a high failure rate', () => {
    expect(computeRiskScore({ ...healthy, sentRecent: 12, deliveredRecent: 12, failedRecent: 4 }))
      .toBe(30);
  });

  it('scores a bad disconnect only while the socket is down', () => {
    expect(computeRiskScore({ ...healthy, connectionState: 'closed', disconnectCode: 401 })).toBe(60);
    // Reconnected: the 401 recovered, so it no longer counts.
    expect(computeRiskScore({ ...healthy, connectionState: 'open', disconnectCode: 401 })).toBe(0);
  });

  it('caps the score at 100 however many signals pile up', () => {
    expect(computeRiskScore({
      ...healthy, sentRecent: 20, deliveredRecent: 0, failedRecent: 10,
      connectionState: 'closed', disconnectCode: 401, reconnectAttempts: 9
    })).toBe(100);
  });

  it('bands the score the way the spec does', () => {
    expect(riskBand(0)).toBe('low');
    expect(riskBand(30)).toBe('medium');
    expect(riskBand(60)).toBe('high');
    expect(riskBand(85)).toBe('critical');
  });

  it('reports a healthy delivery ratio when there is nothing to judge', () => {
    expect(deliveryRatio({ ...healthy })).toBe(1);
    expect(deliveryRatio({ ...healthy, sentRecent: 4, deliveredRecent: 3 })).toBe(0.75);
  });

  it('turns the delivery ratio into a continuous send-delay multiplier (Layer 5)', () => {
    expect(deliveryDelayMultiplier(0.9)).toBe(1);          // healthy → full speed, no slow-down
    expect(deliveryDelayMultiplier(0.5)).toBe(4);          // collapsed → quarter speed → ×4 delay
    expect(deliveryDelayMultiplier(0.7)).toBeCloseTo(1.6, 2); // midway → scaled, not a cliff
    // Monotonic: worse delivery is never faster.
    expect(deliveryDelayMultiplier(0.6)).toBeGreaterThan(deliveryDelayMultiplier(0.8));
  });
});

describe('status transitions, both directions and hysteretic', () => {
  it('escalates active → degraded → quarantined as risk climbs', () => {
    expect(nextStatus('active', 'high')).toBe('degraded');
    expect(nextStatus('active', 'critical')).toBe('quarantined');
    expect(nextStatus('degraded', 'critical')).toBe('quarantined');
  });

  it('recovers all the way back to active — the both-directions rule', () => {
    expect(nextStatus('degraded', 'low')).toBe('active');
    expect(nextStatus('quarantined', 'low')).toBe('active');
    // A quarantined number that improves to merely high steps DOWN to degraded, not straight out.
    expect(nextStatus('quarantined', 'high')).toBe('degraded');
  });

  it('holds on a medium reading, so a score near a threshold does not flap', () => {
    expect(nextStatus('active', 'medium')).toBeNull();
    expect(nextStatus('degraded', 'medium')).toBeNull();
    expect(nextStatus('quarantined', 'medium')).toBeNull();
  });

  it('never touches a linking or retired number', () => {
    expect(nextStatus('linking', 'critical')).toBeNull();
    expect(nextStatus('retired', 'low')).toBeNull();
  });

  it('leaves a healthy active number alone', () => {
    expect(nextStatus('active', 'low')).toBeNull();
  });
});

/** Creates a sender in a given status, plus a conversation to hang messages on. */
async function makeSender(status: string): Promise<{ senderId: string; conversationId: string }> {
  const senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'h', '+919000000001', ${status}, now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  const contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'them', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', '+919876500001', true)`);
  const conversationId = (await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  return { senderId, conversationId };
}

/** Inserts recent outbound messages with the given per-status counts. */
async function messages(
  conversationId: string, counts: { sent?: number; delivered?: number; failed?: number }
): Promise<void> {
  const add = async (n: number, status: string, hasSentAt: boolean): Promise<void> => {
    for (let i = 0; i < n; i++) {
      const now = new Date().toISOString();
      await db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                             provider_message_id, sent_at, created_at)
        VALUES (${orgId}, ${conversationId}, 'outbound', ${status}, 'text',
                ${`m-${randomUUID()}`}, ${hasSentAt ? now : null}, ${now})`);
    }
  };
  await add(counts.sent ?? 0, 'sent', true);
  await add(counts.delivered ?? 0, 'delivered', true);
  await add(counts.failed ?? 0, 'failed', false);
}

/** Sets the sender's live socket state, for the disconnect signals. */
async function setSession(
  senderId: string, connectionState: string, disconnectCode: number | null, reconnectAttempts = 0
): Promise<void> {
  await db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state, disconnect_code, reconnect_attempts)
    VALUES (${senderId}, ${connectionState}, ${disconnectCode}, ${reconnectAttempts})
    ON CONFLICT (sender_identity_id) DO UPDATE
      SET connection_state = ${connectionState}, disconnect_code = ${disconnectCode},
          reconnect_attempts = ${reconnectAttempts}`);
}

describe('scoring a real sender and moving its status', () => {
  it('leaves a healthy active number active, and writes the evidence', async () => {
    const { senderId, conversationId } = await makeSender('active');
    await messages(conversationId, { sent: 2, delivered: 18 });

    const result = await scoreSenderHealth(db, senderId);
    expect(result?.status).toBe('active');
    expect(result?.statusChanged).toBe(false);

    const stored = await db.execute(sql`
      SELECT risk_score AS "riskScore", health FROM sender_identity WHERE id = ${senderId}`);
    const row = (stored as unknown as Array<{
      riskScore: number; health: { band: string; deliveryRatio: number };
    }>)[0]!;
    expect(row.riskScore).toBe(0);
    expect(row.health.band).toBe('low');   // evidence, not just a bare number
  });

  it('degrades a number whose delivery has collapsed and sends are failing', async () => {
    const { senderId, conversationId } = await makeSender('active');
    await messages(conversationId, { sent: 12, failed: 5 });   // 0% delivered (+40), >20% fail (+30)

    const result = await scoreSenderHealth(db, senderId);
    expect(result?.riskScore).toBe(70);
    expect(result?.status).toBe('degraded');
    expect(result?.statusChanged).toBe(true);
  });

  it('quarantines a number that has logged out with bad delivery', async () => {
    const { senderId, conversationId } = await makeSender('active');
    await messages(conversationId, { sent: 12, delivered: 0 });   // +40
    await setSession(senderId, 'closed', 401);                    // +60 → 100, critical

    const result = await scoreSenderHealth(db, senderId);
    expect(result?.status).toBe('quarantined');
  });

  it('recovers a quarantined number all the way to active once the signals clear', async () => {
    // The both-directions rule: a number set quarantined, now sending cleanly and connected,
    // must climb back — not sit quarantined forever like the columns that only moved one way.
    const { senderId, conversationId } = await makeSender('quarantined');
    await messages(conversationId, { delivered: 20 });
    await setSession(senderId, 'open', null);

    const result = await scoreSenderHealth(db, senderId);
    expect(result?.riskScore).toBe(0);
    expect(result?.status).toBe('active');
    expect(result?.statusChanged).toBe(true);
  });

  it('opens a soft-ban recovery when delivery collapses (Layer 6)', async () => {
    const { senderId, conversationId } = await makeSender('active');
    await messages(conversationId, { sent: 12, delivered: 0 });   // ratio 0 with enough volume
    await scoreSenderHealth(db, senderId);

    const row = (await db.execute(sql`
      SELECT recovery_incident AS i, recovery_until AS u
      FROM sender_identity WHERE id = ${senderId}`) as unknown as Array<{ i: string | null; u: string | null }>)[0]!;
    expect(row.i).toBe('soft_ban');
    expect(new Date(row.u!).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not open a recovery while delivery is healthy', async () => {
    const { senderId, conversationId } = await makeSender('active');
    await messages(conversationId, { sent: 2, delivered: 18 });
    await scoreSenderHealth(db, senderId);

    const row = (await db.execute(sql`
      SELECT recovery_incident AS i FROM sender_identity WHERE id = ${senderId}`) as unknown as Array<{ i: string | null }>)[0]!;
    expect(row.i).toBeNull();
  });
});

describe('the health gate in the send path', () => {
  function ctxWith(slept: number[]): WorkContext {
    return {
      db, provider: new FakeChannelProvider(), logger,
      decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
      limits: { perMinute: 8, perDay: 1500 },
      sleep: async (ms: number) => { slept.push(ms); await Promise.resolve(); }
    };
  }

  async function queueOne(conversationId: string): Promise<string> {
    const rows = await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
      VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
              ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))})
      RETURNING id`);
    return (rows as unknown as Array<{ id: string }>)[0]!.id;
  }

  it('leaves a quarantined sender\'s message queued rather than sending it', async () => {
    const { senderId, conversationId } = await makeSender('quarantined');
    const messageId = await queueOne(conversationId);

    const ctx = ctxWith([]);
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    await handleSend(ctx, messageId);

    const rows = await db.execute(sql`SELECT status FROM message WHERE id = ${messageId}`);
    expect((rows as unknown as Array<{ status: string }>)[0]!.status).toBe('queued');
    expect(provider.sent).toHaveLength(0);
  });

  it('a degraded sender still sends, but pauses at least twice as long', async () => {
    const { senderId, conversationId } = await makeSender('degraded');
    const messageId = await queueOne(conversationId);

    const slept: number[] = [];
    const ctx = ctxWith(slept);
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    await handleSend(ctx, messageId);

    const rows = await db.execute(sql`SELECT status FROM message WHERE id = ${messageId}`);
    expect((rows as unknown as Array<{ status: string }>)[0]!.status).toBe('sent');
    // The base jitter floor is 1500ms; degraded doubles it, so the pause is at least 3000.
    expect(slept[0]).toBeGreaterThanOrEqual(3000);
  });
});
