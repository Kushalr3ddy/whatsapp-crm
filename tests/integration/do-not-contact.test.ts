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
 * Do-not-contact is enforced on every path that can message someone, and only an admin — signed
 * in, with a reason, audited — can knowingly lift it, per message or per campaign. Never an agent,
 * and never an API key.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
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
let flagged: string;     // a do-not-contact contact
let normal: string;      // an ordinary contact
let conversationId: string;
let adminToken: string;
let agentToken: string;
let key: string;
const FLAGGED_PHONE = '+919876500001';

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-dnc');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

async function makeContact(name: string, phone: string, dnc: boolean): Promise<string> {
  const id = (await rows<{ id: string }>(sql`
    INSERT INTO contact (org_id, display_name, source, do_not_contact)
    VALUES (${orgId}, ${name}, 'test', ${dnc}) RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${id}, 'phone', ${phone}, true)`);
  return id;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'd', slug: 'dnc', email: 'admin@d.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@d.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send', 'conversations:read', 'contacts:write'] })).secret;

  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active')
    RETURNING id`))[0]!.id;
  flagged = await makeContact('Flagged', FLAGGED_PHONE, true);
  normal = await makeContact('Normal', '+919876500002', false);
  conversationId = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${flagged}, ${senderId}) RETURNING id`))[0]!.id;
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)), sweepBatchSize: 50
  };
}
const sendReply = (token: string, extra: object = {}) => request(app).post('/api/v1/messages')
  .set(asSession(token)).send({ conversationId, body: 'hello', ...extra });
const REASON = 'they asked us to call them back';

describe('flagging a contact', () => {
  it('lets an agent flag and clear it, and audits it', async () => {
    const r = await request(app).put(`/api/v1/contacts/${normal}/do-not-contact`)
      .set(asSession(agentToken)).send({ value: true, reason: 'asked to stop' });
    expect(r.status).toBe(204);
    const row = (await rows<{ f: boolean; why: string | null }>(sql`
      SELECT do_not_contact AS f, dnc_reason AS why FROM contact WHERE id = ${normal}`))[0]!;
    expect(row).toEqual({ f: true, why: 'asked to stop' });
    await request(app).put(`/api/v1/contacts/${normal}/do-not-contact`).set(asSession(agentToken)).send({ value: false });
    expect((await rows<{ f: boolean }>(sql`SELECT do_not_contact AS f FROM contact WHERE id = ${normal}`))[0]!.f).toBe(false);
    const audit = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'contact.dnc_changed'`);
    expect(audit[0]!.n).toBe(2);
    expect((await request(app).put(`/api/v1/contacts/${orgId}/do-not-contact`).set(asSession(agentToken))
      .send({ value: true })).status).toBe(404);
  });
});

describe('a single message', () => {
  it('is refused for a flagged contact on every path, for everyone by default', async () => {
    expect((await sendReply(agentToken)).status).toBe(422);
    expect((await sendReply(adminToken)).status).toBe(422);
    const viaKey = await request(app).post('/api/v1/messages').set('Authorization', `Bearer ${key}`)
      .send({ conversationId, body: 'hi' });
    expect(viaKey.status).toBe(422);
    expect(viaKey.body.code).toBe('DO_NOT_CONTACT');
    // By phone number, too — the number is how it finds the flagged contact.
    const byPhone = await request(app).post('/api/v1/messages').set(asSession(agentToken))
      .send({ to: FLAGGED_PHONE, body: 'hi' });
    expect(byPhone.status).toBe(422);
    expect(byPhone.body.code).toBe('DO_NOT_CONTACT');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const file = await request(app).post(`/api/v1/conversations/${conversationId}/attachments?filename=a.png`)
      .set(asSession(adminToken)).set('Content-Type', 'application/octet-stream').send(png);
    expect(file.status).toBe(422);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM message WHERE org_id = ${orgId}`))[0]!.n).toBe(0);
  });

  it('can be overridden only by a signed-in admin, with a reason, and is audited', async () => {
    const body = { overrideDnc: true, overrideReason: REASON };
    expect((await sendReply(agentToken, body)).status).toBe(403);
    const viaKey = await request(app).post('/api/v1/messages').set('Authorization', `Bearer ${key}`)
      .send({ conversationId, body: 'hi', ...body });
    expect(viaKey.status).toBe(403);
    expect((await sendReply(adminToken, { overrideDnc: true })).status).toBe(422);          // no reason

    const ok = await sendReply(adminToken, body);
    expect(ok.status).toBe(202);
    const m = (await rows<{ o: boolean; why: string | null }>(sql`
      SELECT dnc_override AS o, dnc_override_reason AS why FROM message WHERE id = ${ok.body.data.id}`))[0]!;
    expect(m).toEqual({ o: true, why: REASON });
    const audit = await rows<{ after: { reason: string } }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'message.dnc_overridden'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after.reason).toBe(REASON);
  });

  it('is not affected for an ordinary contact', async () => {
    const other = (await rows<{ id: string }>(sql`
      INSERT INTO conversation (org_id, contact_id, sender_identity_id)
      VALUES (${orgId}, ${normal}, ${senderId}) RETURNING id`))[0]!.id;
    const r = await request(app).post('/api/v1/messages').set(asSession(agentToken))
      .send({ conversationId: other, body: 'hi' });
    expect(r.status).toBe(202);
  });
});

