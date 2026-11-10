import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * [R-033] Signing in wrote the raw session cookie and the CSRF token into the API log: the request logger records the response headers,
 * and the redaction list only named request headers. Anyone who could read the log could reuse a 7-day session.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'info', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;

const lines: string[] = [];
const sink = { write: (s: string): void => { lines.push(s); } };
let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;

beforeAll(async () => {
  db = createDatabase(url, { max: 4 });
  media = tempStorage('crm-r033');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger: createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'test' }, sink), db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM org`); lines.length = 0; });

const cookie = (set: string[] | undefined, name: string): string =>
  (set ?? []).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1).split(';')[0] ?? '';

describe('what a sign-in leaves in the log', () => {
  it('[R-033] never contains the session cookie or the CSRF token, from the response or from later requests', async () => {
    const email = `u${randomBytes(4).toString('hex')}@r033.test`;
    await createOrgWithAdmin(db, hasher, { orgName: 'r', slug: `r${randomBytes(4).toString('hex')}`, email, password: 'a-long-enough-password', displayName: 'A' });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'a-long-enough-password' });
    expect(login.status).toBe(200);
    const session = cookie(login.headers['set-cookie'] as unknown as string[], 'crm_session');
    const csrf = cookie(login.headers['set-cookie'] as unknown as string[], 'crm_csrf');
    expect(session.length).toBeGreaterThan(20);
    expect(csrf.length).toBeGreaterThan(5);

    // A later request that carries them in a cookie and in the CSRF header.
    await request(app).get('/api/v1/auth/me').set({ Cookie: `crm_session=${session}; crm_csrf=${csrf}`, 'x-csrf-token': csrf });
    await request(app).post('/api/v1/auth/logout').set({ Cookie: `crm_session=${session}; crm_csrf=${csrf}`, 'x-csrf-token': csrf });
    await new Promise((r) => setTimeout(r, 50));

    const log = lines.join('\n');
    expect(log).toContain('/api/v1/auth/login');            // the requests really were logged
    expect(log).not.toContain(session);
    expect(log).not.toContain(csrf);
  });

  it('[R-033] never contains an API key sent as a bearer token or a key header', async () => {
    const key = `crm_live_${randomBytes(16).toString('hex')}`;
    await request(app).get('/api/v1/senders').set('Authorization', `Bearer ${key}`).set('x-api-key', key).set('x-csrf-token', 'sekret-csrf-value');
    await new Promise((r) => setTimeout(r, 50));
    const log = lines.join('\n');
    expect(log).not.toContain(key);
    expect(log).not.toContain('sekret-csrf-value');
  });
});
