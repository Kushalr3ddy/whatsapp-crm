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
    // Custom fields are a fixed vocabulary now: `tier` must be defined before it can be set.
    await db.execute(sql`INSERT INTO custom_field (org_id, key, label) VALUES (${orgA}, 'tier', 'Tier')`);
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

const list = (q?: string, key = keyA) =>
  request(app)
    .get(`/api/v1/contacts${q !== undefined ? `?q=${encodeURIComponent(q)}` : ''}`)
    .set('Authorization', `Bearer ${key}`);

const listBy = (qs: string, key = keyA) =>
  request(app).get(`/api/v1/contacts?${qs}`).set('Authorization', `Bearer ${key}`);

describe('ordering and date ranges', () => {
  let priya: string;
  let rahul: string;
  beforeEach(async () => {
    priya = (await post({ displayName: 'Priya Sharma', phone: '+919876500100' })).body.data.id;
    rahul = (await post({ displayName: 'Anil Verma', phone: '+919876500200' })).body.data.id;
    await db.execute(sql`UPDATE contact SET created_at = '2026-01-10T12:00:00Z' WHERE id = ${priya}`);
    await db.execute(sql`UPDATE contact SET created_at = '2026-03-05T12:00:00Z' WHERE id = ${rahul}`);
  });

  const names = (r: { body: { data: Array<{ displayName: string }> } }) => r.body.data.map((c) => c.displayName);

  it('orders newest first by default, oldest first, or by name', async () => {
    expect(names(await listBy(''))).toEqual(['Anil Verma', 'Priya Sharma']);
    expect(names(await listBy('sort=added_asc'))).toEqual(['Priya Sharma', 'Anil Verma']);
    expect(names(await listBy('sort=name_asc'))).toEqual(['Anil Verma', 'Priya Sharma']);
  });

  it('limits by the day added, both ends included', async () => {
    expect(names(await listBy('from=2026-03-05'))).toEqual(['Anil Verma']);
    expect(names(await listBy('to=2026-01-10'))).toEqual(['Priya Sharma']);
    expect(names(await listBy('from=2026-01-10&to=2026-03-05'))).toHaveLength(2);
    expect(names(await listBy('from=2026-02-01&to=2026-02-28'))).toEqual([]);
  });

  it('refuses a date that is not a day', async () => {
    expect((await listBy('from=yesterday')).status).toBe(422);
  });

  it('limits and orders by the day last imported, and shows it', async () => {
    const run = (await db.execute(sql`
      INSERT INTO import_run(org_id, byte_size, sha256, storage_key, created_at)
      VALUES (${orgA}, 1, 'a', 'k', '2026-04-20T09:00:00Z') RETURNING id`)) as unknown as Array<{ id: string }>;
    await db.execute(sql`
      INSERT INTO import_row(import_run_id, org_id, row_number, outcome, contact_id)
      VALUES (${run[0]!.id}, ${orgA}, 1, 'created', ${priya})`);
    const inRange = await listBy('dateBy=imported&from=2026-04-01&to=2026-04-30');
    expect(names(inRange)).toEqual(['Priya Sharma']);
    expect(inRange.body.data[0].lastImportedAt).toContain('2026-04-20');
    expect(names(await listBy('dateBy=imported&from=2026-05-01'))).toEqual([]);
    expect(names(await listBy('sort=imported_desc'))).toEqual(['Priya Sharma', 'Anil Verma']);
  });

  it('counts the same people the list shows', async () => {
    const c = await request(app).get('/api/v1/contacts/count?from=2026-03-01')
      .set('Authorization', `Bearer ${keyA}`);
    expect(c.body.data.total).toBe(1);
  });
});

describe('listing and searching contacts', () => {
  beforeEach(async () => {
    await post({ displayName: 'Priya Sharma', phone: '+919876500100', email: 'priya@example.com' });
    await post({ displayName: 'Rahul Verma', phone: '+919876500200' });
  });

  it('lists the org\'s contacts, newest first, each with its identities', async () => {
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data[0].displayName).toBe('Rahul Verma');   // created last, so first
    const priya = r.body.data.find((c: { displayName: string }) => c.displayName === 'Priya Sharma');
    expect(priya.identities).toContainEqual({ kind: 'phone', value: '+919876500100' });
    expect(priya.identities).toContainEqual({ kind: 'email', value: 'priya@example.com' });
  });

  it('searches by name (case-insensitive substring)', async () => {
    const r = await list('priya');
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].displayName).toBe('Priya Sharma');
  });

  it('searches by a phone substring', async () => {
    const r = await list('500200');
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].displayName).toBe('Rahul Verma');
  });

  it('searches by email', async () => {
    const r = await list('priya@example');
    expect(r.body.data).toHaveLength(1);
  });

  it('returns an empty list for a non-match, not an error', async () => {
    const r = await list('zzzznomatch');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('never returns another org\'s contacts', async () => {
    // Org B created nothing, so its own read sees nothing — even though org A has "priya".
    const keyBread = (await issueApiKey(db, { orgId: orgB, name: 'bread', scopes: ['contacts:read'] })).secret;
    const r = await list('priya', keyBread);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});
