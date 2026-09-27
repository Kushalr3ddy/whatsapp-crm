import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Single-conversation fetch and mark-read (F3).
 *
 * `GET /conversations/:id` is what lets a thread past the recent 100 be opened at all; mark-read
 * (explicit, and as a side effect of opening a thread) is what finally resets an unread count
 * that until now only ever grew.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgA: string;
let orgB: string;
let convA: string;
let keyA: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** Seeds a conversation for an org with a starting unread count, returns its id. */
async function seed(orgId: string, unread: number): Promise<string> {
  const s = (await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status)
    VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const c = (await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  return ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id, unread_count)
    VALUES (${orgId}, ${c[0]!.id}, ${s[0]!.id}, ${unread}) RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgs = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','read-a'), ('b','read-b') RETURNING id, slug`)
  ) as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'read-a')!.id;
  orgB = orgs.find((o) => o.slug === 'read-b')!.id;
  convA = await seed(orgA, 3);
  keyA = (await issueApiKey(db, {
    orgId: orgA, name: 'read-a', scopes: ['conversations:read']
  })).secret;
});

describe('GET /conversations/:id', () => {
  it('returns one conversation by id', async () => {
    const r = await request(app).get(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(convA);
    expect(r.body.data.unreadCount).toBe(3);
  });

  it('is a 404 for another org’s conversation', async () => {
    const convB = await seed(orgB, 1);
    const r = await request(app).get(`/api/v1/conversations/${convB}`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(404);
  });

  it('rejects a malformed id with 422', async () => {
    const r = await request(app).get('/api/v1/conversations/not-a-uuid')
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(422);
  });
});

describe('mark-read', () => {
  it('POST /read clears the unread count', async () => {
    const r = await request(app).post(`/api/v1/conversations/${convA}/read`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(200);
    expect(r.body.data.unreadCount).toBe(0);

    const after = await request(app).get(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it('opening a thread (GET messages) also clears it', async () => {
    // In reality unread only rises because an inbound message arrived, so a real thread with
    // unread > 0 always has a message to read. Mirror that, since the reset rides along with the
    // read audit that fires only when the thread has messages.
    await db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, content_type, status, sent_by)
      VALUES (${orgA}, ${convA}, 'inbound', 'text', 'delivered', 'system')`);
    await request(app).get(`/api/v1/conversations/${convA}/messages`)
      .set('Authorization', `Bearer ${keyA}`);
    const after = await request(app).get(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it('POST /read on another org’s conversation is a 404', async () => {
    const convB = await seed(orgB, 2);
    const r = await request(app).post(`/api/v1/conversations/${convB}/read`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(404);
  });
});
