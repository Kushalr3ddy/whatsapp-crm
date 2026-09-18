import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { storeInboundMessage, applyDeliveryStatus, markMessageSent, markMessageFailed } from '@crm/core';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});

let db: Database;
let orgId: string;
let senderId: string;

/** Builds an inbound message, with a fresh provider id unless one is given. */
function inbound(over: Partial<Parameters<typeof storeInboundMessage>[2]> = {}) {
  return {
    orgId, senderIdentityId: senderId,
    providerMessageId: over.providerMessageId ?? `wamid.${randomUUID()}`,
    fromPhoneE164: '+919876500001', fromProviderAddress: '919876500001@s.whatsapp.net',
    body: 'hello', contentType: 'text', receivedAt: new Date(),
    ...over
  };
}

beforeAll(async () => { db = createDatabase(url, { max: 8 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'t',${'t-' + orgId.slice(0, 8)})`);
  const rows = await db.execute(sql`
    INSERT INTO sender_identity(org_id,provider,label) VALUES (${orgId},'fake','n') RETURNING id`);
  senderId = (rows as unknown as Array<{ id: string }>)[0]!.id;
});

describe('storeInboundMessage', () => {
  it('creates the contact, the conversation and the message for an unknown number', async () => {
    const r = await storeInboundMessage(db, kms, inbound());
    expect(r.isNew).toBe(true);
    expect(r.contactId).toBeTruthy();
    expect(r.conversationId).toBeTruthy();
  });

  it('reuses the contact and conversation on the second message', async () => {
    const a = await storeInboundMessage(db, kms, inbound());
    const b = await storeInboundMessage(db, kms, inbound({ body: 'again' }));
    expect(b.contactId).toBe(a.contactId);
    expect(b.conversationId).toBe(a.conversationId);
  });

  it('treats a redelivered message as a no-op', async () => {
    // WhatsApp retries notifications for up to seven days. The second call must not store a
    // second copy — and must say so, so a caller does not re-run side effects.
    const id = `wamid.${randomUUID()}`;
    expect((await storeInboundMessage(db, kms, inbound({ providerMessageId: id }))).isNew).toBe(true);
    expect((await storeInboundMessage(db, kms, inbound({ providerMessageId: id }))).isNew).toBe(false);
    const n = await db.execute(sql`SELECT count(*)::int AS c FROM message WHERE org_id = ${orgId}`);
    expect((n as unknown as Array<{ c: number }>)[0]!.c).toBe(1);
  });

  it('does NOT create duplicates when messages arrive at the same instant', async () => {
    // The M13 case. The previous system did find-then-insert and needed an in-process lock,
    // which stopped working the moment there was more than one process. Doing it in one
    // statement means the database arbitrates instead.
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      storeInboundMessage(db, kms, inbound({ body: `concurrent ${String(i)}` }))
    ));
    const c = await db.execute(sql`SELECT count(*)::int AS c FROM contact WHERE org_id = ${orgId}`);
    const v = await db.execute(sql`SELECT count(*)::int AS c FROM conversation WHERE org_id = ${orgId}`);
    const m = await db.execute(sql`SELECT count(*)::int AS c FROM message WHERE org_id = ${orgId}`);
    expect((c as unknown as Array<{ c: number }>)[0]!.c).toBe(1);
    expect((v as unknown as Array<{ c: number }>)[0]!.c).toBe(1);
    expect((m as unknown as Array<{ c: number }>)[0]!.c).toBe(8);
  });

  it('stores a privacy address as its own identity kind, not as a phone', async () => {
    await storeInboundMessage(db, kms, inbound({
      fromPhoneE164: null, fromProviderAddress: '2894718@lid'
    }));
    const rows = await db.execute(sql`
      SELECT kind, value_normalized FROM contact_identity WHERE org_id = ${orgId}`);
    expect((rows as unknown as Array<{ kind: string; value_normalized: string }>)[0])
      .toEqual({ kind: 'wa_lid', value_normalized: '2894718@lid' });
  });

  it('encrypts the body — the plaintext is not in the row', async () => {
    await storeInboundMessage(db, kms, inbound({ body: 'MY_BANK_OTP_889912' }));
    const rows = await db.execute(sql`
      SELECT encode(body_enc,'escape') AS v FROM message WHERE org_id = ${orgId}`);
    expect((rows as unknown as Array<{ v: string }>)[0]!.v).not.toContain('MY_BANK_OTP_889912');
  });

  it('increments unread and reopens a closed conversation', async () => {
    const a = await storeInboundMessage(db, kms, inbound());
    await db.execute(sql`UPDATE conversation SET status='closed' WHERE id=${a.conversationId}`);
    await storeInboundMessage(db, kms, inbound({ body: 'back again' }));
    const rows = await db.execute(sql`
      SELECT status, unread_count FROM conversation WHERE id = ${a.conversationId}`);
    const row = (rows as unknown as Array<{ status: string; unread_count: number }>)[0]!;
    expect(row.status).toBe('open');
    expect(row.unread_count).toBe(2);
  });

  it('keeps orgs apart — the same number is a different person in another org', async () => {
    await storeInboundMessage(db, kms, inbound());
    const otherOrg = randomUUID();
    await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${otherOrg},'o',${'o-' + otherOrg.slice(0, 8)})`);
    const s2 = await db.execute(sql`
      INSERT INTO sender_identity(org_id,provider,label) VALUES (${otherOrg},'fake','n2') RETURNING id`);
    await storeInboundMessage(db, kms, {
      ...inbound(), orgId: otherOrg,
      senderIdentityId: (s2 as unknown as Array<{ id: string }>)[0]!.id
    });
    // Scoped to these two orgs specifically. Counting globally would also pick up rows left
    // by earlier tests in this same database.
    const rows = await db.execute(sql`
      SELECT count(*)::int AS c FROM contact_identity
      WHERE value_normalized = '+919876500001' AND org_id IN (${orgId}, ${otherOrg})`);
    expect((rows as unknown as Array<{ c: number }>)[0]!.c).toBe(2);
  });
});

