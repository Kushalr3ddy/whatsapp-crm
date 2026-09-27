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
 * Internal notes and saved replies (F3 chunk 2).
 *
 * The load-bearing test is that a note never enters the send path: it lives in `internal_note`,
 * the gateway only reads `message`, so "a note is never transmitted" (AC-4) is true by
 * construction. The rest guard tenancy — a note cannot be pinned to another org's thread, and
 * one org's saved replies are invisible to another.
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
let keyB: string;

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

/** Inserts a sender + contact + conversation for an org and returns the conversation id. */
async function seedConversation(orgId: string): Promise<string> {
  const s = (await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status)
    VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const c = (await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const v = (await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${c[0]!.id}, ${s[0]!.id}) RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  return v[0]!.id;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgs = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','note-a'), ('b','note-b') RETURNING id, slug`)
  ) as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'note-a')!.id;
  orgB = orgs.find((o) => o.slug === 'note-b')!.id;
  convA = await seedConversation(orgA);
  keyA = (await issueApiKey(db, {
    orgId: orgA, name: 'note-a', scopes: ['conversations:read', 'conversations:write']
  })).secret;
  keyB = (await issueApiKey(db, {
    orgId: orgB, name: 'note-b', scopes: ['conversations:read', 'conversations:write']
  })).secret;
});

describe('internal notes', () => {
  it('adds a note and lists it back', async () => {
    const created = await request(app).post(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyA}`).send({ body: 'called, will send CV tomorrow' });
    expect(created.status).toBe(201);

    const listed = await request(app).get(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyA}`);
    expect((listed.body.data as Array<{ body: string }>).map((n) => n.body))
      .toEqual(['called, will send CV tomorrow']);
  });

  it('never lets a note reach the message stream (AC-4)', async () => {
    await request(app).post(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyA}`).send({ body: 'internal only' });
    // The note is not a message: the thread the send path reads stays empty.
    const messages = await request(app).get(`/api/v1/conversations/${convA}/messages`)
      .set('Authorization', `Bearer ${keyA}`);
    expect(messages.body.data).toEqual([]);
    const count = (await db.execute(sql`SELECT count(*)::int AS n FROM message`)
    ) as unknown as Array<{ n: number }>;
    expect(count[0]!.n).toBe(0);
  });

  it('stores @mentions passed with a note', async () => {
    const uid = randomBytes(16).toString('hex').replace(
      /^(.{8})(.{4})(.{3})(.{3})(.{12}).*$/, '$1-$2-4$3-8$4-$5');
    const r = await request(app).post(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyA}`).send({ body: 'ping @kushal', mentions: [uid] });
    expect(r.status).toBe(201);
    expect(r.body.data.mentions).toEqual([uid]);
  });

  it('refuses a note on another org’s conversation with 404', async () => {
    const r = await request(app).post(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyB}`).send({ body: 'sneaky' });
    expect(r.status).toBe(404);
  });

  it('rejects an empty note', async () => {
    const r = await request(app).post(`/api/v1/conversations/${convA}/notes`)
      .set('Authorization', `Bearer ${keyA}`).send({ body: '' });
    expect(r.status).toBe(422);
  });
});

describe('canned replies', () => {
  it('creates one, lists it, and refuses a duplicate shortcut', async () => {
    const created = await request(app).post('/api/v1/canned-replies')
      .set('Authorization', `Bearer ${keyA}`).send({ shortcut: 'hi', body: 'Hello {{name}}' });
    expect(created.status).toBe(201);

    const dup = await request(app).post('/api/v1/canned-replies')
      .set('Authorization', `Bearer ${keyA}`).send({ shortcut: 'hi', body: 'Hi again' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SHORTCUT_TAKEN');

    const listed = await request(app).get('/api/v1/canned-replies')
      .set('Authorization', `Bearer ${keyA}`);
    expect((listed.body.data as Array<{ shortcut: string }>).map((c) => c.shortcut)).toEqual(['hi']);
  });

  it('keeps one org’s saved replies invisible to another', async () => {
    await request(app).post('/api/v1/canned-replies')
      .set('Authorization', `Bearer ${keyA}`).send({ shortcut: 'a-only', body: 'x' });
    const fromB = await request(app).get('/api/v1/canned-replies')
      .set('Authorization', `Bearer ${keyB}`);
    expect((fromB.body.data as Array<{ shortcut: string }>).map((c) => c.shortcut)).toEqual([]);
  });
});
