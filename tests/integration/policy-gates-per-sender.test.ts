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
import { createOrgWithAdmin, createSession } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * CW-6.6a: the 14-day and other-campaign checks look only at the same sending number.
 * (a) live campaign on A, new on A: blocked unless overridden; (b) same on B: not blocked;
 * (c) 14-day history on A, new on A: not blocked, preview count 1; (d) 14-day history on B, new on A: same-number 0, other-number 1.
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
let senderA: string;
let senderB: string;
let adminToken: string;
let contacts: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-gates-sender');
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
    orgName: 'g', slug: 'gates-sender', email: 'admin@gs.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const sender = async (phone: string): Promise<string> => (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', ${phone}, ${phone}, 'active') RETURNING id`))[0]!.id;
  senderA = await sender('+919000000001');
  senderB = await sender('+919000000002');
  contacts = [];
  for (let i = 0; i < 2; i++) {
    const c = (await rows<{ id: string }>(sql`
      INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${`P${String(i)}`}, 'test') RETURNING id`))[0]!.id;
    await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${c}, 'phone', ${`+9198765000${String(i).padStart(2, '0')}`}, true)`);
    contacts.push(c);
  }
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)), sweepBatchSize: 50
  };
}

async function newCampaign(sender: string, ids: string[], name = 'c'): Promise<string> {
  const r = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
    .send({ name, body: 'hello', senderIdentityId: sender, explicitContactIds: ids });
  return r.body.data.id as string;
}
const startAs = (id: string, body: object = {}) =>
  request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(adminToken)).send(body);
const recipientOf = async (campaignId: string, contactId: string) =>
  (await rows<{ status: string; skipReason: string | null }>(sql`
    SELECT status, skip_reason AS "skipReason" FROM campaign_recipient
    WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}`))[0]!;
const previewOf = async (id: string) =>
  (await request(app).get(`/api/v1/campaigns/${id}/preview`).set(asSession(adminToken))).body.data.audience as Record<string, unknown>;

/** Starts a campaign for the contact on a sender, but leaves it paused so the person stays pending in a live campaign. */
async function liveCampaign(sender: string): Promise<string> {
  const id = await newCampaign(sender, [contacts[0]!], 'Earlier campaign');
  await startAs(id);
  await db.execute(sql`UPDATE campaign SET status = 'paused' WHERE id = ${id}`);
  return id;
}

/** A campaign message already sent to the contact from a sender, a day ago. */
async function messagedBefore(sender: string): Promise<void> {
  const id = await newCampaign(sender, [contacts[0]!], 'Last week');
  const convo = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contacts[0]!}, ${sender}) RETURNING id`))[0]!.id;
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, campaign_id, created_at)
    VALUES (${orgId}, ${convo}, 'outbound', 'sent', ${id}, now() - interval '1 day')`);
}

describe('policy gates look at the same sending number (CW-6.6a)', { timeout: 60_000 }, () => {
  it('(a) a live campaign on the same number blocks, unless the gate is lifted', async () => {
    await liveCampaign(senderA);
    const blocked = await newCampaign(senderA, [contacts[0]!, contacts[1]!]);
    expect((await previewOf(blocked)).sameNumberLive).toBe(1);
    await startAs(blocked);
    await dispatchCampaigns(ctx());
    expect(await recipientOf(blocked, contacts[0]!)).toMatchObject({ status: 'skipped', skipReason: 'in_other_campaign' });
    expect((await recipientOf(blocked, contacts[1]!)).status).toBe('queued');

    const lifted = await newCampaign(senderA, [contacts[0]!], 'Send anyway');
    expect((await startAs(lifted, { overrideGates: ['duplicate_campaign'], reason: 'Chose send anyway in the confirm' })).status).toBe(200);
    await dispatchCampaigns(ctx());
    expect((await recipientOf(lifted, contacts[0]!)).status).toBe('queued');
    const audit = await rows<{ after: { gates: string[] } }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'campaign.gates_overridden'`);
    expect(audit.map((a) => a.after.gates)).toEqual([['duplicate_campaign']]);
  });

  it('(b) the same live campaign on another number does not block', async () => {
    await liveCampaign(senderB);
    const id = await newCampaign(senderA, [contacts[0]!]);
    expect((await previewOf(id)).sameNumberLive).toBe(0);
    await startAs(id);
    await dispatchCampaigns(ctx());
    expect((await recipientOf(id, contacts[0]!)).status).toBe('queued');
  });

  it('(c) 14-day history on the same number only warns: counted in the preview, and they are sent', async () => {
    await messagedBefore(senderA);
    const id = await newCampaign(senderA, [contacts[0]!]);
    const audience = await previewOf(id);
    expect(audience.recentlyMessaged).toBe(1);
    expect(audience.otherNumberOverlap).toBe(0);
    await startAs(id);
    await dispatchCampaigns(ctx());
    expect((await recipientOf(id, contacts[0]!)).status).toBe('queued');
  });

  it('(d) 14-day history on another number: nothing on the same number, one for the small note', async () => {
    await messagedBefore(senderB);
    const id = await newCampaign(senderA, [contacts[0]!]);
    const audience = await previewOf(id);
    expect(audience.recentlyMessaged).toBe(0);
    expect(audience.otherNumberOverlap).toBe(1);
    await startAs(id);
    await dispatchCampaigns(ctx());
    expect((await recipientOf(id, contacts[0]!)).status).toBe('queued');
  });

  it('names the live campaign and the sending phone for the confirm', async () => {
    await liveCampaign(senderA);
    const audience = await previewOf(await newCampaign(senderA, [contacts[0]!]));
    expect(audience).toMatchObject({ sameNumberLiveCampaign: 'Earlier campaign', senderPhone: '+919000000001' });
  });
});
