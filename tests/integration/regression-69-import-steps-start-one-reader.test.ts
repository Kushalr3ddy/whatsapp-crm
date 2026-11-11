import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import * as importParse from '../../apps/api/src/import-parse.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * [#69] (PERF-1) Importing a handful of people took more than ten seconds. Every step (the upload, the dry run, the commit) started a new child
 * process to read the file within the import limits, and a child loads the TypeScript runner before it reads a byte: 2 to 3 s each on a quiet
 * machine and several times that under load. Now a file this process has already read through the child (at its upload) is not read through one
 * again for the same import; a file it has not seen (stored before the limits existed, or by another process) still is, once.
 */
vi.mock('../../apps/api/src/import-parse.js', async (original) => {
  const real = await original<typeof importParse>();
  return { ...real, parseImportIsolated: vi.fn(real.parseImportIsolated) };
});
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const MAPPING = { version: 1, displayName: { from: 'Name' }, identities: [{ kind: 'phone', from: 'Phone' }], defaultCountry: 'IN' };

let db: Database;
let media: TempStorage;
let tenantRole: Awaited<ReturnType<typeof resolveTenantRole>>;
let key: string;
const spy = importParse.parseImportIsolated as unknown as ReturnType<typeof vi.fn>;
const app = (): ReturnType<typeof buildApp> => buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-r69');
  tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  await db.execute(sql`DELETE FROM org WHERE slug = 'r69'`);
  const orgId = (await db.execute(sql`INSERT INTO org(name, slug) VALUES ('r69', 'r69') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  key = (await issueApiKey(db, { orgId, name: 'r69', scopes: ['contacts:read', 'contacts:write'] })).secret;
});
afterAll(async () => { await db.execute(sql`DELETE FROM org WHERE slug = 'r69'`); await db.$client.end(); media.cleanup(); });

const upload = (a: ReturnType<typeof buildApp>, csv: string) => request(a).post('/api/v1/imports').set('Authorization', `Bearer ${key}`).set('Content-Type', 'text/csv').send(csv);
const run = (a: ReturnType<typeof buildApp>, id: string, dryRun: boolean) => request(a).post(`/api/v1/imports/${id}/run`).set('Authorization', `Bearer ${key}`).send({ mapping: MAPPING, dryRun });

describe('[R-056] [#69] the file is read through the child once per import in this process', () => {
  it('[#69] upload, dry run and commit start one reader, not three', async () => {
    const a = app();
    spy.mockClear();
    const up = await upload(a, 'Name,Phone\nAn,9830000001\nBo,9830000002\n');
    expect(up.status).toBe(201);
    const id = String(up.body.data.id);
    expect((await run(a, id, true)).status).toBe(200);
    expect((await run(a, id, false)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('[#69] a file this process did not upload (another process, or stored before the limits) is read through the child, once, then not again', async () => {
    const first = app();
    const up = await upload(first, 'Name,Phone\nCy,9830000003\n');
    const id = String(up.body.data.id);
    const fresh = app();                      // a new process: it has not seen this run
    spy.mockClear();
    expect((await run(fresh, id, true)).status).toBe(200);
    expect((await run(fresh, id, false)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('[#69] a file over the limits is still refused at upload and never reaches a run', async () => {
    const a = app();
    const rows = Array.from({ length: 5 }, (_, i) => `N${String(i)},98300001${String(i).padStart(2, '0')}`).join('\n');
    const small = await upload(a, `Name,Phone\n${rows}\n`);
    expect(small.status).toBe(201);
    const wide = await upload(a, `${Array.from({ length: 5000 }, (_, i) => `c${String(i)}`).join(',')}\n${Array.from({ length: 5000 }, () => 'x').join(',')}\n`);
    expect([413, 422]).toContain(wide.status);
  });
});
