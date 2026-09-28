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
 * Creating a contact over HTTP (POST /contacts).
 *
 * The endpoint that finally backs the `contacts:write` scope. The cases that matter: a number
 * written any way becomes one contact not three (M8), a create never silently merges into an
 * existing person (409, not a quiet upsert), and identities are scoped per org.
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
let keyA: string;
let keyB: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgs = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','contacts-a'), ('b','contacts-b') RETURNING id, slug`)
  ) as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'contacts-a')!.id;
  orgB = orgs.find((o) => o.slug === 'contacts-b')!.id;
  keyA = (await issueApiKey(db, { orgId: orgA, name: 'a', scopes: ['contacts:read', 'contacts:write'] })).secret;
  keyB = (await issueApiKey(db, { orgId: orgB, name: 'b', scopes: ['contacts:write'] })).secret;
});

const post = (body: object, key = keyA) =>
  request(app).post('/api/v1/contacts').set('Authorization', `Bearer ${key}`).send(body);

describe('creating a contact', () => {
  it('creates one from a phone, normalising the number', async () => {
    const r = await post({ displayName: 'Priya', phone: '09876500001' });
    expect(r.status).toBe(201);
    expect(r.body.data.displayName).toBe('Priya');
    // Stored in E.164, not as typed.
    expect(r.body.data.identities).toContainEqual({ kind: 'phone', value: '+919876500001' });
  });

  it('creates one from an email alone', async () => {
    const r = await post({ email: 'Someone@Example.com' });
    expect(r.status).toBe(201);
    expect(r.body.data.identities).toContainEqual({ kind: 'email', value: 'someone@example.com' });
  });

  it('stores custom fields and an external ref (the host-app hook)', async () => {
    const r = await post({ phone: '+919876500002', externalRef: { candidateId: 'cand_42' }, customFields: { tier: 'gold' } });
    expect(r.status).toBe(201);
    const row = (await db.execute(sql`
      SELECT external_ref AS "externalRef", custom_fields AS "customFields"
      FROM contact WHERE id = ${r.body.data.id}`)
    ) as unknown as Array<{ externalRef: unknown; customFields: unknown }>;
    expect(row[0]!.externalRef).toEqual({ candidateId: 'cand_42' });
    expect(row[0]!.customFields).toEqual({ tier: 'gold' });
  });

  it('refuses a contact with no phone and no email', async () => {
    const r = await post({ displayName: 'Nobody' });
    expect(r.status).toBe(422);
  });

  it('refuses an unparseable phone', async () => {
    const r = await post({ phone: 'not-a-phone' });
    expect(r.status).toBe(422);
    expect(r.body.code).toMatch(/^PHONE_/);
  });
});

describe('the same person is not created twice', () => {
  it('409s when the phone already names a contact, however it is written', async () => {
    const first = await post({ phone: '9876500009' });
    expect(first.status).toBe(201);
    // Same number, different formatting — normalisation makes it the same identity (M8).
    const again = await post({ phone: '+91 98765 00009' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONTACT_EXISTS');
    expect(again.body.existingContactId).toBe(first.body.data.id);
  });

  it('scopes identities per org — another tenant may hold the same number', async () => {
    await post({ phone: '+919876500010' }, keyA);
    const other = await post({ phone: '+919876500010' }, keyB);
    expect(other.status).toBe(201);
  });
});
