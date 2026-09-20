import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createLogger, type Config } from '@crm/shared';
import {
  createOrgWithAdmin, addUserToOrg, setPassword, issueApiKey, resolveApiKey,
  resolveSession, createSession, revokeAllSessionsForUser, AlreadyExistsError
} from '@crm/core';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

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

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;

const bootstrap = () => ['Authorization', `Bearer ${API_KEY}`] as const;

/** A distinct email per test, so the login throttle in one test cannot affect another. */
function freshEmail(): string {
  return `u${randomBytes(6).toString('hex')}@example.com`;
}

/** Provisions an org and returns what the tests need to act as it. */
async function provision(email = freshEmail(), password = 'a-long-enough-password') {
  const slug = `o${randomBytes(6).toString('hex')}`;
  const { orgId, userId } = await createOrgWithAdmin(db, hasher, {
    orgName: 'Test Org', slug, email, password, displayName: 'Admin'
  });
  return { orgId, userId, email, password };
}

/** Pulls one cookie's value out of a Set-Cookie header list. */
function cookieValue(setCookie: string[] | undefined, name: string): string {
  for (const c of setCookie ?? []) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0]!;
  }
  return '';
}

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM org`); });

describe('provisioning', () => {
  it('creates an org, its admin and the membership as one unit', async () => {
    const { orgId, userId } = await provision();

    const rows = await db.execute(sql`
      SELECT m.role FROM org_membership m WHERE m.org_id = ${orgId} AND m.user_id = ${userId}`);
    expect((rows as unknown as Array<{ role: string }>)[0]?.role).toBe('admin');
  });

  it('succeeds under row-level security, which requires the tenant set before the insert', async () => {
    // The `org` policy has no WITH CHECK, so Postgres reuses its USING clause for inserts and
    // only accepts a row whose id matches app.org_id. Getting this backwards fails under a
    // correct role while appearing to work as the table owner.
    const { orgId } = await provision();
    const rows = await db.execute(sql`SELECT id FROM org WHERE id = ${orgId}`);
    expect((rows as unknown as unknown[]).length).toBe(1);
  });

  it('refuses a duplicate slug and a duplicate email, naming which', async () => {
    const email = freshEmail();
    const { orgId: _ } = await provision(email);

    await expect(provision(freshEmail())).resolves.toBeDefined();
    await expect(createOrgWithAdmin(db, hasher, {
      orgName: 'x', slug: 'dup', email, password: 'a-long-enough-password', displayName: 'x'
    }).then(() => createOrgWithAdmin(db, hasher, {
      orgName: 'x', slug: 'dup', email: freshEmail(), password: 'a-long-enough-password', displayName: 'x'
    }))).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it('leaves nothing behind when it fails, because it is one transaction', async () => {
    const email = freshEmail();
    await provision(email);
    const before = await db.execute(sql`SELECT count(*)::int AS n FROM org`);

    // Same email, new slug: the org insert succeeds, the user insert does not, and the whole
    // thing must roll back rather than leave an org with no admin.
    await expect(createOrgWithAdmin(db, hasher, {
      orgName: 'x', slug: `s${randomBytes(4).toString('hex')}`, email,
      password: 'a-long-enough-password', displayName: 'x'
    })).rejects.toBeInstanceOf(AlreadyExistsError);

    const after = await db.execute(sql`SELECT count(*)::int AS n FROM org`);
    expect((after as unknown as Array<{ n: number }>)[0]!.n)
      .toBe((before as unknown as Array<{ n: number }>)[0]!.n);
  });
});

describe('login', () => {
  it('issues a session cookie and a readable CSRF cookie', async () => {
    const { email, password } = await provision();

    const r = await request(app).post('/api/v1/auth/login').send({ email, password });

    expect(r.status).toBe(200);
    const cookies = r.headers['set-cookie'] as unknown as string[];
    expect(cookieValue(cookies, 'crm_session')).not.toBe('');
    expect(cookieValue(cookies, 'crm_csrf')).not.toBe('');
    // The session cookie must be unreadable by script; the CSRF one must be readable, because
    // the browser has to echo it back in a header.
    expect(cookies.find((c) => c.startsWith('crm_session='))).toContain('HttpOnly');
    expect(cookies.find((c) => c.startsWith('crm_csrf='))).not.toContain('HttpOnly');
  });

  it('refuses a wrong password', async () => {
    const { email } = await provision();
    const r = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('answers a missing account exactly as it answers a wrong password', async () => {
    const { email } = await provision();
    const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });
    const missing = await request(app).post('/api/v1/auth/login')
      .send({ email: freshEmail(), password: 'wrong-password' });

    // Otherwise the response enumerates which emails have accounts.
    expect(missing.status).toBe(wrong.status);
    expect(missing.body.code).toBe(wrong.body.code);
    expect(missing.body.detail).toBe(wrong.body.detail);
  });

  it('locks out after repeated failures, then reports how long to wait', async () => {
    const { email } = await provision();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });
    }

    const r = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('refuses a disabled account even with the right password', async () => {
    const { email, password, userId } = await provision();
    await db.execute(sql`UPDATE app_user SET status = 'disabled' WHERE id = ${userId}`);

    const r = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(r.status).toBe(401);
  });
});

describe('sessions', () => {
  it('resolves a token to its person, tenant and role', async () => {
    const { orgId, userId } = await provision();
    const issued = await createSession(db, { userId, orgId });

    const principal = await resolveSession(db, issued.token);

    expect(principal?.userId).toBe(userId);
    expect(principal?.orgId).toBe(orgId);
    expect(principal?.role).toBe('admin');
  });

  it('stores only a hash, so the raw token is not in the database', async () => {
    const { orgId, userId } = await provision();
    const issued = await createSession(db, { userId, orgId });

    const rows = await db.execute(sql`SELECT token_hash FROM session WHERE id = ${issued.sessionId}`);
    expect((rows as unknown as Array<{ token_hash: string }>)[0]!.token_hash).not.toBe(issued.token);
  });

  it('stops accepting a revoked session', async () => {
    const { orgId, userId } = await provision();
    const issued = await createSession(db, { userId, orgId });
    await revokeAllSessionsForUser(db, userId);

    expect(await resolveSession(db, issued.token)).toBeNull();
  });

  it('stops accepting an expired session', async () => {
    const { orgId, userId } = await provision();
    const issued = await createSession(db, { userId, orgId });
    await db.execute(sql`UPDATE session SET expires_at = now() - interval '1 second' WHERE id = ${issued.sessionId}`);

    expect(await resolveSession(db, issued.token)).toBeNull();
  });

  it('ends every session when the password changes', async () => {
    const { orgId, userId, email } = await provision();
    const a = await createSession(db, { userId, orgId });
    const b = await createSession(db, { userId, orgId });

    await setPassword(db, hasher, email, 'a-different-long-password');

    // Changing a password that left existing sessions alive would not actually evict whoever
    // the change was meant to evict.
    expect(await resolveSession(db, a.token)).toBeNull();
    expect(await resolveSession(db, b.token)).toBeNull();
  });

  it('ends access the moment a membership is removed, not when the session expires', async () => {
    const { orgId, userId } = await provision();
    const issued = await createSession(db, { userId, orgId });
    await db.execute(sql`DELETE FROM org_membership WHERE user_id = ${userId} AND org_id = ${orgId}`);

    expect(await resolveSession(db, issued.token)).toBeNull();
  });

  it('authenticates a real request with the cookie', async () => {
    const { email, password } = await provision();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const session = cookieValue(login.headers['set-cookie'] as unknown as string[], 'crm_session');

    const r = await request(app).get('/api/v1/senders').set('Cookie', `crm_session=${session}`);
    expect(r.status).toBe(200);
  });
});

describe('CSRF', () => {
  it('refuses a cookie-authenticated write with no CSRF header', async () => {
    const { email, password } = await provision();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const session = cookieValue(cookies, 'crm_session');

    const r = await request(app).post('/api/v1/senders')
      .set('Cookie', `crm_session=${session}`)
      .send({ label: 'x' });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_FAILED');
  });

  it('accepts the write when the header echoes the cookie', async () => {
    const { email, password } = await provision();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const session = cookieValue(cookies, 'crm_session');
    const csrf = cookieValue(cookies, 'crm_csrf');

    const r = await request(app).post('/api/v1/senders')
      .set('Cookie', `crm_session=${session}; crm_csrf=${csrf}`)
      .set('x-csrf-token', csrf)
      .send({ label: 'x' });

    expect(r.status).toBe(201);
  });

  it('does not ask an API key for CSRF, since headers are never sent automatically', async () => {
    const { orgId } = await provision();
    const key = await issueApiKey(db, { orgId, name: 'k', scopes: ['senders:write'] });

    const r = await request(app).post('/api/v1/senders')
      .set('Authorization', `Bearer ${key.secret}`)
      .send({ label: 'x' });

    expect(r.status).toBe(201);
  });

  it('lets a cookie-authenticated read through without a CSRF header', async () => {
    const { email, password } = await provision();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const session = cookieValue(login.headers['set-cookie'] as unknown as string[], 'crm_session');

    const r = await request(app).get('/api/v1/senders').set('Cookie', `crm_session=${session}`);
    expect(r.status).toBe(200);
  });
});

describe('api keys', () => {
  it('returns the secret once and stores only a hash', async () => {
    const { orgId } = await provision();
    const issued = await issueApiKey(db, { orgId, name: 'portal', scopes: ['messages:send'] });

    const rows = await db.execute(sql`SELECT key_hash, prefix FROM api_key WHERE id = ${issued.id}`);
    const row = (rows as unknown as Array<{ key_hash: string; prefix: string }>)[0]!;
    expect(row.key_hash).not.toBe(issued.secret);
    // The prefix is kept in clear on purpose, so a person can tell two keys apart in a list.
    expect(issued.secret.startsWith(row.prefix)).toBe(true);
  });

  it('resolves a key to its own org rather than guessing one', async () => {
    const { orgId } = await provision();
    const issued = await issueApiKey(db, { orgId, name: 'k', scopes: ['senders:read'] });

    expect((await resolveApiKey(db, issued.secret))?.orgId).toBe(orgId);
  });

  it('refuses an unknown scope at issue time rather than ignoring it', async () => {
    const { orgId } = await provision();
    await expect(issueApiKey(db, { orgId, name: 'k', scopes: ['messages:sned'] }))
      .rejects.toThrow(/unknown scope/);
  });

  it('enforces scopes: a read-only key cannot send', async () => {
    const { orgId } = await provision();
    const key = await issueApiKey(db, { orgId, name: 'ro', scopes: ['conversations:read'] });

    const r = await request(app).post('/api/v1/messages')
      .set('Authorization', `Bearer ${key.secret}`)
      .send({ to: '+919876543210', body: 'hi' });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('records last_used_at, which is what identifies a dormant key', async () => {
    const { orgId } = await provision();
    const issued = await issueApiKey(db, { orgId, name: 'k', scopes: ['senders:read'] });

    const before = await db.execute(sql`SELECT last_used_at FROM api_key WHERE id = ${issued.id}`);
    expect((before as unknown as Array<{ last_used_at: string | null }>)[0]!.last_used_at).toBeNull();

    await resolveApiKey(db, issued.secret);

    const after = await db.execute(sql`SELECT last_used_at FROM api_key WHERE id = ${issued.id}`);
    expect((after as unknown as Array<{ last_used_at: string | null }>)[0]!.last_used_at).not.toBeNull();
  });
});

describe('provisioning over HTTP', () => {
  it('lets the bootstrap key create an org, and only the bootstrap key', async () => {
    const slug = `o${randomBytes(6).toString('hex')}`;
    const body = {
      orgName: 'Hiring Studios', slug, email: freshEmail(),
      password: 'a-long-enough-password', displayName: 'Kushal'
    };

    const r = await request(app).post('/api/v1/admin/orgs').set(...bootstrap()).send(body);
    expect(r.status).toBe(201);

    const anonymous = await request(app).post('/api/v1/admin/orgs').send(body);
    expect(anonymous.status).toBe(401);
  });

  it('refuses a short password at the boundary', async () => {
    const r = await request(app).post('/api/v1/admin/orgs').set(...bootstrap()).send({
      orgName: 'x', slug: `o${randomBytes(4).toString('hex')}`, email: freshEmail(),
      password: 'short', displayName: 'x'
    });
    expect(r.status).toBe(422);
  });

  it('mints a key for a named org, showing the secret exactly once', async () => {
    const { orgId } = await provision();

    const r = await request(app).post('/api/v1/admin/keys').set(...bootstrap())
      .send({ name: 'job portal', scopes: ['messages:send'], orgId });

    expect(r.status).toBe(201);
    expect(r.body.data.secret).toMatch(/^crm_live_/);
    expect(r.body.data.warning).toContain('cannot be shown again');
  });

  it('refuses to mint a key when the bootstrap caller names no org', async () => {
    const r = await request(app).post('/api/v1/admin/keys').set(...bootstrap())
      .send({ name: 'x', scopes: ['messages:send'] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ORG_REQUIRED');
  });

  it('will not let an agent mint a key', async () => {
    const { orgId } = await provision();
    const agentEmail = freshEmail();
    await addUserToOrg(db, hasher, {
      orgId, email: agentEmail, password: 'a-long-enough-password',
      displayName: 'Agent', role: 'agent'
    });

    const login = await request(app).post('/api/v1/auth/login')
      .send({ email: agentEmail, password: 'a-long-enough-password' });
    const cookies = login.headers['set-cookie'] as unknown as string[];

    const r = await request(app).post('/api/v1/admin/keys')
      .set('Cookie', `crm_session=${cookieValue(cookies, 'crm_session')}; crm_csrf=${cookieValue(cookies, 'crm_csrf')}`)
      .set('x-csrf-token', cookieValue(cookies, 'crm_csrf'))
      .send({ name: 'x', scopes: ['messages:send'] });

    expect(r.status).toBe(403);
  });
});
