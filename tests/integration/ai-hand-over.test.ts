import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { createOrgWithAdmin, addUserToOrg, createSession, saveAiSettings } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Handing one chat to the AI assistant from the inbox: the assistant shows up in the user list as the AI (so the button can find it),
 * a person assigns the chat to it with the ordinary thread update, and `answer-now` has it answer the contact's waiting message.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

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
let agentId: string;
let conv: string;
let agent: Record<string, string>;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  llm = new FakeLlm();
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage, llm });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (token: string): Record<string, string> => ({ Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' });

async function addMessage(direction: 'inbound' | 'outbound', body: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, provider_message_id, sent_by)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'received' : 'sent'}, 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
            ${kms.blindIndex(body)}, ${direction === 'inbound' ? `wa-${randomBytes(6).toString('hex')}` : null}, 'user')`);
}

const agentMessages = async (): Promise<number> =>
  ((await db.execute(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' AND sent_by = 'agent'`)) as unknown as Array<{ n: number }>)[0]!.n;

/** The answer is started in the background; wait for it to land. */
async function waitForAnswer(): Promise<void> {
  for (let i = 0; i < 40 && (await agentMessages()) === 0; i++) await new Promise((r) => setTimeout(r, 50));
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  llm.calls = [];
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-handover', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  const a = await addUserToOrg(db, hasher, { orgId, email: 'agent@acme.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentId = a.userId;
  agent = asSession((await createSession(db, { userId: agentId, orgId })).token);
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'Jobs only.' }, { type: 'user', id: org.userId })).botUserId!;
  const s = (await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)) as unknown as Array<{ id: string }>;
  const contact = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id) VALUES (${orgId}, ${contact}, ${s[0]!.id}, ${agentId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

const answerNow = () => request(app).post(`/api/v1/ai/conversations/${conv}/answer-now`).set(agent).send({});
const assign = (assigneeUserId: string) => request(app).patch(`/api/v1/conversations/${conv}`).set(agent).send({ assigneeUserId });

describe('handing a chat to the AI', () => {
  it('lists the assistant as the AI user, so the inbox can find it', async () => {
    const users = (await request(app).get('/api/v1/users').set(agent)).body.data as Array<{ id: string; isBot: boolean }>;
    expect(users.find((u) => u.id === botId)?.isBot).toBe(true);
    expect(users.find((u) => u.id === agentId)?.isBot).toBe(false);
  });

  it('answers the waiting message once the chat is assigned to the assistant', async () => {
    await addMessage('inbound', 'Are you hiring?');
    expect((await assign(botId)).status).toBe(200);
    const r = await answerNow();
    expect(r.body.data).toEqual({ answering: true });
    await waitForAnswer();
    expect(await agentMessages()).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  it('does not answer a chat that is still a person\'s', async () => {
    await addMessage('inbound', 'Are you hiring?');
    await answerNow();
    await new Promise((r) => setTimeout(r, 300));
    expect(await agentMessages()).toBe(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('does nothing when the last word was ours: the assistant answers the next message on its own', async () => {
    await addMessage('inbound', 'Hi');
    await addMessage('outbound', 'Hello!');
    await assign(botId);
    expect((await answerNow()).body.data).toEqual({ answering: false });
    expect(llm.calls).toHaveLength(0);
  });
});
