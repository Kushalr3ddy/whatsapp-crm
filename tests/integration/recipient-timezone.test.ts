import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { timezoneForPhone } from '@crm/core';
import { createLogger } from '@crm/shared';
import { handleSend, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * Recipient-timezone inference (P6 Layer 3, docs/08-antiban.md): the recipient's day, read from
 * their number's country, is respected on top of the sender's own — and only ever adds caution.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let orgId: string;
let senderId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });
afterEach(() => { vi.useRealTimers(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('t','tz') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'indian', '+919000000003', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Queues one outbound message to a new contact at `phone`; returns the message id. */
async function queueTo(phone: string): Promise<string> {
  const contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'x', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', ${phone}, true)`);
  const conv = (await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  return (await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
    VALUES (${orgId}, ${conv}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
}

/** Sends with the sender on IST and recipient-timezone on or off; returns the final status. */
async function sendAt(iso: string, phone: string, recipientTimezone: boolean): Promise<string> {
  const id = await queueTo(phone);
  const provider = new FakeChannelProvider();
  await provider.connect({ id: senderId, phoneE164: '+919000000003' });
  const ctx: WorkContext = {
    db, provider, logger, decrypt: (c) => new TextDecoder().decode(kms.decrypt(c)),
    limits: { perMinute: 8, perDay: 1500, circadianTimezone: 'Asia/Kolkata' },
    recipientTimezone, sleep: async () => {}
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  await handleSend(ctx, id);
  vi.useRealTimers();
  return ((await db.execute(sql`SELECT status FROM message WHERE id = ${id}`)) as unknown as Array<{ status: string }>)[0]!.status;
}

describe('inferring a timezone from a number', () => {
  it('maps a number to its country\'s zone, and is null for the unknown', () => {
    expect(timezoneForPhone('+919876543210')).toBe('Asia/Kolkata');
    expect(timezoneForPhone('+447400123456')).toBe('Europe/London');
    expect(timezoneForPhone('+971501234567')).toBe('Asia/Dubai');
    expect(timezoneForPhone('+14155552671')).toBe('America/New_York');   // multi-zone: most populous
    expect(timezoneForPhone('+0000')).toBeNull();
    expect(timezoneForPhone('not a number')).toBeNull();
  });
});

describe('the recipient\'s day in the send path', () => {
  // 02:00 UTC = 07:30 IST (the sender is awake) = 03:00 in London (the recipient is asleep).
  const lateUk = '2026-10-05T02:00:00Z';

  it('defers a send that would land in the recipient\'s small hours', async () => {
    expect(await sendAt(lateUk, '+447400123456', true)).toBe('queued');
  });

  it('sends it when the feature is off — proving it was the recipient check that held it', async () => {
    expect(await sendAt(lateUk, '+447400123456', false)).toBe('sent');
  });

  it('does not touch a recipient in the sender\'s own zone', async () => {
    expect(await sendAt(lateUk, '+919876500001', true)).toBe('sent');
  });

  it('sends when the recipient is awake too (12:00 UTC: 17:30 IST, 13:00 London)', async () => {
    expect(await sendAt('2026-10-05T12:00:00Z', '+447400123456', true)).toBe('sent');
  });

  it('applies no adjustment for an unrecognised country', async () => {
    expect(await sendAt(lateUk, '+999123456789', true)).toBe('sent');
  });
});
