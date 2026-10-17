import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The Team page's API: who is in the org, role changes, disabling, and password resets.
 *
 * The rules that matter are the ones that stop a team locking itself out (no demoting or disabling
 * yourself, never zero active admins) and the ones that keep one org out of another's people.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const hasher = new BuiltinPasswordHasher();
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const PASSWORD = 'a-long-enough-password';

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;

/** A person signed in: the cookies and CSRF header a browser would send. */
interface Session { cookie: string; csrf: string; userId: string; email: string; orgId: string }

/** Pulls one cookie's value out of a Set-Cookie header list. */
function cookieValue(setCookie: string[] | undefined, name: string): string {
  for (const c of setCookie ?? []) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0]!;
  }
  return '';
}

/** Signs in with an email and password, returning the session's cookie and CSRF header. */
async function signIn(email: string, password: string): Promise<{ cookie: string; csrf: string; status: number }> {
  const r = await request(app).post('/api/v1/auth/login').send({ email, password });
  const cookies = r.headers['set-cookie'] as unknown as string[] | undefined;
  const session = cookieValue(cookies, 'crm_session');
  const csrf = cookieValue(cookies, 'crm_csrf');
  return { cookie: `crm_session=${session}; crm_csrf=${csrf}`, csrf, status: r.status };
}

/** Makes an org with an admin, signed in. */
async function newOrg(): Promise<Session> {
  const email = `a${randomBytes(5).toString('hex')}@team.test`;
  const { orgId, userId } = await createOrgWithAdmin(db, hasher, {
    orgName: 'Team Org', slug: `t${randomBytes(5).toString('hex')}`, email, password: PASSWORD, displayName: 'Admin One'
  });
  const s = await signIn(email, PASSWORD);
  return { cookie: s.cookie, csrf: s.csrf, userId, email, orgId };
}

/** Adds a person to the admin's org through the API, and returns their id and email. */
async function addPerson(admin: Session, role: 'admin' | 'agent', name = 'Pat Agent'): Promise<{ userId: string; email: string }> {
  const email = `p${randomBytes(5).toString('hex')}@team.test`;
  const r = await request(app).post('/api/v1/admin/users').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrf)
    .send({ email, password: PASSWORD, displayName: name, role });
  expect(r.status).toBe(201);
  return { userId: r.body.data.userId as string, email };
}

