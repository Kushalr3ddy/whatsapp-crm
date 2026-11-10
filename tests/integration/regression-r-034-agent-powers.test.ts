import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * [R-034] Every signed-in person passed a scope check, so an agent could clear do-not-contact (and then message the person, which is
 * what the admin-only, audited override exists to stop) and could add, link and unlink the org's WhatsApp numbers and read the QR.
 * Now flagging stays open to agents; clearing the flag and managing numbers is for admins. API keys keep their own scopes.
 * [R-039] A NUL character in a text field made Postgres refuse the statement and the request answered 500.
 * [R-040] The API sent no security headers.
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
let adminToken: string;
let agentToken: string;
let key: string;
let contactId: string;
let senderId: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-r034');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const dnc = async (): Promise<boolean> => (await rows<{ f: boolean }>(sql`SELECT do_not_contact AS f FROM contact WHERE id = ${contactId}`))[0]!.f;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'r', slug: 'r034', email: 'admin@r034.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, { orgId, email: 'agent@r034.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['contacts:write', 'senders:write', 'senders:read'] })).secret;
  contactId = (await rows<{ id: string }>(sql`
    INSERT INTO contact (org_id, display_name, source, do_not_contact, dnc_reason, dnc_at) VALUES (${orgId}, 'Flagged', 'test', true, 'asked to stop', now()) RETURNING id`))[0]!.id;
  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status) VALUES (${orgId}, 'fake', 's', '+919000000001', 'active') RETURNING id`))[0]!.id;
});

describe('[R-034] clearing do-not-contact', () => {
  it('[R-034] an agent cannot clear it, and nothing changes or is audited', async () => {
    const r = await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set(asSession(agentToken)).send({ value: false });
    expect(r.status).toBe(403);
    expect(await dnc()).toBe(true);
    const audit = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'contact.dnc_changed'`);
    expect(audit[0]!.n).toBe(0);
  });

  it('[R-034] an agent can still flag someone, and an admin can clear it', async () => {
    await db.execute(sql`UPDATE contact SET do_not_contact = false, dnc_reason = NULL, dnc_at = NULL WHERE id = ${contactId}`);
    expect((await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set(asSession(agentToken)).send({ value: true, reason: 'asked' })).status).toBe(204);
    expect(await dnc()).toBe(true);
    expect((await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set(asSession(adminToken)).send({ value: false })).status).toBe(204);
    expect(await dnc()).toBe(false);
  });

  it('[R-034] an API key an admin made with the contacts scope can still clear it', async () => {
    expect((await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set('Authorization', `Bearer ${key}`).send({ value: false })).status).toBe(204);
    expect(await dnc()).toBe(false);
  });
});

describe('[R-034] numbers', () => {
  it('[R-034] an agent cannot add, link or unlink a number, or read the link code', async () => {
    const a = asSession(agentToken);
    for (const r of [
      request(app).post('/api/v1/senders').set(a).send({ label: 'mine' }),
      request(app).post(`/api/v1/senders/${senderId}/link`).set(a).send({ mode: 'qr' }),
      request(app).get(`/api/v1/senders/${senderId}/link`).set(a),
      request(app).post(`/api/v1/senders/${senderId}/unlink`).set(a)
    ]) expect((await r).status).toBe(403);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM sender_identity WHERE org_id = ${orgId}`))[0]!.n).toBe(1);
  });

  it('[R-034] an agent can still see the list of numbers and their health', async () => {
    expect((await request(app).get('/api/v1/senders').set(asSession(agentToken))).status).toBe(200);
    expect((await request(app).get(`/api/v1/senders/${senderId}/health-events`).set(asSession(agentToken))).status).toBe(200);
  });

  it('[R-034] an admin can add and link a number, and a key with the scope can too', async () => {
    const made = await request(app).post('/api/v1/senders').set(asSession(adminToken)).send({ label: 'new' });
    expect(made.status).toBe(201);
    expect((await request(app).post(`/api/v1/senders/${made.body.data.id}/link`).set(asSession(adminToken)).send({ mode: 'qr' })).status).toBe(202);
    expect((await request(app).get(`/api/v1/senders/${made.body.data.id}/link`).set(asSession(adminToken))).status).toBe(200);
    expect((await request(app).post('/api/v1/senders').set('Authorization', `Bearer ${key}`).send({ label: 'k' })).status).toBe(201);
  });
});

describe('[R-039] a NUL character in text', () => {
  it('[R-039] is refused with 422, not a 500, in a body and in a search', async () => {
    const tag = await request(app).post('/api/v1/tags').set(asSession(adminToken)).send({ name: 'bad\u0000name' });
    expect(tag.status).toBe(422);
    const field = await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set(asSession(adminToken)).send({ value: true, reason: 'x\u0000y' });
    expect(field.status).toBe(422);
    const search = await request(app).get('/api/v1/contacts?q=a%00b').set(asSession(adminToken));
    expect(search.status).toBe(422);
  });

  it('[R-039] ordinary text, emoji and other scripts still go through', async () => {
    const tag = await request(app).post('/api/v1/tags').set(asSession(adminToken)).send({ name: 'नमस्ते 👋 ok' });
    expect(tag.status).toBeLessThan(300);
  });
});

describe('[R-040] security headers', () => {
  it('[R-040] every API answer says no sniffing, no framing, no referrer and no caching', async () => {
    for (const r of [await request(app).get('/api/v1/auth/me'), await request(app).get('/api/v1/senders').set(asSession(adminToken))]) {
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cache-control']).toContain('no-store');
    }
  });
});
