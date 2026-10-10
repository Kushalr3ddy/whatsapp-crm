import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Mass tagging, and tagging at import time. The audience is resolved on the server (never a list of
 * ids from a page that shows 50 people), it previews before it commits, and it is idempotent.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();
const CSV = readFileSync(new URL('../fixtures/import-contacts.csv', import.meta.url), 'utf8');

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let adminToken: string;
let agentToken: string;
let tagId: string;
let ids: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-bulk');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const tagged = async (id: string = tagId) =>
  (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact_tag WHERE tag_id = ${id}`))[0]!.n;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'b', slug: 'bulk', email: 'admin@b.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@b.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  tagId = (await rows<{ id: string }>(sql`
    INSERT INTO tag (org_id, name) VALUES (${orgId}, 'warm') RETURNING id`))[0]!.id;

  // 6 contacts: one do-not-contact, one soft-deleted; "Priya" names for the search test.
  ids = [];
  for (const [i, name] of ['Priya A', 'Priya B', 'Rahul', 'Sana', 'Dev', 'Gone'].entries()) {
    ids.push((await rows<{ id: string }>(sql`
      INSERT INTO contact (org_id, display_name, source, do_not_contact, deleted_at)
      VALUES (${orgId}, ${name}, 'test', ${name === 'Dev'}, ${name === 'Gone' ? sql`now()` : null})
      RETURNING id`))[0]!.id);
    await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${ids[i]!}, 'phone', ${`+9198765000${String(i)}1`}, true)`);
  }
});

const bulk = (token: string, body: object, tag = tagId) =>
  request(app).post(`/api/v1/tags/${tag}/bulk`).set(asSession(token)).send(body);

