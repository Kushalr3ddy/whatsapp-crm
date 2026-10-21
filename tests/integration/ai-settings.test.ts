import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The AI assistant's settings (F12): off until an admin accepts the data-sharing note, an assistant user that
 * can own conversations but never sign in, and nobody but a signed-in admin able to change any of it.
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
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let admin: Record<string, string>;
let agent: Record<string, string>;
let apiKey: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** The headers a browser session sends: the session cookie plus a matching CSRF pair. */
function asSession(token: string): Record<string, string> {
  return { Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'ai', slug: 'ai-org', email: 'admin@ai.test', password: 'x', displayName: 'Admin'
  });
  orgId = org.orgId;
  admin = asSession((await createSession(db, { userId: org.userId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'agent@ai.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agent = asSession((await createSession(db, { userId: a.userId, orgId })).token);
  apiKey = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send'] })).secret;
});

/** Reads the settings as the given headers. */
const get = (h: Record<string, string>) => request(app).get('/api/v1/ai/settings').set(h);
/** Changes the settings as the given headers. */
const put = (h: Record<string, string>, body: object) => request(app).put('/api/v1/ai/settings').set(h).send(body);

describe('AI assistant settings', () => {
  it('starts off, with nothing accepted and no assistant user', async () => {
    const r = await get(admin);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ enabled: false, consentAcceptedAt: null, botUserId: null, dailyMessageCap: 200 });
  });

  it('refuses to switch on until the data-sharing note is accepted', async () => {
    const r = await put(admin, { enabled: true });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/data-sharing/);
    expect((await get(admin)).body.data.enabled).toBe(false);
  });

  it('switches on with consent, creates the assistant user once, and audits it', async () => {
    const on = await put(admin, { enabled: true, acceptConsent: true, instructions: 'Answer about jobs.' });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ enabled: true, instructions: 'Answer about jobs.' });
    expect(on.body.data.consentAcceptedAt).not.toBeNull();
    const botId = on.body.data.botUserId as string;

    // Off and on again keeps the same assistant and the original consent.
    await put(admin, { enabled: false });
    const again = await put(admin, { enabled: true });
    expect(again.body.data.botUserId).toBe(botId);

    const bots = await db.execute(sql`
      SELECT u.is_bot, u.password_hash, m.role FROM app_user u JOIN org_membership m ON m.user_id = u.id
      WHERE u.id = ${botId}`) as unknown as Array<{ is_bot: boolean; password_hash: string | null; role: string }>;
    expect(bots).toEqual([{ is_bot: true, password_hash: null, role: 'agent' }]);

    const audit = await db.execute(sql`
      SELECT action FROM audit_log WHERE org_id = ${orgId} AND action LIKE 'ai.%' ORDER BY at`) as unknown as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toEqual(['ai.enabled', 'ai.settings_changed', 'ai.disabled', 'ai.enabled']);
  });

  it('keeps the daily limit in range', async () => {
    expect((await put(admin, { dailyMessageCap: 0 })).status).toBe(422);
    expect((await put(admin, { dailyMessageCap: 5001 })).status).toBe(422);
    expect((await put(admin, { dailyMessageCap: 50 })).body.data.dailyMessageCap).toBe(50);
  });

  it('is for signed-in admins only: not agents, not API keys', async () => {
    expect((await get(agent)).status).toBe(403);
    expect((await put(agent, { enabled: true, acceptConsent: true })).status).toBe(403);
    expect((await put({ Authorization: `Bearer ${apiKey}` }, { enabled: true, acceptConsent: true })).status).toBe(403);
    expect((await get(admin)).body.data.enabled).toBe(false);
  });

  it('shows the assistant in the team, but it cannot be edited or given a password', async () => {
    const botId = (await put(admin, { enabled: true, acceptConsent: true })).body.data.botUserId as string;
    const team = await request(app).get('/api/v1/admin/users').set(admin);
    const bot = (team.body.data as Array<{ userId: string; isBot: boolean; displayName: string }>).find((m) => m.userId === botId);
    expect(bot).toMatchObject({ isBot: true, displayName: 'AI assistant' });

    expect((await request(app).patch(`/api/v1/admin/users/${botId}`).set(admin).send({ role: 'admin' })).status).toBe(409);
    const pw = await request(app).post(`/api/v1/admin/users/${botId}/password`).set(admin).send({ password: 'a-long-enough-password' });
    expect(pw.status).toBe(409);

    // And it cannot sign in, whatever is typed.
    const email = (await db.execute(sql`SELECT email FROM app_user WHERE id = ${botId}`) as unknown as Array<{ email: string }>)[0]!.email;
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'a-long-enough-password' });
    expect(login.status).toBe(401);
  });
});
