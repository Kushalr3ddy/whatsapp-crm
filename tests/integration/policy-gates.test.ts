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
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, handleSend, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The recipient-experience gates (engagement lock, cooldown, duplicate-campaign) an admin may lift
 * per campaign, and advisory mode (D-29). The line under test: a lifted gate sends, a skipped
 * recipient is reported with a reason, and the number-protecting limits stay hard for everybody —
 * except on a number an admin has knowingly set to advisory.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN',
  SEND_RATE_PER_MINUTE: 8, SEND_RATE_PER_DAY: 1500
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let adminToken: string;
let agentToken: string;
let agentId: string;
let key: string;
let contacts: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-gates');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'g', slug: 'gates', email: 'admin@g.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@g.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentId = agent.userId;
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send', 'conversations:read'] })).secret;

  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active', now() - interval '30 days')
    RETURNING id`))[0]!.id;
  contacts = [];
  for (let i = 0; i < 3; i++) {
    const c = (await rows<{ id: string }>(sql`
      INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${`P${String(i)}`}, 'test')
      RETURNING id`))[0]!.id;
    await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${c}, 'phone', ${`+9198765000${String(i).padStart(2, '0')}`}, true)`);
    contacts.push(c);
  }
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    limits: { perMinute: 8, perDay: 1500 }, sweepBatchSize: 50
  };
}

async function newCampaign(ids: string[]): Promise<string> {
  const r = await request(app).post('/api/v1/campaigns').set('Authorization', `Bearer ${key}`)
    .send({ name: 'c', body: 'hello', senderIdentityId: senderId, explicitContactIds: ids });
  return r.body.data.id as string;
}
const startAs = (id: string, token: string, body: object = {}) =>
  request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(token)).send(body);
const recipientStatus = async (campaignId: string) =>
  rows<{ contactId: string; status: string; skipReason: string | null }>(sql`
    SELECT contact_id AS "contactId", status, skip_reason AS "skipReason"
    FROM campaign_recipient WHERE campaign_id = ${campaignId}`);

