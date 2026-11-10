import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, createSession } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { resetLoginThrottle } from '../../apps/api/src/routes/auth.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * [R-035] The login limit was per email only: anyone could lock the admin out for up to 15 minutes by guessing wrong passwords for
 * that email, from anywhere, and a single machine could try thousands of emails four times each.
 * [R-036] The AI model settings are one per install (an env file), but the admin of any organisation could change or switch them off
 * for every organisation, and see the last four characters of the saved key.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const PASSWORD = 'a-long-enough-password';

let db: Database;
let media: TempStorage;
let app: ReturnType<typeof buildApp>;
let envFile: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-r035');
  envFile = join(mkdtempSync(join(tmpdir(), 'r035-')), 'llm.env');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN',
    LLM_DRIVER: 'none', LLM_TIMEOUT_MS: 20000, LLM_ENV_FILE: envFile, LLM_ALLOW_PRIVATE_BASE_URL: true } as unknown as Config;
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  resetLoginThrottle();
  writeFileSync(envFile, 'ENCRYPTION_KEY=do-not-touch\nLLM_DRIVER=compatible\nLLM_API_KEY=secret-key-abcd\nLLM_BASE_URL=https://example.test/v1\n');
});

const email = (): string => `u${randomBytes(5).toString('hex')}@r035.test`;
const login = (e: string, password: string, ip: string) => request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: e, password });

describe('[R-035] login limits', () => {
  it('[R-035] guessing wrong passwords for the admin from one address does not lock the admin out from another', async () => {
    const admin = email();
    await createOrgWithAdmin(db, hasher, { orgName: 'o', slug: `o${randomBytes(4).toString('hex')}`, email: admin, password: PASSWORD, displayName: 'A' });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await login(admin, 'wrong-password', '203.0.113.10')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[6]).toBe(429);                                    // the guesser is slowed down
    expect((await login(admin, PASSWORD, '198.51.100.7')).status).toBe(200);   // the admin, elsewhere, is not
  });

  it('[R-035] the guesser stays refused for the admin\'s email even with the right password, until the wait is over', async () => {
    const admin = email();
    await createOrgWithAdmin(db, hasher, { orgName: 'o', slug: `o${randomBytes(4).toString('hex')}`, email: admin, password: PASSWORD, displayName: 'A' });
    for (let i = 0; i < 5; i++) await login(admin, 'wrong-password', '203.0.113.11');
    expect((await login(admin, PASSWORD, '203.0.113.11')).status).toBe(429);
  });

  it('[R-035] one address trying many different emails is stopped after a while, and others are not', async () => {
    const results: number[] = [];
    for (let i = 0; i < 32; i++) results.push((await login(email(), 'guess', '203.0.113.12')).status);
    expect(results[0]).toBe(401);
    expect(results.at(-1)).toBe(429);
    const ok = email();
    await createOrgWithAdmin(db, hasher, { orgName: 'o', slug: `o${randomBytes(4).toString('hex')}`, email: ok, password: PASSWORD, displayName: 'A' });
    expect((await login(ok, PASSWORD, '198.51.100.8')).status).toBe(200);
  });

  it('[R-035] a typo followed by the right password still signs in and clears the count', async () => {
    const who = email();
    await createOrgWithAdmin(db, hasher, { orgName: 'o', slug: `o${randomBytes(4).toString('hex')}`, email: who, password: PASSWORD, displayName: 'A' });
    for (let i = 0; i < 3; i++) await login(who, 'typo', '203.0.113.13');
    expect((await login(who, PASSWORD, '203.0.113.13')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(who, 'typo', '203.0.113.13')).status).toBe(401);
  });
});

describe('[R-036] the install-wide AI model settings', () => {
  const session = async (name: string) => {
    const org = await createOrgWithAdmin(db, hasher, { orgName: name, slug: `${name}-${randomBytes(3).toString('hex')}`, email: `${name}@r036.test`, password: 'x', displayName: name });
    const t = (await createSession(db, { userId: org.userId, orgId: org.orgId })).token;
    return { Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' };
  };
  const choice = { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'm' };

  it('[R-036] the admin of another organisation cannot change, test, list or turn off the model, and the file is untouched', async () => {
    const first = await session('first');
    const other = await session('second');
    const before = readFileSync(envFile, 'utf8');
    for (const r of [
      request(app).put('/api/v1/ai/llm').set(other).send(choice),
      request(app).delete('/api/v1/ai/llm').set(other),
      request(app).post('/api/v1/ai/llm/test').set(other).send(choice),
      request(app).post('/api/v1/ai/llm/models').set(other).send(choice)
    ]) expect((await r).status).toBe(403);
    expect(readFileSync(envFile, 'utf8')).toBe(before);
    // The install's own admin is not refused (this body is not a working provider, so the answer is a refusal about the model, not a 403).
    expect((await request(app).post('/api/v1/ai/llm/test').set(first).send(choice)).status).not.toBe(403);
  });

  it('[R-036] the other organisation\'s admin does not see the saved key\'s last characters or address', async () => {
    const first = await session('first');
    const other = await session('second');
    const mine = (await request(app).get('/api/v1/ai/llm').set(first)).body.data;
    const theirs = (await request(app).get('/api/v1/ai/llm').set(other)).body.data;
    expect(mine.keyLast4).toBe('abcd');
    expect(theirs.keyLast4).toBeNull();
    expect(theirs.baseUrl).toBeNull();
  });
});
