import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, createSession, queueCampaignFollowUp, storeInboundMessage } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * CW-7.6 the fill-in report (coverage and a real sample per field), and CW-7.7 what to do for a person with a blank fill-in:
 * skip them (`missing_field`), use a fallback, or send anyway; an unknown key needs an explicit yes to launch.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let adminToken: string;
let tagId: string;
let contacts: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-fill-ins');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'f', slug: 'fill-ins', email: 'admin@f.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO custom_field (org_id, key, label, type) VALUES (${orgId}, 'due_date', 'Due date', 'date')`);
  tagId = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'list') RETURNING id`))[0]!.id;
  // Three people; the middle one has no due date.
  const fields = [{ due_date: '2026-11-12' }, {}, { due_date: '2026-12-01' }];
  contacts = [];
  for (let i = 0; i < 3; i++) {
    const c = (await rows<{ id: string }>(sql`
      INSERT INTO contact (org_id, display_name, source, custom_fields)
      VALUES (${orgId}, ${`Person${String(i)} Last`}, 'test', ${JSON.stringify(fields[i])}::jsonb) RETURNING id`))[0]!.id;
    await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${c}, 'phone', ${`+9198765000${String(i).padStart(2, '0')}`}, true)`);
    await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${c}, ${tagId})`);
    contacts.push(c);
  }
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)), sweepBatchSize: 50
  };
}

async function newCampaign(body: string, extra: object = {}): Promise<{ id: string; status: number }> {
  const r = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
    .send({ name: 'c', body, senderIdentityId: senderId, fromTagId: tagId, ...extra });
  return { id: r.body.data?.id as string, status: r.status };
}
const startAs = (id: string, body: object = {}) =>
  request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(adminToken)).send(body);
const recipients = async (campaignId: string) =>
  rows<{ contactId: string; status: string; skipReason: string | null }>(sql`
    SELECT contact_id AS "contactId", status, skip_reason AS "skipReason" FROM campaign_recipient WHERE campaign_id = ${campaignId}`);
const sentTexts = async (): Promise<string[]> => {
  const m = await rows<{ body: Uint8Array }>(sql`SELECT body_enc AS body FROM message WHERE direction = 'outbound' ORDER BY created_at`);
  return m.map((r) => new TextDecoder().decode(kms.decrypt(r.body)));
};

describe('the fill-in report (CW-7.6)', { timeout: 60_000 }, () => {
  it('gives coverage and a real sample for each field of an audience of 3 with one missing due_date', async () => {
    const r = await request(app).get('/api/v1/campaigns/fill-ins').query({ fromTagId: tagId }).set(asSession(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(3);
    const byKey = new Map((r.body.data.fields as Array<{ key: string; have: number; sample: string | null }>).map((f) => [f.key, f]));
    expect(byKey.get('due_date')!.have).toBe(2);
    // The sample is a real person's value (which one depends on id order).
    expect(['12 Nov 2026', '1 Dec 2026']).toContain(byKey.get('due_date')!.sample);
    expect(byKey.get('name')!.have).toBe(3);
    expect(byKey.get('name')!.sample).toMatch(/^Person\d Last$/);
    expect(byKey.get('first_name')!.have).toBe(3);
    expect(byKey.get('first_name')!.sample).toMatch(/^Person\d$/);
  });

  it('wants exactly one audience', async () => {
    expect((await request(app).get('/api/v1/campaigns/fill-ins').set(asSession(adminToken))).status).toBe(422);
  });
});

describe('blank fill-ins (CW-7.7)', { timeout: 60_000 }, () => {
  it('skip: the person with no due date is skipped as missing_field, the rest are sent', async () => {
    const { id } = await newCampaign('Due {{due_date}}', { blankFillInChoice: 'skip' });
    expect((await startAs(id)).status).toBe(200);
    await dispatchCampaigns(ctx());
    const byContact = new Map((await recipients(id)).map((r) => [r.contactId, r]));
    expect(byContact.get(contacts[1]!)).toMatchObject({ status: 'skipped', skipReason: 'missing_field' });
    expect(byContact.get(contacts[0]!)!.status).toBe('queued');
    expect(byContact.get(contacts[2]!)!.status).toBe('queued');
  });

  it('fallback: the gap is filled with the fallback text and everyone is sent', async () => {
    const { id } = await newCampaign('Due {{due_date}}', { blankFillInChoice: 'fallback', fillInFallback: 'soon' });
    await startAs(id);
    await dispatchCampaigns(ctx());
    expect((await recipients(id)).every((r) => r.status === 'queued')).toBe(true);
    expect((await sentTexts()).sort()).toEqual(['Due 2026-11-12', 'Due 2026-12-01', 'Due soon']);
  });

  it('send anyway: the gap stays blank, as before', async () => {
    const { id } = await newCampaign('Due {{due_date}}!');
    await startAs(id);
    await dispatchCampaigns(ctx());
    expect((await sentTexts()).sort()).toEqual(['Due !', 'Due 2026-11-12!', 'Due 2026-12-01!']);
  });

  it('a fallback choice needs the fallback text', async () => {
    expect((await newCampaign('Due {{due_date}}', { blankFillInChoice: 'fallback' })).status).toBe(422);
  });

  it('an unknown key is reported with the closest column, and launching needs an explicit yes', async () => {
    const { id } = await newCampaign('Due {{duedate}}');
    const preview = await request(app).get(`/api/v1/campaigns/${id}/preview`).set(asSession(adminToken));
    expect(preview.body.data.unknownFillIns).toEqual([{ key: 'duedate', suggestion: 'due_date' }]);

    const refused = await startAs(id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('UNKNOWN_FILL_IN');
    expect((await rows<{ status: string }>(sql`SELECT status FROM campaign WHERE id = ${id}`))[0]!.status).toBe('draft');

    expect((await startAs(id, { confirmUnknownFillIns: true })).status).toBe(200);
  });
});

describe('the follow-up after a reply (CW-7.7 AC2)', { timeout: 60_000 }, () => {
  it('uses the fallback in the held-back link too, not a blank', async () => {
    const { id } = await newCampaign('Hi {{name}} https://example.com/{{due_date}}', { blankFillInChoice: 'fallback', fillInFallback: 'soon' });
    await startAs(id);
    await dispatchCampaigns(ctx());
    // The person with no due date writes back; the held-back link is queued.
    const stored = await storeInboundMessage(db, kms, {
      orgId, senderIdentityId: senderId, providerMessageId: 'wamid.fill-ins-1', fromPhoneE164: '+919876500001',
      fromProviderAddress: '919876500001@s.whatsapp.net', body: 'yes?', contentType: 'text', receivedAt: new Date()
    });
    expect(await queueCampaignFollowUp(db, kms, orgId, stored.conversationId)).toBe(true);
    expect(await sentTexts()).toContain('https://example.com/soon');
  });
});
