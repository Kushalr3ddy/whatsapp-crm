import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import {
  DecryptFailureTracker, markDecryptBurst, decryptBurstIsLive, computeRiskScore, riskBand,
  scoreSenderHealth, DECRYPT_BURST_LIVE_MS
} from '@crm/core';
import { isDecryptFailure, tapDecryptFailures } from '../../packages/channels/baileys/src/decrypt-tap.js';

/**
 * The decrypt-failure signal (Layer 5, docs/08-antiban.md): 3 "Bad MAC" in 60 s degrades a sender,
 * and the status recovers on its own once the burst lapses.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
let db: Database;
let senderId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('d','decrypt') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 's', '+919000000009', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
});

describe('recognising a decrypt failure in Baileys logging', () => {
  it('matches the message, the Bad MAC error, and the no-session error', () => {
    expect(isDecryptFailure({}, 'failed to decrypt message')).toBe(true);
    expect(isDecryptFailure({ err: new Error('Bad MAC') }, 'x')).toBe(true);
    expect(isDecryptFailure({ err: { message: 'No matching sessions found for message' } })).toBe(true);
    expect(isDecryptFailure({ err: new Error('timeout') }, 'connection error')).toBe(false);
    expect(isDecryptFailure(undefined, 'hello')).toBe(false);
  });

  it('taps warn/error (including child loggers) and passes every call through', () => {
    const calls: string[] = [];
    const base = {
      level: 'info',
      child: () => base, info: () => calls.push('info'), debug: () => calls.push('debug'),
      trace: () => calls.push('trace'), warn: () => calls.push('warn'), error: () => calls.push('error')
    };
    let fired = 0;
    const log = tapDecryptFailures(base, () => { fired++; });
    log.child({}).error({ err: new Error('Bad MAC') }, 'failed to decrypt message');
    log.info({}, 'unrelated');
    expect(fired).toBe(1);
    expect(calls).toEqual(['error', 'info']);
    // a throwing callback must never break logging
    const unsafe = tapDecryptFailures(base, () => { throw new Error('boom'); });
    expect(() => unsafe.error({}, 'failed to decrypt message')).not.toThrow();
  });
});

describe('the burst tracker', () => {
  it('trips on the 3rd failure inside 60 s, once, and not for slow drips', () => {
    const t = new DecryptFailureTracker();
    const at = (s: number) => new Date(1_000_000 + s * 1000);
    expect(t.record('a', at(0))).toBe(false);
    expect(t.record('a', at(10))).toBe(false);
    expect(t.record('a', at(20))).toBe(true);
    expect(t.record('a', at(21))).toBe(false);           // window cleared after a trip
    const slow = new DecryptFailureTracker();
    expect(slow.record('b', at(0))).toBe(false);
    expect(slow.record('b', at(40))).toBe(false);
    expect(slow.record('b', at(80))).toBe(false);        // first two aged out
  });

  it('counts each sender separately', () => {
    const t = new DecryptFailureTracker();
    const now = new Date();
    t.record('a', now); t.record('a', now);
    expect(t.record('b', now)).toBe(false);
  });
});

describe('scoring and recovery', () => {
  const base = {
    sentRecent: 0, deliveredRecent: 0, failedRecent: 0, connectionState: 'open',
    disconnectCode: null, reconnectAttempts: 0
  };

  it('a live burst alone puts the sender in the high band', () => {
    expect(riskBand(computeRiskScore({ ...base, decryptBurstLive: true }))).toBe('high');
    expect(riskBand(computeRiskScore({ ...base, decryptBurstLive: false }))).toBe('low');
  });

  it('a burst is live for 15 minutes, then lapses', () => {
    const now = new Date();
    expect(decryptBurstIsLive(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(decryptBurstIsLive(new Date(now.getTime() - DECRYPT_BURST_LIVE_MS - 1), now)).toBe(false);
    expect(decryptBurstIsLive(null, now)).toBe(false);
  });

  it('degrades an active sender, then restores it once the burst lapses', async () => {
    await markDecryptBurst(db, senderId, new Date());
    const hit = await scoreSenderHealth(db, senderId);
    expect(hit?.status).toBe('degraded');

    // 20 minutes later nothing else has changed: the signal has lapsed and the sender recovers
    const later = new Date(Date.now() + 20 * 60_000);
    const healed = await scoreSenderHealth(db, senderId, later);
    expect(healed?.status).toBe('active');
  });
});
