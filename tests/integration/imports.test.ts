import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Importing a file of contacts (P5, first slice).
 *
 * The cases that matter here are the failures the system this replaces actually had: the same
 * file imported twice, one person becoming several contacts because a number was written three
 * ways, a sparse file overwriting richer data, and one bad row aborting fifty thousand good
 * ones (M3/M4/M7/M8/M9).
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

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let key: string;

const MAPPING = {
  version: 1 as const,
  displayName: { from: 'Full Name', transform: ['trim' as const] },
  identities: [
    { kind: 'phone' as const, from: 'Mobile', transform: ['trim' as const] },
    { kind: 'email' as const, from: 'Email', transform: ['trim' as const, 'lower' as const] }
  ],
  defaultCountry: 'IN',
  unmapped: 'keep' as const
};

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-imports');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole,
    storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('i','imports') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  key = (await issueApiKey(db, {
    orgId, name: 'imports', scopes: ['contacts:read', 'contacts:write']
  })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;

/** Uploads a CSV the way a client would, and returns the parsed response. */
const upload = (csv: string, query = '') =>
  request(app).post(`/api/v1/imports${query}`).set(...auth())
    .set('Content-Type', 'text/csv').send(csv);

/** Runs a mapping over an uploaded file. */
const run = (id: string, dryRun: boolean, mapping: unknown = MAPPING) =>
  request(app).post(`/api/v1/imports/${id}/run`).set(...auth()).send({ mapping, dryRun });

const THREE_ROWS =
  'Full Name,Mobile,Email\n' +
  'Priya Sharma,9876500001,PRIYA@example.com\n' +
  'Rahul Verma,+91 98765 00002,rahul@example.com\n' +
  'Anita Desai,09876500003,anita@example.com\n';

describe('uploading', () => {
  it('stores the file and reports what is in it', async () => {
    const r = await upload(THREE_ROWS, '?filename=candidates.csv');

    expect(r.status).toBe(201);
    expect(r.body.data.rowCount).toBe(3);
    expect(r.body.data.headers).toEqual(['Full Name', 'Mobile', 'Email']);
    // A sample straight from the file, so a mapping is built from fact rather than guesswork.
    expect(r.body.data.sample).toHaveLength(3);
    expect(r.body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the same bytes a second time, whatever the file is called', async () => {
    // The requirement: contacts.csv and contacts (1).csv are one file. A filename answers
    // nothing, so the content hash is the identity.
    const first = await upload(THREE_ROWS, '?filename=candidates.csv');
    const again = await upload(THREE_ROWS, '?filename=candidates%20(1).csv');

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_IMPORTED');
    // Refused with a pointer, not a silent success: a duplicate-but-fine is how a double
    // import gets noticed a week later, by which time it has been messaged.
    expect(again.body.previousRunId).toBe(first.body.data.id);
    expect(again.body.detail).toContain(first.body.data.id);
  });

  it('accepts a deliberate re-import, because otherwise people rename the file', async () => {
    const first = await upload(THREE_ROWS);
    const forced = await upload(THREE_ROWS, '?force=true');

    expect(forced.status).toBe(201);
    expect(forced.body.data.id).not.toBe(first.body.data.id);
    expect(forced.body.data.reimportOf).toBe(first.body.data.id);
  });

  it('treats one more row as a different file', async () => {
    // Tomorrow's export with three new rows is genuinely a different file and must import.
    await upload(THREE_ROWS);
    const tomorrow = await upload(`${THREE_ROWS}Vikram Rao,9876500004,vikram@example.com\n`);
    expect(tomorrow.status).toBe(201);
  });

  it('scopes the hash per org, so two tenants may import the same file', async () => {
    await upload(THREE_ROWS);
    const otherOrg = (await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('j','imports-2') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const otherKey = (await issueApiKey(db, {
      orgId: otherOrg, name: 'other', scopes: ['contacts:write']
    })).secret;

    const r = await request(app).post('/api/v1/imports')
      .set('Authorization', `Bearer ${otherKey}`)
      .set('Content-Type', 'text/csv').send(THREE_ROWS);
    // Cross-tenant dedup would leak the existence of one tenant's file into another's.
    expect(r.status).toBe(201);
  });

  it('refuses a malformed file before storing anything', async () => {
    const r = await upload('name,mobile\n"unterminated,123\n');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('MALFORMED_CSV');
  });

  it('refuses a request that is not a file', async () => {
    const r = await request(app).post('/api/v1/imports').set(...auth()).send({ not: 'a file' });
    expect(r.status).toBe(415);
  });
});

describe('the dry run', () => {
  it('reports what would happen and writes no contacts', async () => {
    const uploaded = await upload(THREE_ROWS);
    const r = await run(uploaded.body.data.id, true);

    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ read: 3, created: 3, errors: 0, dryRun: true });

    const contacts = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE org_id = ${orgId}`);
    expect((contacts as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('is the default, so a commit has to be asked for', async () => {
    // The guard against a sparse file silently overwriting richer data: the safe side is
    // what happens when nobody said which side they wanted (M9).
    const uploaded = await upload(THREE_ROWS);
    const r = await request(app).post(`/api/v1/imports/${uploaded.body.data.id}/run`)
      .set(...auth()).send({ mapping: MAPPING });

    expect(r.body.data.dryRun).toBe(true);
    const contacts = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE org_id = ${orgId}`);
    expect((contacts as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });
});

describe('committing', () => {
  it('creates the contacts, with every phone number normalised', async () => {
    // Three numbers written three ways — bare, spaced with a country code, and with a
    // leading zero. All one format afterwards, which is what stops one person becoming
    // three contacts later (M8).
    const uploaded = await upload(THREE_ROWS);
    const r = await run(uploaded.body.data.id, false);

    expect(r.body.data).toMatchObject({ read: 3, created: 3, errors: 0, dryRun: false });

    const rows = await db.execute(sql`
      SELECT value_normalized AS v FROM contact_identity
      WHERE org_id = ${orgId} AND kind = 'phone' ORDER BY v`);
    expect((rows as unknown as Array<{ v: string }>).map((x) => x.v))
      .toEqual(['+919876500001', '+919876500002', '+919876500003']);
  });

  it('recognises the same person on a second file instead of duplicating them', async () => {
    const first = await upload(THREE_ROWS);
    await run(first.body.data.id, false);

    // Same people, number written differently, one new person.
    const second = await upload(
      'Full Name,Mobile,Email\n' +
      'Priya Sharma,+919876500001,priya@example.com\n' +
      'Vikram Rao,9876500009,vikram@example.com\n'
    );
    const r = await run(second.body.data.id, false);

    expect(r.body.data.created).toBe(1);
    expect(r.body.data.read).toBe(2);
    const total = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE org_id = ${orgId}`);
    expect((total as unknown as Array<{ n: number }>)[0]!.n).toBe(4);
  });

  it('refuses to commit the same run twice', async () => {
    const uploaded = await upload(THREE_ROWS);
    await run(uploaded.body.data.id, false);
    const again = await run(uploaded.body.data.id, false);

    // Committing twice would double every contact the file creates.
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_COMMITTED');
  });

  it('does not let a sparse file overwrite a name that is already there', async () => {
    const first = await upload(THREE_ROWS);
    await run(first.body.data.id, false);

    const sparse = await upload('Full Name,Mobile\n,9876500001\n');
    await run(sparse.body.data.id, false);

    const rows = await db.execute(sql`
      SELECT c.display_name AS name FROM contact c
      JOIN contact_identity ci ON ci.contact_id = c.id
      WHERE ci.value_normalized = '+919876500001' AND c.org_id = ${orgId}`);
    // M9: the blank cell must not win over a real name.
    expect((rows as unknown as Array<{ name: string }>)[0]!.name).toBe('Priya Sharma');
  });
});

describe('bad rows', () => {
  const MIXED =
    'Full Name,Mobile,Email\n' +
    'Good One,9876500001,good@example.com\n' +
    'Bad Number,not-a-phone,bad@example.com\n' +
    'No Identity At All,,\n' +
    'Good Two,9876500002,good2@example.com\n';

  it('records each failure and still imports everything else', async () => {
    // The failure this replaces: one unparseable number aborting the whole file (M4).
    const uploaded = await upload(MIXED);
    const r = await run(uploaded.body.data.id, false);

    expect(r.body.data).toMatchObject({ read: 4, created: 2, errors: 2 });
  });

  it('explains what was wrong with each row, and keeps the original', async () => {
    const uploaded = await upload(MIXED);
    await run(uploaded.body.data.id, false);

    const report = await request(app)
      .get(`/api/v1/imports/${uploaded.body.data.id}`).set(...auth());
    const errors = report.body.data.errors as Array<{
      rowNumber: number; error: string; raw: Record<string, string>;
    }>;

    expect(errors).toHaveLength(2);
    expect(errors[0]!.rowNumber).toBe(2);
    expect(errors[0]!.error).toContain('Mobile');
    // The original value is kept so the row can be fixed and re-uploaded without the file.
    expect(errors[0]!.raw.Mobile).toBe('not-a-phone');
    expect(errors[1]!.error).toContain('no usable identity');
  });

  it('writes a ledger row for every row, not only the failures', async () => {
    const uploaded = await upload(MIXED);
    await run(uploaded.body.data.id, false);

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM import_row WHERE import_run_id = ${uploaded.body.data.id}`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(4);
  });
});

describe('isolation and the trail', () => {
  it('will not show another tenant’s import', async () => {
    const uploaded = await upload(THREE_ROWS);
    const otherOrg = (await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('k','imports-3') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const otherKey = (await issueApiKey(db, {
      orgId: otherOrg, name: 'other', scopes: ['contacts:read']
    })).secret;

    const r = await request(app).get(`/api/v1/imports/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${otherKey}`);
    expect(r.status).toBe(404);
  });

  it('records the upload and the commit as separate acts', async () => {
    const uploaded = await upload(THREE_ROWS);
    await run(uploaded.body.data.id, false);

    const rows = await db.execute(sql`
      SELECT action FROM audit_log WHERE org_id = ${orgId} AND action LIKE 'import%'
      ORDER BY at`);
    // Storing somebody's spreadsheet and changing the contact database are different acts.
    expect((rows as unknown as Array<{ action: string }>).map((r) => r.action))
      .toEqual(['import.uploaded', 'import.committed']);
  });
});

describe('Excel (.xlsx)', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /** Builds a small .xlsx with the same columns as THREE_ROWS; the first phone is a NUMBER. */
  async function xlsxBuffer(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Full Name', 'Mobile', 'Email']);
    ws.addRow(['Priya Sharma', 9876500001, 'PRIYA@example.com']);   // a numeric cell on purpose
    ws.addRow(['Rahul Verma', '+91 98765 00002', 'rahul@example.com']);
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  it('parses a spreadsheet the same as a CSV, keeping a numeric phone intact', async () => {
    const r = await request(app).post('/api/v1/imports?filename=contacts.xlsx')
      .set(...auth()).set('Content-Type', XLSX).send(await xlsxBuffer());

    expect(r.status).toBe(201);
    expect(r.body.data.headers).toEqual(['Full Name', 'Mobile', 'Email']);
    expect(r.body.data.rowCount).toBe(2);
    // The number-typed phone came through as its digits, not 9.8e9 or a dropped leading form.
    const rows = r.body.data.sample as Array<Record<string, string>>;
    const priya = rows.find((row) => row['Full Name'] === 'Priya Sharma');
    expect(priya?.Mobile).toBe('9876500001');
  });

  it('commits contacts from a spreadsheet', async () => {
    const up = await request(app).post('/api/v1/imports')
      .set(...auth()).set('Content-Type', XLSX).send(await xlsxBuffer());
    const committed = await run(up.body.data.id, false);
    expect(committed.status).toBe(200);
    expect(committed.body.data).toMatchObject({ read: 2, created: 2, errors: 0, dryRun: false });
  });

  it('rejects a file that is not a real spreadsheet with 422', async () => {
    const r = await request(app).post('/api/v1/imports')
      .set(...auth()).set('Content-Type', XLSX).send(Buffer.from('PK\x03\x04 not really a zip'));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('MALFORMED_XLSX');
  });
});

describe('listing runs to target', () => {
  it('lists a committed run with its contact count, and hides dry runs', async () => {
    // A dry run must not appear — it created nobody, so it is not an audience.
    const dry = await upload(THREE_ROWS);
    await run(dry.body.data.id, true);
    // A real commit does.
    const committed = await upload(THREE_ROWS, '?force=true');
    await run(committed.body.data.id, false);

    const r = await request(app).get('/api/v1/imports').set(...auth());
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ id: committed.body.data.id, contactCount: 3 });
  });

  it('hides a run that was superseded by a re-import', async () => {
    const first = await upload(THREE_ROWS);
    await run(first.body.data.id, false);
    // A forced re-import of the same bytes supersedes the first run.
    const again = await upload(THREE_ROWS, '?force=true');
    await run(again.body.data.id, false);

    const r = await request(app).get('/api/v1/imports').set(...auth());
    const ids = (r.body.data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(again.body.data.id);
    expect(ids).not.toContain(first.body.data.id);
  });
});