describe('bulk tag / untag', () => {
  it('previews by default and writes nothing', async () => {
    const r = await bulk(agentToken, { action: 'add', target: { kind: 'search', q: 'priya' } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ dryRun: true, matched: 2, changed: 0 });
    expect(await tagged()).toBe(0);
  });

  it('tags everyone a search matches, exactly the people the list shows', async () => {
    const list = await request(app).get('/api/v1/contacts?q=priya').set(asSession(agentToken));
    expect(list.body.data).toHaveLength(2);
    const r = await bulk(agentToken, { action: 'add', dryRun: false, target: { kind: 'search', q: 'priya' } });
    expect(r.body.data).toMatchObject({ matched: 2, changed: 2 });
    expect(await tagged()).toBe(2);
    // The count endpoint agrees with the list and the bulk preview.
    const count = await request(app).get('/api/v1/contacts/count?q=priya').set(asSession(agentToken));
    expect(count.body.data.total).toBe(2);
  });

  it('is idempotent, and untags', async () => {
    const body = { action: 'add', dryRun: false, target: { kind: 'search', q: 'priya' } };
    await bulk(agentToken, body);
    const again = await bulk(agentToken, body);
    expect(again.body.data).toMatchObject({ matched: 2, changed: 0 });
    expect(await tagged()).toBe(2);

    const off = await bulk(agentToken, { action: 'remove', dryRun: false, target: { kind: 'search', q: 'priya' } });
    expect(off.body.data).toMatchObject({ changed: 2 });
    expect(await tagged()).toBe(0);
  });

  it('tags a hand-picked list, and ignores soft-deleted people', async () => {
    const r = await bulk(agentToken, { action: 'add', dryRun: false, target: { kind: 'ids', ids: [ids[0]!, ids[5]!] } });
    expect(r.body.data).toMatchObject({ matched: 1, changed: 1 });
  });

  it('tags a segment, which by its own rule leaves out do-not-contact people', async () => {
    const seg = (await rows<{ id: string }>(sql`
      INSERT INTO segment (org_id, name, definition) VALUES (${orgId}, 's', '{}'::jsonb) RETURNING id`))[0]!.id;
    const r = await bulk(agentToken, { action: 'add', dryRun: false, target: { kind: 'segment', segmentId: seg } });
    expect(r.body.data.matched).toBe(4);                       // 6 minus the flagged one and the deleted one
  });

  it('tags everyone only for an admin; do-not-contact people are tagged like anyone else', async () => {
    const body = { action: 'add', dryRun: false, target: { kind: 'all' } };
    expect((await bulk(agentToken, body)).status).toBe(403);
    const r = await bulk(adminToken, body);
    expect(r.body.data).toMatchObject({ matched: 5, changed: 5 });   // the deleted one is excluded
    expect(await tagged()).toBe(5);
    const audit = await rows<{ after: { target: string; changed: number } }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'contacts.bulk_tagged'`);
    expect(audit[0]!.after).toMatchObject({ target: 'all', changed: 5 });
  });

  it('refuses to commit when the audience changed since the preview', async () => {
    const r = await bulk(agentToken, {
      action: 'add', dryRun: false, expectedCount: 99, target: { kind: 'search', q: 'priya' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('COUNT_CHANGED');
    expect(await tagged()).toBe(0);
  });

  it("404s for a tag or segment that isn't this org's", async () => {
    const otherOrg = (await rows<{ id: string }>(sql`
      INSERT INTO org (name, slug) VALUES ('o', 'other') RETURNING id`))[0]!.id;
    const foreign = (await rows<{ id: string }>(sql`
      INSERT INTO tag (org_id, name) VALUES (${otherOrg}, 'theirs') RETURNING id`))[0]!.id;
    expect((await bulk(agentToken, { action: 'add', target: { kind: 'all' } }, foreign)).status).toBe(404);
    expect((await bulk(agentToken, { action: 'add',
      target: { kind: 'segment', segmentId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });
});

describe('tagging at import', () => {
  const upload = async () => {
    const r = await request(app).post('/api/v1/imports?filename=import-contacts.csv').set(asSession(agentToken))
      .set('Content-Type', 'text/csv').send(CSV);
    return r.body.data.id as string;
  };
  const MAPPING = {
    version: 1, displayName: { from: 'Full Name', transform: ['trim'] },
    identities: [
      { kind: 'phone', from: 'Mobile', transform: ['trim'] },
      { kind: 'email', from: 'Email', transform: ['trim', 'lower'] }
    ],
    defaultCountry: 'IN', unmapped: 'keep'
  };
  const run = (id: string, body: object) =>
    request(app).post(`/api/v1/imports/${id}/run`).set(asSession(agentToken)).send({ mapping: MAPPING, ...body });

  it('creates the tag, tags everyone the file created or updated, and counts them', async () => {
    const id = await upload();
    const r = await run(id, { dryRun: false, tag: { name: 'batch-oct' } });
    expect(r.status).toBe(200);
    const s = r.body.data as { created: number; updated: number; errors: number; tagged: number };
    expect(s.errors).toBe(2);                                  // the two rows with no usable number
    expect(s.created + s.updated).toBeGreaterThan(20);
    // The duplicate row updates an existing person, so people tagged = distinct contacts.
    const t = (await rows<{ id: string }>(sql`SELECT id FROM tag WHERE name = 'batch-oct'`))[0]!.id;
    expect(await tagged(t)).toBe(s.tagged);
    expect(s.tagged).toBe(s.created);
  });

  it('a dry run tags nothing and creates no tag; a recommit is refused', async () => {
    const id = await upload();
    const dry = await run(id, { dryRun: true, tag: { name: 'never' } });
    expect(dry.body.data.tagged).toBeUndefined();
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM tag WHERE name = 'never'`))[0]!.n).toBe(0);

    expect((await run(id, { dryRun: false, tag: { id: tagId } })).status).toBe(200);
    expect((await run(id, { dryRun: false, tag: { id: tagId } })).status).toBe(409);
  });

  it('refuses an unknown tag id before writing any contact', async () => {
    const id = await upload();
    const before = (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact`))[0]!.n;
    const r = await run(id, { dryRun: false, tag: { id: '00000000-0000-4000-8000-000000000000' } });
    expect(r.status).toBe(404);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact`))[0]!.n).toBe(before);
  });
});
