import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  EntropyScheduler, entropyPlan, nextEntropyDelayMs,
  ENTROPY_MIN_INTERVAL_MS, ENTROPY_MAX_INTERVAL_MS
} from '@crm/core';
import { createLogger } from '@crm/shared';
import { runEntropyEvent, sweepEntropy, type WorkContext } from '../../apps/gateway/src/work.js';

/** Background entropy (P6 Layer 3, docs/08-antiban.md): idle-time presence noise, 2–6 h apart. */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hour = 3_600_000;

let db: Database;
let orgId: string;
let senderId: string;
let provider: FakeChannelProvider;
const sleeps: number[] = [];

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  sleeps.length = 0;
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('e','entropy') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'idler', '+919000000005', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
  provider = new FakeChannelProvider();
  await provider.connect({ id: senderId, phoneE164: '+919000000005' });
});

/** Context with entropy on; sleeps are recorded, not waited. */
function ctx(over: Partial<WorkContext> = {}): WorkContext {
  return {
    db, provider, logger, decrypt: (c) => new TextDecoder().decode(kms.decrypt(c)),
    limits: { perMinute: 8, perDay: 1500, circadianTimezone: null },
    entropy: new EntropyScheduler(),
    sleep: async (ms: number) => { sleeps.push(ms); }, ...over
  } as WorkContext;
}

/** A conversation whose contact has replied, so there is someone safe to "start typing" to. */
async function knownContact(phone: string): Promise<void> {
  const contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'k', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', ${phone}, true)`);
  await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at)
    VALUES (${orgId}, ${contactId}, ${senderId}, now())`);
}

describe('sizing and scheduling (pure)', () => {
  it('draws 3–8 s typing, 30–120 s presence, and a 2–6 h gap', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const p = entropyPlan(() => r);
      expect(p.typingMs).toBeGreaterThanOrEqual(3_000);
      expect(p.typingMs).toBeLessThanOrEqual(8_000);
      expect(p.presenceMs).toBeGreaterThanOrEqual(30_000);
      expect(p.presenceMs).toBeLessThanOrEqual(120_000);
      const d = nextEntropyDelayMs(() => r);
      expect(d).toBeGreaterThanOrEqual(ENTROPY_MIN_INTERVAL_MS);
      expect(d).toBeLessThanOrEqual(ENTROPY_MAX_INTERVAL_MS);
    }
  });

  it('does not fire on first sight, fires once the gap passes, then reschedules', () => {
    const s = new EntropyScheduler();
    const t0 = new Date('2026-10-05T10:00:00Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(s.due('a', t0, () => 0)).toBe(false);              // first sight schedules +2h
    expect(s.due('a', at(hour), () => 0)).toBe(false);
    expect(s.due('a', at(2 * hour), () => 0)).toBe(true);
    expect(s.due('a', at(2 * hour + 1000), () => 0)).toBe(false);   // rescheduled
    expect(s.due('b', at(2 * hour), () => 0)).toBe(false);          // senders are independent
  });
});

describe('a noise event', () => {
  it('types at a contact who replied, abandons it, then blips online and away', async () => {
    await knownContact('+919876550001');
    await runEntropyEvent(ctx(), senderId, '+919000000005', () => 0.5);
    expect(provider.typingCalls.map((c) => c.state)).toEqual(['composing', 'paused']);
    expect(provider.typingCalls[0]!.to.phoneE164).toBe('+919876550001');
    expect(provider.presenceCalls.map((c) => c.state)).toEqual(['available', 'unavailable']);
    expect(provider.sent).toHaveLength(0);                    // noise never sends a message
    expect(sleeps).toHaveLength(2);
  });

  it('never types at a stranger — only the presence blip when nobody has replied', async () => {
    await runEntropyEvent(ctx(), senderId, '+919000000005');
    expect(provider.typingCalls).toHaveLength(0);
    expect(provider.presenceCalls.map((c) => c.state)).toEqual(['available', 'unavailable']);
  });

  it('swallows a provider failure rather than disturbing anything', async () => {
    provider.presence = async () => { throw new Error('socket exploded'); };
    await expect(runEntropyEvent(ctx(), senderId, '+919000000005')).resolves.toBeUndefined();
  });
});

describe('the sweep', () => {
  it('fires nothing on first sight, then a connected number once its gap has passed', async () => {
    const c = ctx();
    const t0 = new Date('2026-10-05T10:00:00Z');
    expect(await sweepEntropy(c, t0)).toBe(0);
    expect(await sweepEntropy(c, new Date(t0.getTime() + 7 * hour))).toBe(1);   // past any 2–6 h gap
  });

  it('is silent in quiet hours, even for a number that is due', async () => {
    const c = ctx({ limits: { perMinute: 8, perDay: 1500, circadianTimezone: 'Asia/Kolkata' } });
    await sweepEntropy(c, new Date('2026-10-05T05:00:00Z'));       // 10:30 IST: first sight, schedules
    const night = new Date('2026-10-05T21:30:00Z');                 // 03:00 IST, well past the gap
    expect(await sweepEntropy(c, night)).toBe(0);
  });

  it('does nothing when switched off', async () => {
    const off = ctx(); delete (off as { entropy?: unknown }).entropy;
    expect(await sweepEntropy(off, new Date())).toBe(0);
  });

  it('skips a disconnected number', async () => {
    await db.execute(sql`UPDATE channel_session SET connection_state = 'closed'`);
    const c = ctx();
    await sweepEntropy(c, new Date('2026-10-05T10:00:00Z'));
    expect(await sweepEntropy(c, new Date('2026-10-05T20:00:00Z'))).toBe(0);
  });
});
