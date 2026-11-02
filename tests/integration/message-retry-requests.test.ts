import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, createSession, markDecryptBurst, markOwnDecryptBurst, recordRetryRequest } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * D-101 and D-102: when a recipient's phone could not decrypt a message ("Waiting for this message"), the message says so instead of
 * a bare "delivered"; and a broken encryption session is said on the thread, with the owner's own-device failures kept out of the ban score.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let conv: string;
let session: Record<string, string>;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

async function addOutbound(providerId: string, status: string): Promise<string> {
  const body = 'Hello';
  return (await rows<{ id: string }>(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, provider_message_id, sent_by, sent_at)
    VALUES (${orgId}, ${conv}, 'outbound', ${status}, 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)},
            ${providerId}, 'system', now()) RETURNING id`))[0]!.id;
}
const thread = async () => (await request(app).get(`/api/v1/conversations/${conv}/messages`).set(session)).body.data as Array<{ retryRequests: number; lastRetryAt: string | null; status: string }>;
const senderStatus = async () => (await request(app).get(`/api/v1/conversations/${conv}/sender-status`).set(session)).body.data as { sessionTrouble: string | null };

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-retry', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  const t = (await createSession(db, { userId: org.userId, orgId })).token;
  session = { Cookie: `crm_session=${t}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
  senderId = (await rows<{ id: string }>(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
  const contact = (await rows<{ id: string }>(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Mikhil', 'test') RETURNING id`))[0]!.id;
  conv = (await rows<{ id: string }>(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contact}, ${senderId}) RETURNING id`))[0]!.id;
});

describe('a recipient who could not read a message', () => {
  it('is recorded on the message and shown in the thread, counting each request', async () => {
    await addOutbound('3EBAAA', 'delivered');
    expect((await thread())[0]).toMatchObject({ retryRequests: 0, lastRetryAt: null });
    expect(await recordRetryRequest(db, senderId, '3EBAAA', new Date())).toBe(true);
    expect(await recordRetryRequest(db, senderId, '3EBAAA', new Date())).toBe(true);
    const m = (await thread())[0]!;
    expect(m.retryRequests).toBe(2);
    expect(m.lastRetryAt).not.toBeNull();
  });

  it('does nothing for a message id we never sent, or one that belongs to another number', async () => {
    await addOutbound('3EBBBB', 'delivered');
    expect(await recordRetryRequest(db, senderId, 'NOT-OURS', new Date())).toBe(false);
    const other = (await rows<{ id: string }>(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'other', 'active') RETURNING id`))[0]!.id;
    expect(await recordRetryRequest(db, other, '3EBBBB', new Date())).toBe(false);
    expect((await thread())[0]!.retryRequests).toBe(0);
  });
});

describe('a broken encryption session', () => {
  it('is said on the thread: people\'s messages, then the owner\'s own devices, then nothing once it lapses', async () => {
    expect((await senderStatus()).sessionTrouble).toBeNull();
    await markOwnDecryptBurst(db, senderId, new Date());
    expect((await senderStatus()).sessionTrouble).toBe('own');
    await markDecryptBurst(db, senderId, new Date());
    expect((await senderStatus()).sessionTrouble).toBe('contacts');
    await db.execute(sql`UPDATE channel_session SET decrypt_burst_at = now() - interval '1 hour', own_decrypt_burst_at = now() - interval '1 hour' WHERE sender_identity_id = ${senderId}`);
    expect((await senderStatus()).sessionTrouble).toBeNull();
  });
});
