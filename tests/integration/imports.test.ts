import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
// Every upload, dry run and commit is read in a child process (R-016), a few hundred ms each and more on a busy CI machine, and
// several tests here do four of them: the 5 s default left too little room.
vi.setConfig({ testTimeout: 15_000 });
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

  it('[R-003] replaces a name with the newest file\'s, says so on the preview, and keeps the old one in the audit log', async () => {
    const first = await upload(THREE_ROWS);
    await run(first.body.data.id, false);

    const second = await upload('Full Name,Mobile\nShivaraman,9876500001\n');
    const preview = await run(second.body.data.id, true);
    expect(preview.body.data).toMatchObject({ updated: 1, warnings: 1 });

    const committed = await run(second.body.data.id, false);
    expect(committed.body.data).toMatchObject({ updated: 1, dryRun: false });

    const rows = await db.execute(sql`
      SELECT c.display_name AS name FROM contact c
      JOIN contact_identity ci ON ci.contact_id = c.id
      WHERE ci.value_normalized = '+919876500001' AND c.org_id = ${orgId}`);
    expect((rows as unknown as Array<{ name: string }>)[0]!.name).toBe('Shivaraman');

    const audit = await db.execute(sql`
      SELECT before, after FROM audit_log
      WHERE org_id = ${orgId} AND action = 'contact.name_replaced_by_import'`);
    const logged = audit as unknown as Array<{ before: { displayName: string }; after: { displayName: string } }>;
    expect(logged).toHaveLength(1);
    expect(logged[0]!.before.displayName).toBe('Priya Sharma');
    expect(logged[0]!.after.displayName).toBe('Shivaraman');
  });

  it('writes no audit row when the same name comes in again', async () => {
    const first = await upload(THREE_ROWS);
    await run(first.body.data.id, false);
    const again = await upload('Full Name,Mobile\nPriya Sharma,9876500001\n');
    await run(again.body.data.id, false);
    const audit = await db.execute(sql`
      SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'contact.name_replaced_by_import'`);
    expect((audit as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
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

describe('cells that hold more than one number (Naukri exports)', () => {
  // The shape of a real recruiter export: 10-digit text, and in about a third of rows a second
  // number after a comma. `NA` stands for empty. These numbers follow the existing fixtures.
  const NAUKRI_SHAPE =
    'Name,Email ID,Phone Number,Annual Salary\n' +
    '"ONE, SINGLE",one@example.com,9876500001,Rs 11 Lakhs\n' +
    'Two Numbers,two@example.com,"9876500002, +919876500012",Rs 9 Lakhs\n' +
    'Empty Second,three@example.com,"9876500003, +91",NA\n' +
    'Same Twice,four@example.com,"9876500004, +919876500004",NA\n' +
    'No Name Given,five@example.com,9876500005,NA\n' +
    'NA,six@example.com,9876500006,NA\n';
  const NAUKRI_MAPPING = {
    version: 1 as const,
    displayName: { from: 'Name', transform: ['trim' as const] },
    identities: [
      { kind: 'phone' as const, from: 'Phone Number', transform: ['trim' as const] },
      { kind: 'email' as const, from: 'Email ID', transform: ['trim' as const, 'lower' as const] }
    ],
    defaultCountry: 'IN',
    unmapped: 'drop' as const
  };

  it('imports every row, and none is rejected for holding two numbers', async () => {
    const uploaded = await upload(NAUKRI_SHAPE);
    const r = await run(uploaded.body.data.id, false, NAUKRI_MAPPING);
    expect(r.body.data).toMatchObject({ read: 6, created: 6, errors: 0 });
  });

  it('stores both numbers of a two-number cell on the same contact, first as primary', async () => {
    const uploaded = await upload(NAUKRI_SHAPE);
    await run(uploaded.body.data.id, false, NAUKRI_MAPPING);
    const rows = await db.execute(sql`
      SELECT ci.value_normalized AS v, ci.is_primary AS p
      FROM contact_identity ci JOIN contact c ON c.id = ci.contact_id
      WHERE ci.org_id = ${orgId} AND ci.kind = 'phone' AND c.display_name = 'Two Numbers'
      ORDER BY ci.is_primary DESC, ci.value_normalized`);
    expect(rows as unknown as Array<{ v: string; p: boolean }>).toEqual([
      { v: '+919876500002', p: true }, { v: '+919876500012', p: false }
    ]);
  });

  it('ignores a lone +91 and a repeated number instead of failing the row', async () => {
    const uploaded = await upload(NAUKRI_SHAPE);
    await run(uploaded.body.data.id, false, NAUKRI_MAPPING);
    const counts = await db.execute(sql`
      SELECT c.display_name AS n, count(*)::int AS phones
      FROM contact_identity ci JOIN contact c ON c.id = ci.contact_id
      WHERE ci.org_id = ${orgId} AND ci.kind = 'phone'
        AND c.display_name IN ('Empty Second', 'Same Twice') GROUP BY 1 ORDER BY 1`);
    expect(counts as unknown as Array<{ n: string; phones: number }>).toEqual([
      { n: 'Empty Second', phones: 1 }, { n: 'Same Twice', phones: 1 }
    ]);
  });

  it('treats NA as a blank name, so the contact is named by its number instead', async () => {
    const uploaded = await upload(NAUKRI_SHAPE);
    await run(uploaded.body.data.id, false, NAUKRI_MAPPING);
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE org_id = ${orgId} AND display_name = 'NA'`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('still fails a row whose only phone is junk, and says so', async () => {
    const uploaded = await upload('Name,Phone Number\nJunk,1111111111\n');
    const r = await run(uploaded.body.data.id, false, {
      ...NAUKRI_MAPPING, identities: [NAUKRI_MAPPING.identities[0]!]
    });
    expect(r.body.data).toMatchObject({ read: 1, created: 0, errors: 1 });
  });
});

describe('cells that hold more than one email address', () => {
  const SHEET =
    'Name,Email ID,Phone Number\n' +
    'Same Twice,"dup.one@example.test, dup.one@example.test",9876500021\n' +
    'Second Is Good,"not-an-email, good.two@example.test",9876500022\n' +
    'Semicolon,"semi.three@example.test; other.three@example.test",9876500023\n' +
    'Neither Valid,"junk, worse",9876500024\n';
  const MAP = {
    version: 1 as const,
    displayName: { from: 'Name', transform: ['trim' as const] },
    identities: [
      { kind: 'phone' as const, from: 'Phone Number', transform: ['trim' as const] },
      { kind: 'email' as const, from: 'Email ID', transform: ['trim' as const, 'lower' as const] }
    ],
    defaultCountry: 'IN',
    unmapped: 'drop' as const
  };

  it('uses the first valid address, and fails only the row where none is valid', async () => {
    const uploaded = await upload(SHEET);
    const r = await run(uploaded.body.data.id, false, MAP);
    expect(r.body.data).toMatchObject({ read: 4, created: 3, errors: 1 });
    const rows = await db.execute(sql`
      SELECT c.display_name AS n, ci.value_normalized AS v
      FROM contact_identity ci JOIN contact c ON c.id = ci.contact_id
      WHERE ci.org_id = ${orgId} AND ci.kind = 'email' ORDER BY 1`);
    expect(rows as unknown as Array<{ n: string; v: string }>).toEqual([
      { n: 'Same Twice', v: 'dup.one@example.test' },
      { n: 'Second Is Good', v: 'good.two@example.test' },
      { n: 'Semicolon', v: 'semi.three@example.test' }
    ]);
  });
});

describe('column suggestions and rows to fix', () => {
  const SHEET =
    'Name,Mob,Alt,Notes\n' +
    'A One,9876500001,9876500101,fine\n' +
    'B Two,"9876500002, 1111111111",NA,fine\n' +
    'C Three,9876500003,NA,fine\n' +
    'D Four,not-a-phone,NA,fine\n';

  it('suggests the phone column from the values even though the header is "Mob"', async () => {
    const uploaded = await upload(SHEET);
    expect(uploaded.body.data.suggestions).toMatchObject({ phone: 'Mob', name: 'Name' });
    const mob = uploaded.body.data.columns.find((c: { header: string }) => c.header === 'Mob');
    expect(mob.phoneShare).toBeGreaterThan(0.7);
  });

  it('lists the rows that failed, with the value as typed, and the ones that lost a number', async () => {
    const uploaded = await upload(SHEET);
    const id = uploaded.body.data.id as string;
    const mapping = {
      version: 1 as const,
      displayName: { from: 'Name', transform: ['trim' as const] },
      identities: [{ kind: 'phone' as const, from: 'Mob', transform: ['trim' as const] }],
      defaultCountry: 'IN', unmapped: 'keep' as const
    };
    const r = await run(id, true, mapping);
    expect(r.body.data).toMatchObject({ read: 4, errors: 1, warnings: 1 });

    const detail = await request(app).get(`/api/v1/imports/${id}`).set(...auth());
    expect(detail.body.data.errors).toHaveLength(1);
    expect(detail.body.data.errors[0]).toMatchObject({ rowNumber: 4, raw: { Mob: 'not-a-phone' } });
    expect(detail.body.data.warnings).toHaveLength(1);
    expect(detail.body.data.warnings[0].note).toContain('1111111111');
    // Data row 2 is row 3 in the sheet: the header is row 1. The screen adds that one.
    expect(detail.body.data.warnings[0].rowNumber).toBe(2);
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

describe('importing with several phone columns and a joined name', () => {
  it('puts every phone column on the one contact and joins first and last name as written', async () => {
    const csv =
      'First,Last,Phone,Alt\n' +
      'Anita,Sharma,9876500011,9876500012\n' +
      'a,sharma,9876500013,\n' +
      ',Rao,9876500014,\n';
    const up = await upload(csv, '?filename=join.csv');
    expect(up.status).toBe(201);
    const mapping = {
      version: 1 as const,
      nameParts: { first: 'First', last: 'Last' },
      identities: [
        { kind: 'phone' as const, from: 'Phone', transform: ['trim' as const] },
        { kind: 'phone' as const, from: 'Alt', transform: ['trim' as const] }
      ],
      defaultCountry: 'IN',
      unmapped: 'keep' as const
    };
    const r = await run(up.body.data.id, false, mapping);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ read: 3, created: 3, errors: 0 });

    const rows = await db.execute(sql`
      SELECT c.display_name AS name, count(i.*)::int AS phones
      FROM contact c JOIN contact_identity i ON i.contact_id = c.id AND i.kind = 'phone'
      WHERE c.org_id = ${orgId} GROUP BY c.id, c.display_name ORDER BY c.display_name`);
    const got = (rows as unknown as Array<{ name: string; phones: number }>);
    expect(got).toEqual([
      { name: 'Anita Sharma', phones: 2 },   // both columns, one person
      { name: 'Rao', phones: 1 },              // only the last name was filled in
      { name: 'a.sharma', phones: 1 }          // a one-letter first name is joined with a dot
    ]);
  });
});

