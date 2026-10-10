import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Self-service signup and the billing gate: a signup makes its own org, `unpaid`, signed in; an
 * unpaid org is refused on data routes (402) but can still ask who it is; the operator's override
 * (`exempt` / `paid`) lets it through immediately; signup is off unless enabled.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const hasher = new BuiltinPasswordHasher();
const baseConfig = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
};
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let closedApp: ReturnType<typeof buildApp>;
let media: TempStorage;

const email = () => `s${randomBytes(6).toString('hex')}@example.com`;
const body = (over: Record<string, unknown> = {}) => ({
  orgName: 'Acme Hiring', displayName: 'Asha', email: email(), password: 'a-long-enough-password', ...over
});

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  const deps = { logger, db, kms, hasher, tenantRole, storage: media.storage };
  app = buildApp({ ...deps, config: { ...baseConfig, SIGNUP_ENABLED: true, SIGNUP_PER_HOUR: 1000 } as unknown as Config });
  closedApp = buildApp({ ...deps, config: { ...baseConfig, SIGNUP_ENABLED: false } as unknown as Config });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM org`); });

/** Signs up and returns the cookie header + the org id. */
async function signUp(over: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/auth/signup').send(body(over));
  expect(res.status).toBe(201);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!).join('; ');
  return { cookie, orgId: res.body.data.orgId as string, res };
}

describe('signup', () => {
  it('creates its own org with the person as admin, unpaid, and signs them in', async () => {
    const { cookie, orgId, res } = await signUp();
    expect(res.body.data.role).toBe('admin');
    expect(res.body.data.billingStatus).toBe('unpaid');
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.orgId).toBe(orgId);
    expect(me.body.data.billingStatus).toBe('unpaid');
  });

  it('is off unless enabled', async () => {
    const res = await request(closedApp).post('/api/v1/auth/signup').send(body());
    expect(res.status).toBe(404);
  });

  it('refuses a taken email and a weak password', async () => {
    const addr = email();
    await signUp({ email: addr });
    expect((await request(app).post('/api/v1/auth/signup').send(body({ email: addr }))).status).toBe(409);
    expect((await request(app).post('/api/v1/auth/signup').send(body({ password: 'short' }))).status).toBe(422);
  });

  it('gives two orgs of the same name different slugs', async () => {
    await signUp({ orgName: 'Same Name' });
    await signUp({ orgName: 'Same Name' });
    const rows = (await db.execute(sql`SELECT count(DISTINCT slug)::int AS n FROM org`)) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(2);
  });
});

describe('signup rate limit', () => {
  it('caps signups from one address per hour', async () => {
    const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
    const limited = buildApp({
      config: { ...baseConfig, SIGNUP_ENABLED: true, SIGNUP_PER_HOUR: 2 } as unknown as Config,
      logger, db, kms, hasher, tenantRole, storage: media.storage
    });
    expect((await request(limited).post('/api/v1/auth/signup').send(body())).status).toBe(201);
    expect((await request(limited).post('/api/v1/auth/signup').send(body())).status).toBe(201);
    expect((await request(limited).post('/api/v1/auth/signup').send(body())).status).toBe(429);
  });
});

describe('the billing gate', () => {
  it('refuses data routes with 402 while unpaid, but not /auth/me', async () => {
    const { cookie } = await signUp();
    expect((await request(app).get('/api/v1/contacts').set('Cookie', cookie)).status).toBe(402);
    expect((await request(app).get('/api/v1/conversations').set('Cookie', cookie)).status).toBe(402);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('lets an exempted (beta) org straight through once the operator waives payment', async () => {
    const { cookie, orgId } = await signUp();
    const set = await request(app).put(`/api/v1/admin/orgs/${orgId}/billing`)
      .set('Authorization', `Bearer ${API_KEY}`).send({ status: 'exempt', note: 'beta tester Asha' });
    expect(set.status).toBe(200);
    expect(set.body.data.previous).toBe('unpaid');
    expect((await request(app).get('/api/v1/contacts').set('Cookie', cookie)).status).toBe(200);

    const audit = (await db.execute(sql`
      SELECT action FROM audit_log WHERE org_id = ${orgId} AND action = 'org.billing_changed'`)) as unknown as unknown[];
    expect(audit.length).toBe(1);
  });

  it('only the deployment bootstrap key can change billing, never the org itself', async () => {
    const { cookie, orgId } = await signUp();
    const res = await request(app).put(`/api/v1/admin/orgs/${orgId}/billing`).set('Cookie', cookie)
      .send({ status: 'exempt', note: 'let me in please' });
    expect([401, 403]).toContain(res.status);
    expect((await request(app).get('/api/v1/contacts').set('Cookie', cookie)).status).toBe(402);
  });

  it('does not affect an org provisioned by an admin (exempt by default)', async () => {
    const slug = `o${randomBytes(4).toString('hex')}`;
    const made = await request(app).post('/api/v1/admin/orgs').set('Authorization', `Bearer ${API_KEY}`)
      .send({ orgName: 'Provisioned', slug, email: email(), password: 'a-long-enough-password', displayName: 'P' });
    expect(made.status).toBe(201);
    const row = (await db.execute(sql`SELECT billing_status AS s FROM org WHERE slug = ${slug}`)) as unknown as Array<{ s: string }>;
    expect(row[0]!.s).toBe('exempt');
  });
});
