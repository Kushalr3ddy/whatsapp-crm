import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  readDelayMs, readIsDue, READ_DELAY_MIN_MS, READ_DELAY_MAX_MS, READ_MAX_AGE_MS
} from '@crm/core';
import { createLogger } from '@crm/shared';
import { sweepReadReceipts, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * Read behaviour (P6 Layer 3, docs/08-antiban.md): inbound messages are blue-ticked only after a
 * per-message 10–60 minute delay and only in active hours, never as a backlog burst.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const min = 60_000;

let db: Database;
let orgId: string;
let senderId: string;
let provider: FakeChannelProvider;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('r','reads') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'reader', '+919000000007', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  provider = new FakeChannelProvider();
  await provider.connect({ id: senderId, phoneE164: '+919000000007' });
});

/** Context with read receipts on; `tz: null` turns circadian off so the hour cannot interfere. */
function ctx(over: Partial<WorkContext> = {}): WorkContext {
  return {
    db, provider, logger, decrypt: (c) => new TextDecoder().decode(kms.decrypt(c)),
    limits: { perMinute: 8, perDay: 1500, circadianTimezone: null },
    readReceipts: true, sleep: async () => {}, ...over
  } as WorkContext;
}

/** An inbound message `agoMin` minutes old on a fresh contact; returns its id. */
async function inboundAgo(agoMin: number, phone: string): Promise<string> {
  const contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'p', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', ${phone}, true)`);
  const conv = (await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  const at = new Date(Date.now() - agoMin * min).toISOString();
  return (await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                         provider_message_id, created_at)
    VALUES (${orgId}, ${conv}, 'inbound', 'delivered', 'text', ${`in-${randomUUID()}`}, ${at})
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
}

describe('the read delay (pure)', () => {
  it('is 10–60 minutes, stable per message, and varies between messages', () => {
    const ids = Array.from({ length: 50 }, () => randomUUID());
    const delays = ids.map(readDelayMs);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(READ_DELAY_MIN_MS);
      expect(d).toBeLessThanOrEqual(READ_DELAY_MAX_MS);
    }
    expect(readDelayMs(ids[0]!)).toBe(delays[0]);          // same id, same answer
    expect(new Set(delays).size).toBeGreaterThan(40);       // not a fixed interval
  });

  it('is due only after its delay, never as stale backlog, and not in quiet hours', () => {
    const id = randomUUID();
    const t0 = new Date('2026-10-05T10:00:00Z');
    const after = (ms: number) => new Date(t0.getTime() + ms);
    expect(readIsDue(id, t0, after(5 * min), 1)).toBe(false);                  // too soon
    expect(readIsDue(id, t0, after(READ_DELAY_MAX_MS + 1), 1)).toBe(true);     // past any delay
    expect(readIsDue(id, t0, after(READ_DELAY_MAX_MS + 1), 0.2)).toBe(false);  // quiet hours
    expect(readIsDue(id, t0, after(READ_DELAY_MAX_MS + 1), null)).toBe(true);  // circadian off
    expect(readIsDue(id, t0, after(READ_MAX_AGE_MS + 1), 1)).toBe(false);      // stale backlog
  });
});

describe('the read sweep', () => {
  it('marks a message read once due and records it, but not before', async () => {
    const fresh = await inboundAgo(2, '+919876540001');       // 2 min: far too soon
    const due = await inboundAgo(90, '+919876540002');         // 90 min: past the 60 max
    const sent = await sweepReadReceipts(ctx());
    expect(sent).toBe(1);
    expect(provider.readCalls).toHaveLength(1);
    expect(provider.readCalls[0]!.to.phoneE164).toBe('+919876540002');
    const rows = await db.execute(sql`SELECT id, read_at FROM message WHERE id IN (${fresh}, ${due})`) as unknown as Array<{ id: string; read_at: string | null }>;
    expect(rows.find((r) => r.id === due)!.read_at).not.toBeNull();
    expect(rows.find((r) => r.id === fresh)!.read_at).toBeNull();
    expect(await sweepReadReceipts(ctx())).toBe(0);             // not sent twice
  });

  it('sends at most 3 per sender per sweep — a backlog is a trickle, not a burst', async () => {
    for (let i = 0; i < 6; i++) await inboundAgo(90, `+91987654010${String(i)}`);
    expect(await sweepReadReceipts(ctx())).toBe(3);
    expect(await sweepReadReceipts(ctx())).toBe(3);
    expect(await sweepReadReceipts(ctx())).toBe(0);
  });

  it('never touches week-old messages', async () => {
    await inboundAgo(7 * 24 * 60, '+919876540201');
    expect(await sweepReadReceipts(ctx())).toBe(0);
    expect(provider.readCalls).toHaveLength(0);
  });

  it('does nothing when switched off, or in the number\'s quiet hours', async () => {
    await inboundAgo(90, '+919876540301');
    expect(await sweepReadReceipts(ctx({ readReceipts: false }))).toBe(0);
    // 03:00 local in Asia/Kolkata = 21:30 UTC the day before
    const night = new Date('2026-10-05T21:30:00Z');
    expect(await sweepReadReceipts(
      ctx({ limits: { perMinute: 8, perDay: 1500, circadianTimezone: 'Asia/Kolkata' } }), night
    )).toBe(0);
  });

  it('leaves the message unread when the socket is closed, so it is retried', async () => {
    const id = await inboundAgo(90, '+919876540401');
    await provider.disconnect(senderId);
    expect(await sweepReadReceipts(ctx())).toBe(0);
    const row = (await db.execute(sql`SELECT read_at FROM message WHERE id = ${id}`) as unknown as Array<{ read_at: string | null }>)[0]!;
    expect(row.read_at).toBeNull();
  });
});
