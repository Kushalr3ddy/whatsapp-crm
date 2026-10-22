import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { storeInboundMessage, storeOwnMessage, markMessageSent } from '@crm/core';

/**
 * R-010 (2026-10-22, area: gateway, found by: Kushal): messages the owner typed on their own phone never appeared in the inbox, because the
 * gateway dropped every message WhatsApp marked as sent by the owner (D-94). They are now stored as outbound messages from the phone.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });

let db: Database;
let orgId: string;
let senderId: string;

/** A message the owner sent from the phone to +91 98765 00001. */
function own(over: Partial<Parameters<typeof storeOwnMessage>[2]> = {}) {
  return {
    orgId, senderIdentityId: senderId, providerMessageId: over.providerMessageId ?? `wamid.${randomUUID()}`,
    toPhoneE164: '+919876500001', toProviderAddress: '919876500001@s.whatsapp.net',
    body: 'typed on my phone', contentType: 'text', sentAt: new Date('2026-10-22T07:14:00Z'), ...over
  };
}

/** Everything about the stored messages in this org, oldest first. */
async function messages() {
  return (await db.execute(sql`
    SELECT direction, status, sent_by AS "sentBy", provider_message_id AS "pid", created_at AS "createdAt"
    FROM message WHERE org_id = ${orgId} ORDER BY created_at`)) as unknown as Array<{
      direction: string; status: string; sentBy: string; pid: string; createdAt: Date }>;
}

beforeAll(async () => { db = createDatabase(url, { max: 8 }); });
afterAll(async () => { await db.$client.end(); });
beforeEach(async () => {
  orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'t',${'t-' + orgId.slice(0, 8)})`);
  senderId = ((await db.execute(sql`INSERT INTO sender_identity(org_id,provider,label) VALUES (${orgId},'fake','n') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

describe('a message the owner sent from their own phone', () => {
  it('[R-010] is stored as an outbound message from the phone, at WhatsApp\'s own time', async () => {
    const r = await storeOwnMessage(db, kms, own());
    expect(r.isNew).toBe(true);
    const [m] = await messages();
    expect(m).toMatchObject({ direction: 'outbound', status: 'sent', sentBy: 'phone' });
    expect(new Date(m!.createdAt).toISOString()).toBe('2026-10-22T07:14:00.000Z');
  });

  it('[R-010] lands in the same thread as the contact\'s own messages, without marking anything unread', async () => {
    const theirs = await storeInboundMessage(db, kms, {
      orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: '+919876500001',
      fromProviderAddress: '919876500001@s.whatsapp.net', body: 'hi', contentType: 'text', receivedAt: new Date('2026-10-22T07:10:00Z')
    });
    const mine = await storeOwnMessage(db, kms, own());
    expect(mine.conversationId).toBe(theirs.conversationId);
    expect(mine.contactId).toBe(theirs.contactId);
    const conv = (await db.execute(sql`SELECT unread_count AS "u", last_inbound_at AS "li", last_outbound_at AS "lo" FROM conversation WHERE id = ${theirs.conversationId}`)) as unknown as Array<{ u: number; li: Date; lo: Date }>;
    expect(conv[0]!.u).toBe(1);   // only their message is unread; ours added nothing
    expect(new Date(conv[0]!.li).toISOString()).toBe('2026-10-22T07:10:00.000Z');
    expect(new Date(conv[0]!.lo).toISOString()).toBe('2026-10-22T07:14:00.000Z');
  });

  it('[R-010] makes a contact for a person the CRM had never heard of', async () => {
    const r = await storeOwnMessage(db, kms, own({ toPhoneE164: '+34600000000', toProviderAddress: '34600000000@s.whatsapp.net' }));
    expect(r.isNew).toBe(true);
    const c = (await db.execute(sql`SELECT source FROM contact WHERE id = ${r.contactId}`)) as unknown as Array<{ source: string }>;
    expect(c[0]!.source).toBe('phone_message');
  });

  it('[R-010] is stored once however many times WhatsApp delivers it', async () => {
    const id = `wamid.${randomUUID()}`;
    expect((await storeOwnMessage(db, kms, own({ providerMessageId: id }))).isNew).toBe(true);
    expect((await storeOwnMessage(db, kms, own({ providerMessageId: id }))).isNew).toBe(false);
    expect(await messages()).toHaveLength(1);
  });

  it('[R-010] is not stored a second time when it is a message the CRM itself sent', async () => {
    // The CRM queues a message, sends it, and records WhatsApp's id; the echo of that send must not become a second row.
    const first = await storeInboundMessage(db, kms, {
      orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: '+919876500001',
      fromProviderAddress: '919876500001@s.whatsapp.net', body: 'hi', contentType: 'text', receivedAt: new Date()
    });
    const queued = (await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
      VALUES (${orgId}, ${first.conversationId}, 'outbound', 'queued', 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode('from the CRM')))}, ${kms.blindIndex('from the CRM')}, 'user')
      RETURNING id`)) as unknown as Array<{ id: string }>;
    const echoId = `wamid.${randomUUID()}`;
    await markMessageSent(db, queued[0]!.id, echoId);
    const echo = await storeOwnMessage(db, kms, own({ providerMessageId: echoId, body: 'from the CRM' }));
    expect(echo.isNew).toBe(false);
    expect((await messages()).filter((m) => m.direction === 'outbound')).toHaveLength(1);
  });
});