describe('the gateway backstop', () => {
  async function queue(override: boolean): Promise<string> {
    return (await rows<{ id: string }>(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, dnc_override)
      VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
              ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))}, ${override}) RETURNING id`))[0]!.id;
  }
  async function connected(): Promise<WorkContext> {
    const c = ctx();
    await (c.provider as FakeChannelProvider).connect({ id: senderId, phoneE164: '+919000000001' });
    return c;
  }

  it('refuses to send to a flagged contact, even one flagged after the message was queued', async () => {
    const id = await queue(false);
    const c = await connected();
    await handleSend(c, id);
    const m = (await rows<{ status: string; code: string | null }>(sql`
      SELECT status, error_code AS code FROM message WHERE id = ${id}`))[0]!;
    expect(m).toEqual({ status: 'failed', code: 'do_not_contact' });
    expect((c.provider as FakeChannelProvider).sent).toHaveLength(0);
  });

  it('refuses a flagged contact whatever the anti-ban policy says, and sends only when an admin overrode it', async () => {
    const blocked = await queue(false);
    const c = { ...(await connected()), antiBan: { beforeSend: () => Promise.resolve({ action: 'send' as const }), campaignBatch: () => 20 } };
    await handleSend(c, blocked);
    expect((c.provider as FakeChannelProvider).sent).toHaveLength(0);

    const allowed = await queue(true);
    await handleSend(c, allowed);
    expect((c.provider as FakeChannelProvider).sent).toHaveLength(1);
  });
});

describe('campaigns', () => {
  const start = (id: string, token: string, body: object = {}) =>
    request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(token)).send(body);
  async function campaign(): Promise<string> {
    const r = await request(app).post('/api/v1/campaigns').set(asSession(adminToken)).send({
      name: 'c', body: 'hello', senderIdentityId: senderId, explicitContactIds: [flagged, normal] });
    return r.body.data.id as string;
  }
  const statuses = async (id: string) => new Map((await rows<{ contactId: string; status: string; why: string | null }>(sql`
    SELECT contact_id AS "contactId", status, skip_reason AS why FROM campaign_recipient WHERE campaign_id = ${id}`))
    .map((r) => [r.contactId, r]));

  it('skips a flagged recipient with a visible reason', async () => {
    const id = await campaign();
    expect((await start(id, adminToken)).status).toBe(200);
    await dispatchCampaigns(ctx());
    const s = await statuses(id);
    expect(s.get(flagged)).toMatchObject({ status: 'skipped', why: 'dnc' });
    expect(s.get(normal)!.status).toBe('queued');
  });

  it('sends to them only when an admin lifts the dnc gate, marking the messages', async () => {
    const id = await campaign();
    expect((await start(id, agentToken, { overrideGates: ['dnc'], reason: REASON })).status).toBe(403);
    expect((await start(id, adminToken, { overrideGates: ['dnc'], reason: REASON })).status).toBe(200);
    await dispatchCampaigns(ctx());
    const s = await statuses(id);
    expect(s.get(flagged)!.status).toBe('queued');
    const m = await rows<{ o: boolean }>(sql`
      SELECT dnc_override AS o FROM message WHERE campaign_id = ${id}`);
    expect(m.every((x) => x.o)).toBe(true);
  });

  it('catches a contact flagged after the audience was frozen', async () => {
    const id = await campaign();
    await start(id, adminToken);
    await request(app).put(`/api/v1/contacts/${normal}/do-not-contact`).set(asSession(agentToken)).send({ value: true });
    await dispatchCampaigns(ctx());
    expect((await statuses(id)).get(normal)).toMatchObject({ status: 'skipped', why: 'dnc' });
  });
});
