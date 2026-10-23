import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { autoReply, createOrgWithAdmin, getAiNotice, saveAiSettings } from '@crm/core';

/**
 * R-012 (2026-10-23, area: ai, found by: Kushal, issue #155): the contact answered the campaign's first question and the AI said nothing.
 * The model was a reasoning model (`openai/gpt-oss-20b`): it spends output tokens on hidden thinking first, and the reply was asked for with a
 * 400-token budget, so all of it went on thinking, the answer came back empty and the run was recorded as skipped (`empty_answer`).
 * Now a reply is asked for with a budget big enough to think and still answer.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** A reasoning model: it needs about 1,200 tokens of thinking before any text, and answers nothing if the budget runs out first. */
class ReasoningLlm implements LlmDriver {
  readonly name = 'fake-reasoning';
  calls: LlmRequest[] = [];
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const budget = req.maxTokens ?? 1024;
    const answered = budget > 1200;
    return Promise.resolve({
      text: answered ? 'Great! Which city are you in?' : '', toolCalls: [],
      usage: { inputTokens: 650, outputTokens: Math.min(budget, answered ? 1230 : budget) }, model: 'fake-reasoning-1'
    });
  }
}

let db: Database;
let orgId: string;
let conv: string;
let lastInbound: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme Hiring', slug: 'acme-r012', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  const botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'Ask which city they are in.' }, { type: 'user', id: org.userId })).botUserId!;
  const senderId = ((await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const contactId = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id) VALUES (${orgId}, ${contactId}, ${senderId}, ${botId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const say = async (direction: 'inbound' | 'outbound', body: string): Promise<string> => ((await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, provider_message_id)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'delivered' : 'sent'}, 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, 'system', ${`wa-${randomBytes(6).toString('hex')}`})
    RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  await say('outbound', 'Hello Asha, are you interested in a welding job?');
  lastInbound = await say('inbound', 'Yes I am interested');
});

/** A model that always answers with nothing, whatever the budget. */
class SilentLlm implements LlmDriver {
  readonly name = 'fake-silent';
  complete(): Promise<LlmResponse> {
    return Promise.resolve({ text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 0 }, model: 'fake-silent-1' });
  }
}

describe('the AI answers the contact\'s reply with a reasoning model', () => {
  it('[R-012] sends a follow-up instead of an empty answer', async () => {
    const llm = new ReasoningLlm();
    const r = await autoReply({ db, kms, llm }, orgId, conv, lastInbound);
    expect(r.outcome).toBe('sent');
    const out = (await db.execute(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' AND sent_by = 'agent'`)) as unknown as Array<{ n: number }>;
    expect(out[0]!.n).toBe(1);
  });

  it('[R-012] is not recorded as skipped for an empty answer', async () => {
    await autoReply({ db, kms, llm: new ReasoningLlm() }, orgId, conv, lastInbound);
    const runs = (await db.execute(sql`SELECT outcome, reason FROM ai_run WHERE conversation_id = ${conv}`)) as unknown as Array<{ outcome: string; reason: string | null }>;
    expect(runs.map((x) => x.reason)).not.toContain('empty_answer');
  });

  it('[R-012] when a model still answers with nothing, the thread gets a warning instead of looking quiet', async () => {
    const r = await autoReply({ db, kms, llm: new SilentLlm() }, orgId, conv, lastInbound);
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'empty_answer' });
    const notice = await getAiNotice(db, orgId, conv);
    expect(notice?.code).toBe('no_answer');
  });
});
