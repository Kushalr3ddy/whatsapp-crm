import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, IMPORT_LIMITS, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * R-016 (2026-10-26, area: imports, found by: Mikhil and Claude, import security review; issue #6).
 *
 * An 18 KB .xlsx took the API down. `parseXlsxRows` read every column out to the widest one in the sheet (one cell in column XFD made
 * that 16,384) for every row, inside the API process: 2,000 rows meant 33 million cell objects and "JavaScript heap out of memory" at
 * 2 GB. Nothing limited columns, rows or how large the zip unpacks, and a wide CSV inside the 20 MB cap stalled the API for 15-18 s.
 * Uploads are now parsed in a child process with its own memory and time budget, under hard limits, so a hostile or broken file is
 * refused with a 422 and the API keeps serving.
 */
// Every upload, dry run and commit is read in a child process (R-016), a few hundred ms each and more on a busy CI machine, and
// several tests here do four of them: the 5 s default left too little room.
vi.setConfig({ testTimeout: 15_000 });
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let media: TempStorage;
let tenantRole: string | null;
let orgId: string;
let key: string;

/** An app whose import parsing uses these options (limits, child heap, time budget). */
const appWith = (importParse: Record<string, unknown> = {}) =>
  buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage, importParse } as never);

beforeAll(async () => {
  db = createDatabase(url, { max: 4 });
  media = tempStorage('crm-r016');
  tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
});
afterAll(async () => { await db.execute(sql`DELETE FROM org WHERE slug = 'r016'`); await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org WHERE slug = 'r016'`);
  orgId = (await db.execute(sql`INSERT INTO org(name,slug) VALUES ('r016','r016') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  key = (await issueApiKey(db, { orgId, name: 'r016', scopes: ['contacts:read', 'contacts:write'] })).secret;
});

const upload = (app: ReturnType<typeof buildApp>, body: Buffer | string, type: string) =>
  request(app).post('/api/v1/imports').set('Authorization', `Bearer ${key}`).set('Content-Type', type).send(body);

/** A sheet with a header, `rows` short data rows, and optionally one cell in the last column Excel allows (XFD = 16,384). */
async function sheet(rows: number, opts: { farRight?: boolean; bigCell?: number } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Name', 'Mobile']);
  for (let r = 0; r < rows; r++) ws.addRow([`Person ${String(r)}`, `+1202555${String(r % 10_000).padStart(4, '0')}`]);
  if (opts.farRight === true) ws.getCell('XFD1').value = 'x';
  if (opts.bigCell !== undefined) ws.getCell('C1').value = 'a'.repeat(opts.bigCell);
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

describe('[R-016] a hostile or oversized import file is refused, and the API keeps serving', () => {
  it('[R-016] refuses a sheet with data far to the right (column XFD) instead of reading 16,384 columns per row', async () => {
    const app = appWith();
    const r = await upload(app, await sheet(50, { farRight: true }), XLSX);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IMPORT_LIMIT');
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('[R-016] refuses a spreadsheet that unpacks to more than the budget, before reading it', async () => {
    const r = await upload(appWith({ limits: { ...IMPORT_LIMITS, maxUnpackedBytes: 200_000 } }), await sheet(20_000), XLSX);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IMPORT_LIMIT');
  });

  it('[R-016] refuses a spreadsheet with more rows than the limit', async () => {
    const r = await upload(appWith({ limits: { ...IMPORT_LIMITS, maxRows: 1_000 } }), await sheet(1_500), XLSX);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IMPORT_LIMIT');
  });

  it('[R-016] refuses a CSV with thousands of columns, quickly', async () => {
    const wide = 'Name' + ','.repeat(5_000) + '\nx' + ','.repeat(5_000) + '\n';
    const started = Date.now();
    const r = await upload(appWith(), wide, 'text/csv');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IMPORT_LIMIT');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('[R-016] a parse that runs out of memory fails that upload only: the next upload still works', async () => {
    // Limits opened right up and a small child heap, so the child itself runs out of memory on one 60 MB cell.
    const starved = appWith({ heapMb: 64, limits: { ...IMPORT_LIMITS, maxCellChars: 100_000_000, maxUnpackedBytes: 1_000_000_000, maxUnpackRatio: 1_000_000 } });
    const r = await upload(starved, await sheet(1, { bigCell: 60_000_000 }), XLSX);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('FILE_UNREADABLE');
    const next = await upload(starved, 'Name,Mobile\nAsha,+12025550401\n', 'text/csv');
    expect(next.status).toBe(201);
  }, 60_000);

  it('[R-016] a parse that runs past its time budget is stopped and refused', async () => {
    const r = await upload(appWith({ timeoutMs: 1 }), await sheet(2_000), XLSX);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('FILE_UNREADABLE');
  });

  it('[R-016] an ordinary spreadsheet and CSV still import', async () => {
    const app = appWith();
    const x = await upload(app, await sheet(3), XLSX);
    expect(x.status).toBe(201);
    expect(x.body.data.headers).toEqual(['Name', 'Mobile']);
    expect(x.body.data.rowCount).toBe(3);
    const c = await upload(app, 'Name,Mobile\nAsha,+12025550402\n', 'text/csv');
    expect(c.status).toBe(201);
  });
});
