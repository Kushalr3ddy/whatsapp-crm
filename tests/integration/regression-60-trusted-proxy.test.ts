import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createLogger, type Config } from '@crm/shared';
import { buildApp, trustProxySetting } from '../../apps/api/src/app.js';
import { resetLoginThrottle } from '../../apps/api/src/routes/auth.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * [#60, #64] The API believed `X-Forwarded-For` from every caller (`trust proxy: true`). A caller that reached the API directly could therefore pick its
 * own address: a fresh per-address login allowance on every try, and any address it liked in the audit trail. Now only callers named by TRUST_PROXY (by
 * default this machine and private networks, where the web app and the reverse proxy sit) are believed.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let media: TempStorage;
let trusting: ReturnType<typeof buildApp>;
let direct: ReturnType<typeof buildApp>;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-r60');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  const base = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' };
  trusting = buildApp({ config: { ...base, TRUST_PROXY: 'loopback, linklocal, uniquelocal' } as unknown as Config, logger, db, kms, hasher, tenantRole, storage: media.storage });
  direct = buildApp({ config: { ...base, TRUST_PROXY: 'false' } as unknown as Config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM audit_log WHERE action LIKE 'auth.%'`); resetLoginThrottle(); });

const guess = (app: ReturnType<typeof buildApp>, n: number, forged: boolean) =>
  request(app).post('/api/v1/auth/login').set(forged ? { 'X-Forwarded-For': `198.51.100.${String(n % 250)}` } : {}).send({ email: `nobody${String(n)}@r60.test`, password: 'wrong-wrong-wrong' });

describe('[R-055] [#60] TRUST_PROXY', () => {
  it('[#60] the setting is read as false, a hop count, or a list of names and addresses; unset is this machine and private networks', () => {
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('loopback, 10.0.0.5')).toEqual(['loopback', '10.0.0.5']);
    expect(trustProxySetting(undefined)).toEqual(['loopback', 'linklocal', 'uniquelocal']);
  });

  it('[#60] a caller nobody trusts cannot dodge the per-address login limit by sending a new X-Forwarded-For each time', async () => {
    const answers: number[] = [];
    for (let n = 0; n < 34; n++) answers.push((await guess(direct, n, true)).status);
    expect(answers.slice(0, 30).every((s) => s === 401), answers.join(',')).toBe(true);
    expect(answers.slice(30).every((s) => s === 429), answers.join(',')).toBe(true);
  });

  it('[#60] behind the proxy that is trusted, each real client address keeps its own allowance (the web app forwards it)', async () => {
    const answers: number[] = [];
    for (let n = 0; n < 34; n++) answers.push((await guess(trusting, n, true)).status);
    expect(answers.every((s) => s === 401), answers.join(',')).toBe(true);
  });

  it('[#64] the address in the audit trail is the one the API saw when nobody is trusted, not the one the caller wrote', async () => {
    await db.execute(sql`INSERT INTO org(name, slug) VALUES ('r60', ${'r60-' + randomBytes(3).toString('hex')})`);
    const r = await request(direct).post('/api/v1/auth/login').set('X-Forwarded-For', '203.0.113.99').send({ email: 'someone@r60.test', password: 'wrong-wrong-wrong' });
    expect(r.status).toBe(401);
    const ips = (await db.execute(sql`SELECT ip FROM audit_log WHERE ip IS NOT NULL ORDER BY at DESC LIMIT 5`)) as unknown as Array<{ ip: string }>;
    expect(ips.map((x) => x.ip)).not.toContain('203.0.113.99');
  });
});
