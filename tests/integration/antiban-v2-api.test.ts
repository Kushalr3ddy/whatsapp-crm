import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { addUserToOrg, createOrgWithAdmin, createSession, issueApiKey, storeInboundMessage } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { url } from './antiban-v2-harness.js';

/**
 * F6 S4 and S6 through the API: the number card's Resume, marking a reply as opt-out by hand, the settings for the closing message,
 * and an agent answering a do-not-contact contact who wrote again.
 */
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let adminToken: string;
let agentToken: string;
let apiKey: string;
const PHONE = '+919876500077';

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-antiban-api');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`).catch(() => undefined);
  await db.execute(sql`DELETE FROM app_user WHERE email LIKE '%@antiban-api.test'`).catch(() => undefined);
  await db.$client.end(); media.cleanup();
});

const as = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

let contactId: string;
let conversationId: string;

beforeEach(async () => {
  if (orgId !== undefined) await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`);
  await db.execute(sql`DELETE FROM app_user WHERE email LIKE '%@antiban-api.test'`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: `ab-api-${randomUUID().slice(0, 8)}`, email: 'admin@antiban-api.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, { orgId, email: 'agent@antiban-api.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  apiKey = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send', 'conversations:read', 'conversations:write', 'contacts:write'] })).secret;
  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status) VALUES (${orgId}, 'fake', 's', '+919000000009', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
  const stored = await storeInboundMessage(db, kms, {
    orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: PHONE,
    fromProviderAddress: `${PHONE.replace(/\D/g, '')}@s.whatsapp.net`, body: 'hi', contentType: 'text', receivedAt: new Date(Date.now() - 3 * 86_400_000)
  });
  conversationId = stored.conversationId;
  contactId = stored.contactId;
});

describe('the settings', () => {
  it('AC-6.7 start with the closing message on, and the page is told which contact details are missing', async () => {
    const r = await request(app).get('/api/v1/antiban/settings').set(as(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      closingMessageEnabled: true, contactPhone: null, contactEmail: null, defaultPurpose: null, stopWords: [], restartWords: [],
      quietHours: { enabled: true, start: '22:00', end: '08:00' }
    });
    expect(r.body.data.missing).toEqual(['contactPhone', 'contactEmail']);
  });

  it('AC-6.7 can be changed, partly, and the change is read back; the missing list shrinks', async () => {
    const put = await request(app).put('/api/v1/antiban/settings').set(as(adminToken)).send({
      contactPhone: '+91 98765 43210', defaultPurpose: 'you asked us about jobs', stopWords: ['Band Karo '], restartWords: ['chalu']
    });
    expect(put.status).toBe(200);
    const got = (await request(app).get('/api/v1/antiban/settings').set(as(adminToken))).body.data;
    expect(got).toMatchObject({ contactPhone: '+91 98765 43210', defaultPurpose: 'you asked us about jobs', stopWords: ['band karo'], restartWords: ['chalu'], closingMessageEnabled: true });
    expect(got.missing).toEqual(['contactEmail']);

    await request(app).put('/api/v1/antiban/settings').set(as(adminToken)).send({ closingMessageEnabled: false, contactEmail: 'hr@acme.test' });
    const again = (await request(app).get('/api/v1/antiban/settings').set(as(adminToken))).body.data;
    expect(again).toMatchObject({ closingMessageEnabled: false, contactEmail: 'hr@acme.test', contactPhone: '+91 98765 43210' });
    expect(again.missing).toEqual([]);
  });

  it('AC-6.7 refuses a bad email and a bad time, and only an admin can change it', async () => {
    expect((await request(app).put('/api/v1/antiban/settings').set(as(adminToken)).send({ contactEmail: 'not-an-email' })).status).toBe(422);
    expect((await request(app).put('/api/v1/antiban/settings').set(as(adminToken)).send({ quietHours: { start: '25:99' } })).status).toBe(422);
    expect((await request(app).put('/api/v1/antiban/settings').set(as(agentToken)).send({ closingMessageEnabled: false })).status).toBe(403);
    expect((await request(app).get('/api/v1/antiban/settings').set(as(agentToken))).status).toBe(403);
  });

  it('AC-6.2 a campaign can state its purpose', async () => {
    const r = await request(app).post('/api/v1/campaigns').set(as(adminToken)).send({
      name: 'Pune drivers', body: '{Hi|Hello} there', senderIdentityId: senderId, explicitContactIds: [contactId], purpose: 'you applied for the Pune driver job'
    });
    expect(r.status).toBe(201);
    const row = (await rows<{ purpose: string | null }>(sql`SELECT purpose FROM campaign WHERE id = ${r.body.data.id}`))[0]!;
    expect(row.purpose).toBe('you applied for the Pune driver job');
  });
});

describe('AC-4.7 resume from the number card', () => {
  it('AC-4.7 lifts many_undelivered, says whether anything was held, and leaves a number that is not held alone', async () => {
    expect((await request(app).post(`/api/v1/senders/${senderId}/resume`).set(as(agentToken))).status).toBe(200);
    await db.execute(sql`UPDATE channel_session SET many_undelivered_at = now() WHERE sender_identity_id = ${senderId}`);
    const r = await request(app).post(`/api/v1/senders/${senderId}/resume`).set(as(agentToken));
    expect(r.status).toBe(200);
    expect(r.body.data.resumed).toBe(true);
    const s = (await rows<{ at: string | null; resumed: string | null }>(sql`
      SELECT many_undelivered_at AS at, many_undelivered_resumed_at AS resumed FROM channel_session WHERE sender_identity_id = ${senderId}`))[0]!;
    expect(s.at).toBeNull();
    expect(s.resumed).not.toBeNull();
    expect((await request(app).post(`/api/v1/senders/${senderId}/resume`).set(as(agentToken))).body.data.resumed).toBe(false);
    expect((await request(app).post(`/api/v1/senders/${randomUUID()}/resume`).set(as(agentToken))).status).toBe(404);
  });
});

describe('AC-6.8 marking a reply as opt-out by hand', () => {
  it('AC-6.8 does what STOP does: closing message queued, contact on do-not-contact; once only', async () => {
    const r = await request(app).post(`/api/v1/conversations/${conversationId}/opt-out`).set(as(agentToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ alreadyOptedOut: false });
    expect(r.body.data.closingMessageId).toEqual(expect.any(String));
    const c = (await rows<{ dnc: boolean; why: string | null }>(sql`SELECT do_not_contact AS dnc, dnc_reason AS why FROM contact WHERE id = ${contactId}`))[0]!;
    expect(c).toEqual({ dnc: true, why: 'opt_out' });
    const queued = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conversationId} AND direction = 'outbound' AND status = 'queued'`);
    expect(queued[0]!.n).toBe(1);

    const again = await request(app).post(`/api/v1/conversations/${conversationId}/opt-out`).set(as(agentToken));
    expect(again.body.data).toMatchObject({ alreadyOptedOut: true, closingMessageId: null });
    expect((await request(app).post(`/api/v1/conversations/${randomUUID()}/opt-out`).set(as(agentToken))).status).toBe(404);
  });
});