describe('delivery status', () => {
  it('advances a message through sent, delivered and read', async () => {
    const r = await storeInboundMessage(db, kms, inbound());
    const out = await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, provider_message_id)
      VALUES (${orgId}, ${r.conversationId}, 'outbound', 'queued', 'wamid.out1') RETURNING id`);
    const id = (out as unknown as Array<{ id: string }>)[0]!.id;

    await markMessageSent(db, id, 'wamid.out1');
    for (const s of ['delivered', 'read'] as const) {
      await applyDeliveryStatus(db, orgId, 'wamid.out1', s);
    }
    const rows = await db.execute(sql`SELECT status, delivered_at, read_at FROM message WHERE id=${id}`);
    const row = (rows as unknown as Array<{ status: string; delivered_at: Date; read_at: Date }>)[0]!;
    expect(row.status).toBe('read');
    expect(row.delivered_at).not.toBeNull();
    expect(row.read_at).not.toBeNull();
  });

  it('never moves a message backwards when receipts arrive out of order', async () => {
    // Receipts do arrive late and out of order. A stale 'sent' must not undo a 'read'.
    const r = await storeInboundMessage(db, kms, inbound());
    const out = await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, provider_message_id)
      VALUES (${orgId}, ${r.conversationId}, 'outbound', 'queued', 'wamid.out2') RETURNING id`);
    const id = (out as unknown as Array<{ id: string }>)[0]!.id;
    await applyDeliveryStatus(db, orgId, 'wamid.out2', 'read');
    await applyDeliveryStatus(db, orgId, 'wamid.out2', 'sent');
    const rows = await db.execute(sql`SELECT status FROM message WHERE id=${id}`);
    expect((rows as unknown as Array<{ status: string }>)[0]!.status).toBe('read');
  });

  it('records a failure against the one message without affecting anything else', async () => {
    const r = await storeInboundMessage(db, kms, inbound());
    const out = await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status)
      VALUES (${orgId}, ${r.conversationId}, 'outbound', 'queued') RETURNING id`);
    const id = (out as unknown as Array<{ id: string }>)[0]!.id;
    await markMessageFailed(db, id, 'recipient_not_on_whatsapp');
    const rows = await db.execute(sql`SELECT status, error_code FROM message WHERE id=${id}`);
    const row = (rows as unknown as Array<{ status: string; error_code: string }>)[0]!;
    expect(row.status).toBe('failed');
    expect(row.error_code).toBe('recipient_not_on_whatsapp');
  });
});