/** A live thread: assigned to the agent, with traffic an hour ago. */
async function engage(contactId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id, assignee_user_id, last_inbound_at)
    VALUES (${orgId}, ${contactId}, ${senderId}, ${agentId}, now() - interval '1 hour')`);
}

describe('the policy gates', () => {
  it('skips an engaged contact with a visible reason, and sends to the rest', async () => {
    await engage(contacts[0]!);
    const id = await newCampaign(contacts);
    expect((await startAs(id, adminToken)).status).toBe(200);
    await dispatchCampaigns(ctx());

    const byContact = new Map((await recipientStatus(id)).map((r) => [r.contactId, r]));
    expect(byContact.get(contacts[0]!)).toMatchObject({ status: 'skipped', skipReason: 'engaged' });
    expect(byContact.get(contacts[1]!)!.status).toBe('queued');
  });

  it('skips someone sent a different campaign within the cooldown', async () => {
    const first = await newCampaign([contacts[0]!]);
    await startAs(first, adminToken);
    await dispatchCampaigns(ctx());                                  // contact 0 gets a campaign message

    const second = await newCampaign([contacts[0]!, contacts[1]!]);
    await startAs(second, adminToken);
    await dispatchCampaigns(ctx());

    const r = new Map((await recipientStatus(second)).map((x) => [x.contactId, x]));
    expect(r.get(contacts[0]!)).toMatchObject({ status: 'skipped', skipReason: 'cooldown' });
    expect(r.get(contacts[1]!)!.status).toBe('queued');
  });

  it('skips someone already waiting in another live campaign', async () => {
    const first = await newCampaign([contacts[0]!]);
    await startAs(first, adminToken);                                // pending, not yet dispatched
    const second = await newCampaign([contacts[0]!, contacts[1]!]);
    await startAs(second, adminToken);
    // Dispatch only the second so the first keeps its recipient pending.
    await db.execute(sql`UPDATE campaign SET status = 'paused' WHERE id = ${first}`);
    await dispatchCampaigns(ctx());

    const r = new Map((await recipientStatus(second)).map((x) => [x.contactId, x]));
    expect(r.get(contacts[0]!)).toMatchObject({ status: 'skipped', skipReason: 'in_other_campaign' });
  });
});

describe('overriding a gate', () => {
  it('lets an admin lift it with a reason, sends, and audits it', async () => {
    await engage(contacts[0]!);
    const id = await newCampaign(contacts);
    const r = await startAs(id, adminToken, {
      overrideGates: ['engagement'], reason: 'the agent asked me to include them' });
    expect(r.status).toBe(200);
    await dispatchCampaigns(ctx());

    const byContact = new Map((await recipientStatus(id)).map((x) => [x.contactId, x]));
    expect(byContact.get(contacts[0]!)!.status).toBe('queued');

    const audit = await rows<{ after: { gates: string[]; reason: string } }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'campaign.gates_overridden'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ gates: ['engagement'], reason: 'the agent asked me to include them' });
    const detail = await request(app).get(`/api/v1/campaigns/${id}`).set(asSession(adminToken));
    expect(detail.body.data.gateOverrides).toEqual(['engagement']);
  });

  it('refuses an agent, an API key, a missing reason, and a number-protecting gate', async () => {
    const id = await newCampaign(contacts);
    const body = { overrideGates: ['cooldown'], reason: 'a perfectly good reason' };
    expect((await startAs(id, agentToken, body)).status).toBe(403);
    const viaKey = await request(app).post(`/api/v1/campaigns/${id}/start`)
      .set('Authorization', `Bearer ${key}`).send(body);
    expect(viaKey.status).toBe(403);
    expect((await startAs(id, adminToken, { overrideGates: ['cooldown'] })).status).toBe(422);
    expect((await startAs(id, adminToken, {
      overrideGates: ['daily_cap'], reason: 'a perfectly good reason' })).status).toBe(422);
    // None of that started it.
    const st = await rows<{ status: string }>(sql`SELECT status FROM campaign WHERE id = ${id}`);
    expect(st[0]!.status).toBe('draft');
  });
});

describe('advisory mode (D-29)', () => {
  async function queueOne(): Promise<string> {
    const conv = (await rows<{ id: string }>(sql`
      INSERT INTO conversation (org_id, contact_id, sender_identity_id)
      VALUES (${orgId}, ${contacts[0]!}, ${senderId}) RETURNING id`))[0]!.id;
    return (await rows<{ id: string }>(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
      VALUES (${orgId}, ${conv}, 'outbound', 'queued', 'text',
              ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))}) RETURNING id`))[0]!.id;
  }
  async function connected(): Promise<WorkContext> {
    const c = ctx();
    await (c.provider as FakeChannelProvider).connect({ id: senderId, phoneE164: '+919000000001' });
    return c;
  }

  it('an enforcing quarantined number holds; an advisory one sends and counts the bypass', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'quarantined' WHERE id = ${senderId}`);
    const held = await queueOne();
    const c1 = await connected();
    await handleSend(c1, held);
    expect((await rows<{ status: string }>(sql`SELECT status FROM message WHERE id = ${held}`))[0]!.status)
      .toBe('queued');

    await db.execute(sql`UPDATE sender_identity SET enforcement = 'advisory' WHERE id = ${senderId}`);
    const c2 = await connected();
    await handleSend(c2, held);
    expect((await rows<{ status: string }>(sql`SELECT status FROM message WHERE id = ${held}`))[0]!.status)
      .toBe('sent');
    const s = (await rows<{ n: number; last: string }>(sql`
      SELECT advisory_bypass_count AS n, advisory_last_bypass AS last FROM sender_identity WHERE id = ${senderId}`))[0]!;
    expect(s).toMatchObject({ n: 1, last: 'quarantined' });
  });

  it('only an admin can switch it, with a reason, audited; enforcing again clears it', async () => {
    const path = `/api/v1/senders/${senderId}/enforcement`;
    expect((await request(app).post(path).set(asSession(agentToken))
      .send({ mode: 'advisory', reason: 'a perfectly good reason' })).status).toBe(403);
    expect((await request(app).post(path).set(asSession(adminToken))
      .send({ mode: 'advisory' })).status).toBe(422);
    const ok = await request(app).post(path).set(asSession(adminToken))
      .send({ mode: 'advisory', reason: 'throwaway test number' });
    expect(ok.status).toBe(200);

    const list = await request(app).get('/api/v1/senders').set(asSession(adminToken));
    expect(list.body.data[0]).toMatchObject({ enforcement: 'advisory', advisoryReason: 'throwaway test number' });
    const audit = await rows<{ after: { enforcement: string } }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'sender.enforcement_changed'`);
    expect(audit).toHaveLength(1);

    await request(app).post(path).set(asSession(adminToken)).send({ mode: 'enforce' });
    const back = await rows<{ enforcement: string; reason: string | null }>(sql`
      SELECT enforcement, advisory_reason AS reason FROM sender_identity WHERE id = ${senderId}`);
    expect(back[0]).toEqual({ enforcement: 'enforce', reason: null });
  });
});
