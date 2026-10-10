import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { linkLidToPhone, storeInboundMessage } from '@crm/core';

/**
 * A person messaging from a WhatsApp privacy address (`…@lid`) arrives with no number. When
 * WhatsApp tells us the number, the two must become one contact — whichever order we met them in.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const LID = '44887374303340@lid';
const PHONE = '+919876500001';

let db: Database;
let orgId: string;
let senderId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('l','lid') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
});

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const inbound = (from: { phone: string | null; address: string }, id: string) =>
  storeInboundMessage(db, kms, {
    orgId, senderIdentityId: senderId, providerMessageId: id, fromPhoneE164: from.phone,
    fromProviderAddress: from.address, body: 'hello', contentType: 'text', receivedAt: new Date()
  });
const identities = async (contactId: string) => rows<{ kind: string; value: string; primary: boolean }>(sql`
  SELECT kind, value_normalized AS value, is_primary AS primary FROM contact_identity
  WHERE contact_id = ${contactId} ORDER BY kind`);

describe('linking a privacy address to a phone number', () => {
  it('gives a number-less contact its phone, and a readable name', async () => {
    const m = await inbound({ phone: null, address: LID }, 'm1');
    expect(await linkLidToPhone(db, orgId, { lid: LID, phoneE164: PHONE })).toBe('linked');

    const ids = await identities(m.contactId);
    expect(ids).toEqual([
      { kind: 'phone', value: PHONE, primary: true },
      { kind: 'wa_lid', value: LID, primary: false }
    ]);
    const c = (await rows<{ name: string }>(sql`SELECT display_name AS name FROM contact WHERE id = ${m.contactId}`))[0]!;
    expect(c.name).toBe(PHONE);
    // The next message from either address lands on the same contact and thread.
    const again = await inbound({ phone: PHONE, address: '919876500001@s.whatsapp.net' }, 'm2');
    const viaLid = await inbound({ phone: null, address: LID }, 'm3');
    expect(again.contactId).toBe(m.contactId);
    expect(viaLid.contactId).toBe(m.contactId);
    expect(viaLid.conversationId).toBe(m.conversationId);
  });

  it('adds the privacy address to an existing phone contact, and is idempotent', async () => {
    const m = await inbound({ phone: PHONE, address: '919876500001@s.whatsapp.net' }, 'm1');
    expect(await linkLidToPhone(db, orgId, { lid: LID, phoneE164: PHONE })).toBe('linked');
    expect(await linkLidToPhone(db, orgId, { lid: LID, phoneE164: PHONE })).toBe('already_linked');
    expect((await identities(m.contactId)).map((i) => i.kind)).toEqual(['phone', 'wa_lid']);
  });

  it('does nothing when neither address is known yet', async () => {
    expect(await linkLidToPhone(db, orgId, { lid: LID, phoneE164: PHONE })).toBe('nothing_to_link');
  });

  it('merges two contacts that turn out to be one person, keeping everything', async () => {
    // The same person, met twice: once by number, once by privacy address — with a thread each on
    // the same sender, a tag each, and one of them flagged do-not-contact.
    const byPhone = await inbound({ phone: PHONE, address: '919876500001@s.whatsapp.net' }, 'p1');
    const byLid = await inbound({ phone: null, address: LID }, 'l1');
    expect(byPhone.contactId).not.toBe(byLid.contactId);
    await inbound({ phone: null, address: LID }, 'l2');

    const tagA = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'a') RETURNING id`))[0]!.id;
    const tagB = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'b') RETURNING id`))[0]!.id;
    await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES
      (${orgId}, ${byPhone.contactId}, ${tagA}), (${orgId}, ${byLid.contactId}, ${tagB})`);
    await db.execute(sql`UPDATE contact SET do_not_contact = true, dnc_reason = 'asked' WHERE id = ${byLid.contactId}`);
    await db.execute(sql`INSERT INTO internal_note (org_id, conversation_id, body)
      VALUES (${orgId}, ${byLid.conversationId}, 'a note')`);

    expect(await linkLidToPhone(db, orgId, { lid: LID, phoneE164: PHONE })).toBe('merged');

    // One live contact, with both addresses, both tags, the flag, one thread holding every message.
    const live = await rows<{ id: string; dnc: boolean }>(sql`
      SELECT id, do_not_contact AS dnc FROM contact WHERE org_id = ${orgId} AND deleted_at IS NULL`);
    expect(live).toEqual([{ id: byPhone.contactId, dnc: true }]);
    expect((await identities(byPhone.contactId)).map((i) => i.kind)).toEqual(['phone', 'wa_lid']);
    const tags = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact_tag WHERE contact_id = ${byPhone.contactId}`);
    expect(tags[0]!.n).toBe(2);
    const threads = await rows<{ id: string; messages: number }>(sql`
      SELECT v.id, (SELECT count(*)::int FROM message m WHERE m.conversation_id = v.id) AS messages
      FROM conversation v WHERE v.contact_id = ${byPhone.contactId}`);
    expect(threads).toEqual([{ id: byPhone.conversationId, messages: 3 }]);
    const notes = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM internal_note WHERE conversation_id = ${byPhone.conversationId}`);
    expect(notes[0]!.n).toBe(1);
    const audit = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'contact.merged'`);
    expect(audit[0]!.n).toBe(1);
  });
});

describe('the fake provider carries a linked number on an inbound event', () => {
  it('exposes linkedPhoneE164 for the gateway to act on', async () => {
    const p = new FakeChannelProvider();
    p.receiveMessage({ senderId, fromProviderAddress: LID, linkedPhoneE164: PHONE, body: 'hi' });
    const it = p.inbound()[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value.linkedPhoneE164).toBe(PHONE);
    expect(first.value.fromPhoneE164).toBeNull();
  });
});
