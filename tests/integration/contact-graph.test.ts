import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  checkContactGraph, classifyRelationship, relationshipDelayMultiplier
} from '@crm/core';
import { createLogger } from '@crm/shared';
import { handleSend, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * Contact-graph gates (P6, `docs/08-antiban.md`). Messaging strangers who have never interacted
 * with you is one of the two strongest ban signals, so these tests prove the relationship is read
 * from real message history and that cold-outreach volume is actually capped.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let orgId: string;
let senderId: string;

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('g','graph') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  // Warmed 30 days ago, so layers 1–2 never interfere with these relationship tests.
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'grapher', '+919000000001', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Creates a contact and its conversation on this sender. Returns both ids. */
async function newContact(phone: string): Promise<{ contactId: string; conversationId: string }> {
  const contactId = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'them', 'test')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', ${phone}, true)`);
  const conversationId = (await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  return { contactId, conversationId };
}

/** Records one outbound message as already sent, `ago` ms in the past. */
async function sentOutbound(conversationId: string, ago: number): Promise<void> {
  const at = new Date(Date.now() - ago).toISOString();
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                         provider_message_id, sent_at, created_at)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'sent', 'text',
            ${`out-${randomUUID()}`}, ${at}, ${at})`);
}

/** Records one inbound message — the thing that makes a contact "known". */
async function inbound(conversationId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                         provider_message_id, created_at)
    VALUES (${orgId}, ${conversationId}, 'inbound', 'delivered', 'text',
            ${`in-${randomUUID()}`}, now())`);
}

/** Queues one outbound message and returns its id, for the send-path integration tests. */
async function queueOutbound(conversationId: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))})
    RETURNING id`);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}

const generous = { newContactsPerHour: 100, newContactsPerDay: 500 };

describe('relationship classification (pure)', () => {
  it('a reply makes a contact known, whatever else is true', () => {
    expect(classifyRelationship(true, false)).toBe('known');
    expect(classifyRelationship(true, true)).toBe('known');
  });

  it('outbound-only is "contacted"; nothing at all is a "stranger"', () => {
    expect(classifyRelationship(false, true)).toBe('contacted');
    expect(classifyRelationship(false, false)).toBe('stranger');
  });

  it('a reply earns full speed; a stranger waits 2.5×', () => {
    expect(relationshipDelayMultiplier('known')).toBe(1.0);
    expect(relationshipDelayMultiplier('contacted')).toBe(1.8);
    expect(relationshipDelayMultiplier('stranger')).toBe(2.5);
  });
});

describe('reading the relationship from real history', () => {
  it('treats a contact who has replied as known (full speed)', async () => {
    const { contactId, conversationId } = await newContact('+919876500001');
    await sentOutbound(conversationId, 5 * 60_000);
    await inbound(conversationId);

    const decision = await checkContactGraph(db, senderId, contactId, generous);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.relationship).toBe('known');
      expect(decision.delayMultiplier).toBe(1.0);
    }
  });

  it('treats an outbound-only contact as "contacted" (1.8×)', async () => {
    const { contactId, conversationId } = await newContact('+919876500002');
    await sentOutbound(conversationId, 5 * 60_000);

    const decision = await checkContactGraph(db, senderId, contactId, generous);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.relationship).toBe('contacted');
  });

  it('treats a never-touched contact as a stranger (2.5×)', async () => {
    const { contactId } = await newContact('+919876500003');

    const decision = await checkContactGraph(db, senderId, contactId, generous);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.relationship).toBe('stranger');
      expect(decision.delayMultiplier).toBe(2.5);
    }
  });
});

describe('the new-contact throttle', () => {
  it('refuses a fresh stranger once the hourly cap is used', async () => {
    // Three strangers already started this hour, then a fourth cold contact. With a cap of 3 the
    // fourth is held back — this is the gate that actually stops a list being blasted.
    for (let i = 0; i < 3; i++) {
      const c = await newContact(`+91987650010${String(i)}`);
      await sentOutbound(c.conversationId, 10 * 60_000);   // within the hour
    }
    const fourth = await newContact('+919876501111');

    const decision = await checkContactGraph(
      db, senderId, fourth.contactId, { newContactsPerHour: 3, newContactsPerDay: 500 }
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('new_contact_throttle');
      expect(decision.detail).toContain('hourly');
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('still lets a KNOWN contact through when the stranger cap is hit', async () => {
    // The throttle caps *new* conversations, not replies. Someone who has answered is not a cold
    // contact and must not be caught by a stranger cap.
    for (let i = 0; i < 3; i++) {
      const c = await newContact(`+91987650020${String(i)}`);
      await sentOutbound(c.conversationId, 10 * 60_000);
    }
    const known = await newContact('+919876502222');
    await sentOutbound(known.conversationId, 20 * 60_000);
    await inbound(known.conversationId);

    const decision = await checkContactGraph(
      db, senderId, known.contactId, { newContactsPerHour: 3, newContactsPerDay: 500 }
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.relationship).toBe('known');
  });

  it('refuses on the daily cap even when the hour has room', async () => {
    // First outbounds spread across the day but older than an hour: they do not count against the
    // hourly window, but they do fill the daily one.
    for (let i = 0; i < 3; i++) {
      const c = await newContact(`+91987650030${String(i)}`);
      await sentOutbound(c.conversationId, 3 * 60 * 60_000);   // 3h ago: today, not this hour
    }
    const fourth = await newContact('+919876503333');

    const decision = await checkContactGraph(
      db, senderId, fourth.contactId, { newContactsPerHour: 100, newContactsPerDay: 3 }
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.detail).toContain('daily');
  });
});

describe('the gate in the send path', () => {
  /** A work context with an instant sleep and the contact-graph gate turned on. */
  function ctxWith(contactGraph: { newContactsPerHour: number; newContactsPerDay: number }): WorkContext {
    return {
      db, provider: new FakeChannelProvider(), logger,
      decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
      limits: { perMinute: 8, perDay: 1500 },   // no circadianTimezone: circadian stays off here
      contactGraph,
      sleep: async () => { await Promise.resolve(); }
    };
  }

  it('leaves a throttled stranger send queued rather than failing it', async () => {
    // One new stranger already started this hour; the cap is one, so a send to a second cold
    // contact must wait, not fail.
    const first = await newContact('+919876504001');
    await sentOutbound(first.conversationId, 10 * 60_000);
    const second = await newContact('+919876504002');
    const messageId = await queueOutbound(second.conversationId);

    const ctx = ctxWith({ newContactsPerHour: 1, newContactsPerDay: 500 });
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

  it('sends to a known contact even while the stranger cap is exhausted', async () => {
    const strangerA = await newContact('+919876505001');
    await sentOutbound(strangerA.conversationId, 10 * 60_000);
    const known = await newContact('+919876505002');
    await sentOutbound(known.conversationId, 20 * 60_000);
    await inbound(known.conversationId);
    const messageId = await queueOutbound(known.conversationId);

    const ctx = ctxWith({ newContactsPerHour: 1, newContactsPerDay: 500 });
    const provider = ctx.provider as FakeChannelProvider;
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });

    await handleSend(ctx, messageId);

    const rows = await db.execute(sql`SELECT status FROM message WHERE id = ${messageId}`);
    expect((rows as unknown as Array<{ status: string }>)[0]!.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
  });
});
