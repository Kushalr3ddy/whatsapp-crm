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
 * Tags and tagging (GET/POST /tags, POST/DELETE /contacts/:id/tags, and the tag filter on the
 * contacts list). The cases that matter: a tag name is unique per org, tagging is idempotent,
 * the filter narrows to the tagged set, and one org never sees or touches another's tags.
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
    INSERT INTO org(name,slug) VALUES ('a','tags-a'), ('b','tags-b') RETURNING id, slug`)
  ) as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'tags-a')!.id;
  orgB = orgs.find((o) => o.slug === 'tags-b')!.id;
  keyA = (await issueApiKey(db, { orgId: orgA, name: 'a', scopes: ['contacts:read', 'contacts:write'] })).secret;
  keyB = (await issueApiKey(db, { orgId: orgB, name: 'b', scopes: ['contacts:read', 'contacts:write'] })).secret;
});

const post = (path: string, body: object, key = keyA) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${key}`).send(body);
const get = (path: string, key = keyA) =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${key}`);
const del = (path: string, key = keyA) =>
  request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${key}`);

/** Creates a contact and returns its id. */
async function makeContact(name: string, phone: string, key = keyA): Promise<string> {
  const r = await post('/contacts', { displayName: name, phone }, key);
  return r.body.data.id as string;
}

describe('tags themselves', () => {
  it('creates a tag and lists it with a contact count', async () => {
    const c = await post('/tags', { name: 'pune', colour: 'blue' });
    expect(c.status).toBe(201);
    expect(c.body.data.name).toBe('pune');

    const list = await get('/tags');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'pune', contactCount: 0 });
  });

  it('409s on a duplicate name in the same org', async () => {
    await post('/tags', { name: 'vip' });
    const again = await post('/tags', { name: 'vip' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TAG_EXISTS');
  });

  it('lets a different org reuse the same tag name', async () => {
    await post('/tags', { name: 'vip' }, keyA);
    const other = await post('/tags', { name: 'vip' }, keyB);
    expect(other.status).toBe(201);
  });

  it('deletes a tag', async () => {
    const t = await post('/tags', { name: 'temp' });
    const d = await del(`/tags/${t.body.data.id}`);
    expect(d.status).toBe(204);
    expect((await get('/tags')).body.data).toHaveLength(0);
  });
});

describe('tagging contacts', () => {
  it('attaches a tag and shows it on the contact, idempotently', async () => {
    const contactId = await makeContact('Priya', '+919876511001');
    const tagId = (await post('/tags', { name: 'pune' })).body.data.id;

    expect((await post(`/contacts/${contactId}/tags`, { tagId })).status).toBe(204);
    // Attaching the same tag again is a no-op, not an error, and does not duplicate it.
    expect((await post(`/contacts/${contactId}/tags`, { tagId })).status).toBe(204);

    const list = await get('/contacts');
    const priya = list.body.data.find((c: { id: string }) => c.id === contactId);
    expect(priya.tags).toHaveLength(1);
    expect(priya.tags[0]).toMatchObject({ id: tagId, name: 'pune' });

    // The tag's contact count reflects the one tagging.
    expect((await get('/tags')).body.data[0].contactCount).toBe(1);
  });

  it('filters the contact list to a tag', async () => {
    const a = await makeContact('Tagged', '+919876511002');
    await makeContact('Untagged', '+919876511003');
    const tagId = (await post('/tags', { name: 'shortlist' })).body.data.id;
    await post(`/contacts/${a}/tags`, { tagId });

    const filtered = await get(`/contacts?tag=${tagId}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].id).toBe(a);
  });

  it('detaches a tag', async () => {
    const contactId = await makeContact('Rahul', '+919876511004');
    const tagId = (await post('/tags', { name: 'maybe' })).body.data.id;
    await post(`/contacts/${contactId}/tags`, { tagId });

    expect((await del(`/contacts/${contactId}/tags/${tagId}`)).status).toBe(204);
    const list = await get('/contacts');
    expect(list.body.data.find((c: { id: string }) => c.id === contactId).tags).toHaveLength(0);
  });

  it('drops the link when the tag is deleted (cascade)', async () => {
    const contactId = await makeContact('Anita', '+919876511005');
    const tagId = (await post('/tags', { name: 'gone' })).body.data.id;
    await post(`/contacts/${contactId}/tags`, { tagId });
    await del(`/tags/${tagId}`);

    const list = await get('/contacts');
    expect(list.body.data.find((c: { id: string }) => c.id === contactId).tags).toHaveLength(0);
  });

  it('404s attaching a tag that belongs to another org', async () => {
    const contactId = await makeContact('Mine', '+919876511006', keyA);
    const foreignTag = (await post('/tags', { name: 'theirs' }, keyB)).body.data.id;
    const r = await post(`/contacts/${contactId}/tags`, { tagId: foreignTag }, keyA);
    expect(r.status).toBe(404);
  });
});
