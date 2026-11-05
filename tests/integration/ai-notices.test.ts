import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey, saveAiSettings, autoReply } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The AI assistant's warnings: when a hold on the number, its own limit or the provider holds it back, the
 * thread says so; only a do-not-contact block can be lifted, by a signed-in admin, for one message, with a reason.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

/** A model that answers a fixed reply and counts how often it was asked. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    return Promise.resolve({ text: 'Happy to help.', toolCalls: [], usage: { inputTokens: 4, outputTokens: 3 }, model: 'fake-1' });
  }
}

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let llm: FakeLlm;
let orgId: string;
let botId: string;
let adminId: string;
let conv: string;
let contact: string;
let inboundId: string;
let admin: Record<string, string>;
let agent: Record<string, string>;
let apiKey: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  llm = new FakeLlm();
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage, llm });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** The headers a browser session sends: the session cookie plus a matching CSRF pair. */
function asSession(token: string): Record<string, string> {
  return { Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
}

/** Inserts a text message into the test conversation. */
async function addMessage(direction: 'inbound' | 'outbound', body: string, status: string, extra: { holdReason?: string; sentBy?: string } = {}): Promise<string> {
  return ((await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, provider_message_id, hold_reason, sent_by, sent_by_user_id)
    VALUES (${orgId}, ${conv}, ${direction}, ${status}, 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)},
            ${direction === 'inbound' ? `wa-${randomBytes(6).toString('hex')}` : null}, ${extra.holdReason ?? null}, ${extra.sentBy ?? 'system'},
            ${extra.sentBy === 'agent' ? botId : null})
    RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  llm.calls = [];
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-notice', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminId = org.userId;
  admin = asSession((await createSession(db, { userId: adminId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'agent@acme.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agent = asSession((await createSession(db, { userId: a.userId, orgId })).token);
  apiKey = (await issueApiKey(db, { orgId, name: 'k', scopes: ['conversations:read'] })).secret;
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'Jobs only.' }, { type: 'user', id: adminId })).botUserId!;
  const s = await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`) as unknown as Array<{ id: string }>;
  contact = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id) VALUES (${orgId}, ${contact}, ${s[0]!.id}, ${botId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  inboundId = await addMessage('inbound', 'Are you hiring?', 'received');
});

/** Reads the notice as the given headers. */
const notice = (h: Record<string, string> = agent) => request(app).get(`/api/v1/ai/conversations/${conv}/notice`).set(h);
/** Asks to let the assistant answer anyway. */
const allow = (h: Record<string, string>, body: object) => request(app).post(`/api/v1/ai/conversations/${conv}/allow-reply`).set(h).send(body);
/** Runs the assistant the normal way. */
const run = () => autoReply({ db, kms, llm }, orgId, conv, inboundId);

describe('AI assistant warnings', () => {
  it('says nothing when all is well, or when the chat is not the assistant’s', async () => {
    expect((await notice()).body.data).toBeNull();
    await db.execute(sql`UPDATE conversation SET assignee_user_id = ${adminId} WHERE id = ${conv}`);
    await db.execute(sql`INSERT INTO ai_run (org_id, conversation_id, kind, outcome, reason) VALUES (${orgId}, ${conv}, 'reply', 'blocked', 'do_not_contact')`);
    expect((await notice()).body.data).toBeNull();
  });

  it('a reply the anti-ban policy is holding is a warning with no override', async () => {
    await addMessage('outbound', 'Yes!', 'queued', { holdReason: 'policy_hold', sentBy: 'agent' });
    expect((await notice()).body.data).toEqual({ code: 'held', reason: 'policy_hold', canOverride: false });
  });

  it('a number that is not connected is a hold too', async () => {
    await addMessage('outbound', 'Yes!', 'queued', { holdReason: 'sender_not_connected', sentBy: 'agent' });
    expect((await notice()).body.data).toEqual({ code: 'held', reason: 'sender_not_connected', canOverride: false });
  });

  it('do-not-contact: warns everyone, and only an admin can allow the one reply', async () => {
    await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contact}`);
    expect((await run()).outcome).toBe('blocked');
    expect((await notice(agent)).body.data).toEqual({ code: 'do_not_contact', reason: 'do_not_contact', canOverride: true });

    // Not an agent, not an API key, not without a reason.
    expect((await allow(agent, { reason: 'the customer asked us to reply' })).status).toBe(403);
    expect((await allow({ Authorization: `Bearer ${apiKey}` }, { reason: 'the customer asked us to reply' })).status).toBe(403);
    expect((await allow(admin, { reason: 'short' })).status).toBe(422);
    expect(llm.calls).toHaveLength(0);

    const ok = await allow(admin, { reason: 'the customer wrote to us first and asked a question' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.outcome).toBe('sent');
    const sent = await db.execute(sql`SELECT dnc_override, dnc_override_reason, sent_by FROM message WHERE conversation_id = ${conv} AND direction = 'outbound'`) as unknown as Array<{ dnc_override: boolean; dnc_override_reason: string; sent_by: string }>;
    expect(sent).toEqual([{ dnc_override: true, dnc_override_reason: 'the customer wrote to us first and asked a question', sent_by: 'agent' }]);
    const audit = await db.execute(sql`SELECT actor_id, after FROM audit_log WHERE org_id = ${orgId} AND action = 'message.dnc_overridden'`) as unknown as Array<{ actor_id: string; after: { by: string } }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: adminId, after: { by: 'ai_assistant' } });
    // The warning is gone once it has answered.
    expect((await notice()).body.data).toBeNull();
  });

  it('the assistant never overrides do-not-contact by itself', async () => {
    await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contact}`);
    await run();
    await run();
    expect(await db.execute(sql`SELECT 1 FROM message WHERE conversation_id = ${conv} AND direction = 'outbound'`)).toHaveLength(0);
  });

  it('shows the daily limit and a provider failure as warnings with no override', async () => {
    await db.execute(sql`INSERT INTO ai_run (org_id, conversation_id, kind, outcome, reason) VALUES (${orgId}, ${conv}, 'reply', 'blocked', 'daily_cap')`);
    expect((await notice()).body.data).toEqual({ code: 'daily_cap', reason: 'daily_cap', canOverride: false });
    await db.execute(sql`DELETE FROM ai_run`);
    await db.execute(sql`INSERT INTO ai_run (org_id, conversation_id, kind, outcome, reason) VALUES (${orgId}, ${conv}, 'reply', 'failed', 'model_timeout')`);
    expect((await notice()).body.data).toEqual({ code: 'model_error', reason: 'model_timeout', canOverride: false });
  });

  it('clears once something has been sent in the thread since', async () => {
    await db.execute(sql`INSERT INTO ai_run (org_id, conversation_id, kind, outcome, reason) VALUES (${orgId}, ${conv}, 'reply', 'failed', 'model_timeout')`);
    expect((await notice()).body.data).not.toBeNull();
    await addMessage('outbound', 'A person answered', 'sent');
    expect((await notice()).body.data).toBeNull();
  });
});
