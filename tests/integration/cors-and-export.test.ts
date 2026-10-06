import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey, csvCell, vcardEntry } from '@crm/core';
import { createLogger, loadConfig, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Browser access from an allowlisted origin (CORS), and the contact export (CSV + vCard): admin
 * only, audited, rate-limited, defused against spreadsheet formulas.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN', CORS_ALLOWED_ORIGINS: ['http://192.168.1.20:4000']
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let adminToken: string;
let agentToken: string;
let key: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** The headers a browser session sends. */
const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'ex', slug: 'ex-org', email: 'admin@ex.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@ex.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['contacts:read', 'contacts:write'] })).secret;

  // A contact with two phones, a tag, a hostile name, and a replied message.
  const c = ((await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source, do_not_contact, dnc_reason)
    VALUES (${orgId}, '=HYPERLINK("http://evil","click")', 'import', true, 'replied_stop') RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${c}, 'phone', '+919876500001', true), (${orgId}, ${c}, 'email', 'a@b.test', false)`);
  const tag = ((await db.execute(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'vip') RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${c}, ${tag})`);
  await db.execute(sql`INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'Priya, "PK" Sharma', 'api')`);
});

describe('CORS allowlist', () => {
  it('lets a listed origin read responses, and answers its preflight before auth', async () => {
    const pre = await request(app).options('/api/v1/contacts')
      .set('Origin', 'http://192.168.1.20:4000').set('Access-Control-Request-Method', 'GET');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://192.168.1.20:4000');
    expect(pre.headers['access-control-allow-headers']).toContain('Authorization');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();   // never cookies cross-origin

    const real = await request(app).get('/api/v1/contacts')
      .set('Origin', 'http://192.168.1.20:4000').set('Authorization', `Bearer ${key}`);
    expect(real.status).toBe(200);
    expect(real.headers['access-control-allow-origin']).toBe('http://192.168.1.20:4000');
  });

  it('gives an unlisted origin nothing, so the browser refuses it', async () => {
    const r = await request(app).get('/api/v1/contacts')
      .set('Origin', 'http://evil.example').set('Authorization', `Bearer ${key}`);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(app).options('/api/v1/contacts').set('Origin', 'http://evil.example');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates the setting: no wildcard, no paths', () => {
    const base = {
      NODE_ENV: 'test', DATABASE_URL: 'postgres://x', APP_SECRET: 'a'.repeat(32),
      ENCRYPTION_KEY: 'a'.repeat(64), ENCRYPTION_INDEX_KEY: 'b'.repeat(64), API_KEY: 'k'.repeat(32),
      PUBLIC_URL: 'http://localhost:3000'
    };
    expect(loadConfig({ ...base, CORS_ALLOWED_ORIGINS: 'http://a:1, http://b:2/' }).CORS_ALLOWED_ORIGINS)
      .toEqual(['http://a:1', 'http://b:2']);
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: 'http://a:1/path' })).toThrow();
  });
});

describe('escaping (pure)', () => {
  it('defuses formulas but leaves phone lists alone, and quotes commas and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('+919876500001; +919876500002')).toBe('+919876500001; +919876500002');
    expect(csvCell('-5 apples')).toBe("'-5 apples");
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell(null)).toBe('');
  });

  it('escapes vCard structure and skips someone with nothing a phone could show', () => {
    const card = vcardEntry({
      id: '1', name: 'A;B, C', phones: '+91', emails: '', otherIds: '', tags: 'x', source: null,
      externalRef: {}, customFields: {}, doNotContact: true, dncReason: null, createdAt: '', firstContactedAt: null,
      lastContactedAt: null, lastRepliedAt: null, messagesSent: 0, messagesReceived: 0, campaigns: ''
    })!;
    expect(card).toContain('FN:A\\;B\\, C');
    expect(card).toContain('NOTE:tags: x | DO NOT CONTACT');
    expect(vcardEntry({
      id: '2', name: null, phones: '', emails: '', otherIds: '', tags: '', source: null, externalRef: null,
      customFields: null, doNotContact: false, dncReason: null, createdAt: '', firstContactedAt: null,
      lastContactedAt: null, lastRepliedAt: null, messagesSent: 0, messagesReceived: 0, campaigns: ''
    })).toBeNull();
  });
});

describe('GET /contacts/export', () => {
  it('gives an admin a CSV with everything about the people, formulas defused, and audits it', async () => {
    const r = await request(app).get('/api/v1/contacts/export?format=csv').set(asSession(adminToken));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.text.charCodeAt(0)).toBe(0xfeff);                      // BOM for Excel
    expect(r.text).toContain('id,name,phones,emails');
    expect(r.text).toContain(`'=HYPERLINK`);                        // the hostile name is defused
    expect(r.text).toContain('+919876500001');
    expect(r.text).toContain('vip');
    expect(r.text).toContain('replied_stop');
    expect(r.text).toContain('"Priya, ""PK"" Sharma"');

    const audit = (await db.execute(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'contacts.exported'`)
    ) as unknown as Array<{ after: { format: string; people: number } }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ format: 'csv', people: 2 });
  });

  it('exports vCard for a phone', async () => {
    const r = await request(app).get('/api/v1/contacts/export?format=vcf').set(asSession(adminToken));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/vcard');
    expect(r.text).toContain('BEGIN:VCARD');
    expect(r.text).toContain('TEL;TYPE=CELL:+919876500001');
    expect(r.text).toContain('NOTE:tags: vip');
    expect(r.text).toContain('DO NOT CONTACT');
  });

  it('refuses an agent, an API key, and an unknown format', async () => {
    expect((await request(app).get('/api/v1/contacts/export').set(asSession(agentToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/contacts/export').set('Authorization', `Bearer ${key}`)).status).toBe(403);
    const bad = await request(app).get('/api/v1/contacts/export?format=xlsx').set(asSession(adminToken));
    expect(bad.status).toBe(422);
  });

  it('allows five exports an hour, then 429', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/api/v1/contacts/export').set(asSession(adminToken))).status).toBe(200);
    }
    const sixth = await request(app).get('/api/v1/contacts/export').set(asSession(adminToken));
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('EXPORT_RATE_LIMITED');
  });
});