/** PATCHes a person as the given signed-in user. */
const patch = (who: Session, id: string, body: object) =>
  request(app).patch(`/api/v1/admin/users/${id}`).set('Cookie', who.cookie).set('x-csrf-token', who.csrf).send(body);

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM org`); await db.execute(sql`DELETE FROM app_user`); });

describe('GET /admin/users', () => {
  it('lists the org with role and status, and never a password hash', async () => {
    const admin = await newOrg();
    await addPerson(admin, 'agent', 'Pat Agent');
    const r = await request(app).get('/api/v1/admin/users').set('Cookie', admin.cookie);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data[0]).toMatchObject({ role: 'admin', status: 'active' });
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
  });

  it('is refused to an agent', async () => {
    const admin = await newOrg();
    const agent = await addPerson(admin, 'agent');
    const s = await signIn(agent.email, PASSWORD);
    const r = await request(app).get('/api/v1/admin/users').set('Cookie', s.cookie);
    expect(r.status).toBe(403);
  });

  it('shows only this org’s people', async () => {
    const a = await newOrg();
    const b = await newOrg();
    await addPerson(b, 'agent', 'Only In B');
    const r = await request(app).get('/api/v1/admin/users').set('Cookie', a.cookie);
    expect(r.body.data.map((m: { displayName: string }) => m.displayName)).toEqual(['Admin One']);
  });
});

describe('PATCH /admin/users/:id', () => {
  it('changes a role and records who did it', async () => {
    const admin = await newOrg();
    const pat = await addPerson(admin, 'agent');
    const r = await patch(admin, pat.userId, { role: 'admin' });
    expect(r.status).toBe(200);
    expect(r.body.data.role).toBe('admin');
    const audit = await db.execute(sql`
      SELECT before, after FROM audit_log WHERE org_id = ${admin.orgId} AND action = 'user.role.changed' AND target_id = ${pat.userId}`);
    expect(audit as unknown as unknown[]).toHaveLength(1);
  });

  it('disables someone, ends their sessions at once, and blocks their next sign-in', async () => {
    const admin = await newOrg();
    const pat = await addPerson(admin, 'agent');
    const patSession = await signIn(pat.email, PASSWORD);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', patSession.cookie)).status).toBe(200);

    expect((await patch(admin, pat.userId, { status: 'disabled' })).status).toBe(200);

    expect((await request(app).get('/api/v1/auth/me').set('Cookie', patSession.cookie)).status).toBe(401);
    expect((await signIn(pat.email, PASSWORD)).status).toBe(401);

    expect((await patch(admin, pat.userId, { status: 'active' })).status).toBe(200);
    expect((await signIn(pat.email, PASSWORD)).status).toBe(200);
  });

  it('will not let an admin demote or disable themselves', async () => {
    const admin = await newOrg();
    await addPerson(admin, 'admin', 'Second Admin');
    const demote = await patch(admin, admin.userId, { role: 'agent' });
    const disable = await patch(admin, admin.userId, { status: 'disabled' });
    expect(demote.status).toBe(409);
    expect(disable.status).toBe(409);
    expect(demote.body.code).toBe('TEAM_RULE');
  });

  it('takes team management away from a demoted admin straight away', async () => {
    const admin = await newOrg();
    const second = await addPerson(admin, 'admin', 'Second Admin');
    const secondSession = await signIn(second.email, PASSWORD);
    const asSecond: Session = { ...admin, cookie: secondSession.cookie, csrf: secondSession.csrf, userId: second.userId };
    const third = await addPerson(admin, 'agent', 'Third');
    // While an admin, Second may manage the team.
    expect((await patch(asSecond, third.userId, { role: 'admin' })).status).toBe(200);
    // Demoted, the same session may not, with no new sign-in needed.
    expect((await patch(admin, second.userId, { role: 'agent' })).status).toBe(200);
    expect((await patch(asSecond, third.userId, { role: 'agent' })).status).toBe(403);
  });

  it('lets one admin remove another, and leaves the remaining admin protected from removing themselves', async () => {
    const admin = await newOrg();
    const second = await addPerson(admin, 'admin', 'Second Admin');
    const secondSession = await signIn(second.email, PASSWORD);
    const asSecond: Session = { ...admin, cookie: secondSession.cookie, csrf: secondSession.csrf, userId: second.userId };
    // Second removes Admin One; Second remains an admin, so this is allowed.
    expect((await patch(asSecond, admin.userId, { role: 'agent' })).status).toBe(200);
    // Now Second is the only admin and cannot remove their own admin access.
    expect((await patch(asSecond, second.userId, { role: 'agent' })).status).toBe(409);
  });

  it('is a 404 for a person in another org, and changes nothing there', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const inB = await addPerson(b, 'agent', 'In B');
    const r = await patch(a, inB.userId, { role: 'admin' });
    expect(r.status).toBe(404);
    const rows = await db.execute(sql`SELECT role FROM org_membership WHERE user_id = ${inB.userId}`);
    expect((rows as unknown as Array<{ role: string }>)[0]!.role).toBe('agent');
  });

  it('refuses an empty change', async () => {
    const admin = await newOrg();
    const pat = await addPerson(admin, 'agent');
    expect((await patch(admin, pat.userId, {})).status).toBe(422);
  });
});

describe('POST /admin/users/:id/password', () => {
  it('sets a new password and ends the old sessions', async () => {
    const admin = await newOrg();
    const pat = await addPerson(admin, 'agent');
    const oldSession = await signIn(pat.email, PASSWORD);

    const r = await request(app).post(`/api/v1/admin/users/${pat.userId}/password`)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrf).send({ password: 'a-brand-new-password-1' });
    expect(r.status).toBe(200);

    expect((await request(app).get('/api/v1/auth/me').set('Cookie', oldSession.cookie)).status).toBe(401);
    expect((await signIn(pat.email, PASSWORD)).status).toBe(401);
    expect((await signIn(pat.email, 'a-brand-new-password-1')).status).toBe(200);
  });

  it('is a 404 for someone in another org and a 422 for a short password', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const inB = await addPerson(b, 'agent');
    const foreign = await request(app).post(`/api/v1/admin/users/${inB.userId}/password`)
      .set('Cookie', a.cookie).set('x-csrf-token', a.csrf).send({ password: 'a-brand-new-password-1' });
    expect(foreign.status).toBe(404);
    const own = await addPerson(a, 'agent');
    const short = await request(app).post(`/api/v1/admin/users/${own.userId}/password`)
      .set('Cookie', a.cookie).set('x-csrf-token', a.csrf).send({ password: 'short' });
    expect(short.status).toBe(422);
  });
});
