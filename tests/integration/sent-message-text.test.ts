import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { sentMessageText } from '@crm/core';

/**
 * Giving back a message we sent when its recipient's phone could not decrypt it and asks for it again. Without it WhatsApp keeps showing
 * "Waiting for this message" on their side. Only our own text from the right number may be handed back.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });

let db: Database;
let orgId: string;
let senderA: string;
let senderB: string;
let convA: string;

beforeAll(() => { db = createDatabase(url, { max: 3 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = ((await db.execute(sql`INSERT INTO org(name, slug) VALUES ('r', 'resend') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const sender = async (label: string): Promise<string> => ((await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', ${label}, 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  senderA = await sender('a'); senderB = await sender('b');
  const contact = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  convA = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contact}, ${senderA}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Stores a message in the test conversation. */
async function store(direction: 'inbound' | 'outbound', contentType: string, body: string | null, providerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, provider_message_id)
    VALUES (${orgId}, ${convA}, ${direction}, 'sent', ${contentType},
            ${body === null ? null : Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${providerId})`);
}

describe('sentMessageText', () => {
  it('gives back the text of a message we sent from that number', async () => {
    await store('outbound', 'text', 'Hello there', 'WA-1');
    expect(await sentMessageText(db, kms, senderA, 'WA-1')).toBe('Hello there');
  });

  it('refuses anything else: another number, an unknown id, something we received, media', async () => {
    await store('outbound', 'text', 'Hello there', 'WA-1');
    await store('inbound', 'text', 'their words', 'WA-2');
    await store('outbound', 'image', null, 'WA-3');
    expect(await sentMessageText(db, kms, senderB, 'WA-1')).toBeUndefined();
    expect(await sentMessageText(db, kms, senderA, 'WA-missing')).toBeUndefined();
    expect(await sentMessageText(db, kms, senderA, 'WA-2')).toBeUndefined();
    expect(await sentMessageText(db, kms, senderA, 'WA-3')).toBeUndefined();
  });

  it('returns nothing, rather than failing, when the body no longer decrypts', async () => {
    await store('outbound', 'text', 'Hello there', 'WA-1');
    const otherKms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
    expect(await sentMessageText(db, otherKms, senderA, 'WA-1')).toBeUndefined();
  });
});