describe('AC-6.5 and AC-6.6 a do-not-contact contact', () => {
  const flag = (reason: string) => db.execute(sql`
    UPDATE contact SET do_not_contact = true, dnc_reason = ${reason}, dnc_at = now() - interval '1 hour' WHERE id = ${contactId}`);
  const send = (token: string) => request(app).post('/api/v1/messages').set(as(token)).send({ conversationId, body: 'This is Acme HR.' });

  it('AC-6.5 an agent cannot write to them until they have written again', async () => {
    await flag('opt_out');
    await db.execute(sql`UPDATE message SET created_at = now() - interval '2 hours' WHERE conversation_id = ${conversationId}`);
    const r = await send(agentToken);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DO_NOT_CONTACT');
  });

  it('AC-6.5 once they write again, an agent can reply by hand; an API key still cannot', async () => {
    await flag('opt_out');
    await db.execute(sql`UPDATE message SET created_at = now() - interval '2 hours' WHERE conversation_id = ${conversationId}`);
    await storeInboundMessage(db, kms, {
      orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: PHONE,
      fromProviderAddress: `${PHONE.replace(/\D/g, '')}@s.whatsapp.net`, body: 'who is this?', contentType: 'text', receivedAt: new Date()
    });
    const ok = await send(agentToken);
    expect(ok.status).toBe(202);
    const viaKey = await request(app).post('/api/v1/messages').set('Authorization', `Bearer ${apiKey}`).send({ conversationId, body: 'hi' });
    expect(viaKey.status).toBe(422);
  });

  it('AC-6.6 an agent lifts it, and then messages go as for anyone', async () => {
    await flag('opt_out');
    await db.execute(sql`UPDATE message SET created_at = now() - interval '2 hours' WHERE conversation_id = ${conversationId}`);
    expect((await send(agentToken)).status).toBe(422);
    expect((await request(app).put(`/api/v1/contacts/${contactId}/do-not-contact`).set(as(agentToken)).send({ value: false })).status).toBe(204);
    expect((await send(agentToken)).status).toBe(202);
  });
});
