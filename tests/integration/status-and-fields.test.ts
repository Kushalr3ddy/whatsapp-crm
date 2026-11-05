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
import { createOrgWithAdmin, addUserToOrg, createSession, checkFieldValue } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, handleSend, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Two small things that make the system explain itself: whether the number behind a thread can
 * send (and why a queued message is waiting), and the org's fixed vocabulary of custom fields.
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
let contactId: string;
let conversationId: string;
let adminToken: string;
let agentToken: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-status');
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
    orgName: 's', slug: 'status', email: 'admin@s.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@s.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;

  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 'main', '+919000000001', 'active')
    RETURNING id`))[0]!.id;
  contactId = (await rows<{ id: string }>(sql`
    INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', '+919876500001', true)`);
  conversationId = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`))[0]!.id;
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)), sweepBatchSize: 50
  };
}

describe('the number status line', () => {
  const status = () => request(app)
    .get(`/api/v1/conversations/${conversationId}/sender-status`).set(asSession(agentToken));

  it('says not connected when there is no live socket, connected when there is', async () => {
    const down = await status();
    expect(down.body.data).toMatchObject({ label: 'main', canSend: false, reason: 'not_connected' });

    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state)
      VALUES (${senderId}, 'open')`);
    expect((await status()).body.data).toMatchObject({ canSend: true, reason: null });

  });

  it('404s for a thread that is not in this org', async () => {
    const r = await request(app).get('/api/v1/conversations/00000000-0000-4000-8000-000000000000/sender-status')
      .set(asSession(agentToken));
    expect(r.status).toBe(404);
  });
});

describe('"waiting: reason" on a queued message', () => {
  it('records why it is waiting, and clears it once it sends', async () => {
    const id = (await rows<{ id: string }>(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc)
      VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
              ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))}) RETURNING id`))[0]!.id;
    const c = ctx();
    await handleSend(c, id);                                          // never connected
    const waiting = (await rows<{ status: string; hold: string | null }>(sql`
      SELECT status, hold_reason AS hold FROM message WHERE id = ${id}`))[0]!;
    expect(waiting).toEqual({ status: 'queued', hold: 'sender_not_connected' });

    await (c.provider as FakeChannelProvider).connect({ id: senderId, phoneE164: '+919000000001' });
    await handleSend(c, id);
    const sent = (await rows<{ status: string; hold: string | null }>(sql`
      SELECT status, hold_reason AS hold FROM message WHERE id = ${id}`))[0]!;
    expect(sent).toEqual({ status: 'sent', hold: null });

    const list = await request(app).get(`/api/v1/conversations/${conversationId}/messages`)
      .set(asSession(agentToken));
    expect(list.body.data[0]).toHaveProperty('holdReason', null);
  });
});

describe('custom fields', () => {
  const define = (body: object, token = adminToken) =>
    request(app).post('/api/v1/custom-fields').set(asSession(token)).send(body);
  const setValues = (values: object) =>
    request(app).put(`/api/v1/contacts/${contactId}/custom-fields`).set(asSession(agentToken)).send({ values });
  const stored = async () =>
    (await rows<{ f: Record<string, unknown> }>(sql`SELECT custom_fields AS f FROM contact WHERE id = ${contactId}`))[0]!.f;

  it('lets only an admin define fields, and validates the key and type', async () => {
    expect((await define({ key: 'city', label: 'City' }, agentToken)).status).toBe(403);
    expect((await define({ key: 'City!', label: 'City' })).status).toBe(422);
    expect((await define({ key: 'stage', label: 'Stage', type: 'select' })).status).toBe(422);
    expect((await define({ key: 'city', label: 'City' })).status).toBe(201);
    expect((await define({ key: 'city', label: 'City again' })).status).toBe(409);
    const list = await request(app).get('/api/v1/custom-fields').set(asSession(agentToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('only stores defined keys, checks types, and clears with null', async () => {
    await define({ key: 'city', label: 'City' });
    await define({ key: 'years', label: 'Years', type: 'number' });
    await define({ key: 'stage', label: 'Stage', type: 'select', options: ['new', 'hired'] });

    expect((await setValues({ town: 'Pune' })).status).toBe(422);              // not defined
    expect((await setValues({ years: 'lots' })).status).toBe(422);             // not a number
    expect((await setValues({ stage: 'maybe' })).status).toBe(422);            // not an option
    expect(await stored()).toEqual({});

    expect((await setValues({ city: 'Pune', years: '4', stage: 'new' })).status).toBe(204);
    expect(await stored()).toEqual({ city: 'Pune', years: 4, stage: 'new' });

    expect((await setValues({ city: null })).status).toBe(204);
    expect(await stored()).toEqual({ years: 4, stage: 'new' });
  });

  it('refuses an undefined field when creating a contact, and removing a field clears it everywhere', async () => {
    await define({ key: 'city', label: 'City' });
    const bad = await request(app).post('/api/v1/contacts').set(asSession(adminToken))
      .send({ displayName: 'X', phone: '+919876500009', customFields: { nope: 1 } });
    expect(bad.status).toBe(422);
    const ok = await request(app).post('/api/v1/contacts').set(asSession(adminToken))
      .send({ displayName: 'Y', phone: '+919876500010', customFields: { city: 'Goa' } });
    expect(ok.status).toBe(201);

    await setValues({ city: 'Pune' });
    expect((await request(app).delete('/api/v1/custom-fields/city').set(asSession(adminToken))).status).toBe(204);
    expect(await stored()).toEqual({});
  });

  it('fills {{city}} in a campaign message from the contact', async () => {
    await define({ key: 'city', label: 'City' });
    await setValues({ city: 'Pune' });
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state)
      VALUES (${senderId}, 'open')`);
    const create = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'c', body: 'Hi {{name}} from {{city}}', senderIdentityId: senderId,
        explicitContactIds: [contactId] });
    await request(app).post(`/api/v1/campaigns/${create.body.data.id}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    const body = (await rows<{ b: Buffer }>(sql`
      SELECT body_enc AS b FROM message WHERE campaign_id = ${create.body.data.id}`))[0]!.b;
    expect(new TextDecoder().decode(kms.decrypt(new Uint8Array(body)))).toBe('Hi Asha from Pune');
  });

  it('checks each type on its own (pure)', () => {
    const def = (type: 'number' | 'date' | 'text') => ({ key: 'k', label: 'K', type, options: [] });
    expect(checkFieldValue(def('number'), '3.5')).toEqual({ ok: true, value: 3.5 });
    expect(checkFieldValue(def('date'), '2026-02-30').ok).toBe(false);          // not a real day
    expect(checkFieldValue(def('date'), '2026-02-28')).toEqual({ ok: true, value: '2026-02-28' });
    expect(checkFieldValue(def('text'), 'x'.repeat(501)).ok).toBe(false);
  });
});
