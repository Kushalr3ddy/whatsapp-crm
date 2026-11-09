import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse, LlmToolCall } from '@crm/llm';
import {
  autoReply, claimCampaignReply, createOrgWithAdmin, addUserToOrg, saveAiSettings, saveTemplate, writeOpenings, systemText, parseAiTurn, listCampaignAiStatus
} from '@crm/core';

/**
 * How the AI talks: one short message at a time, from the organisation (never "the assistant"), until the conversation reaches its
 * end; and what it reports after each turn so a person sees who is interested without reading every chat.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** A model that answers with what the test sets and remembers what it was asked. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  text = '';
  toolCalls: LlmToolCall[] = [];
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    return Promise.resolve({ text: this.text, toolCalls: this.toolCalls, usage: { inputTokens: 11, outputTokens: 7 }, model: 'fake-1' });
  }
}

let db: Database;
let orgId: string;
let adminId: string;
let supervisorId: string;
let senderId: string;
let contactId: string;
let conv: string;
let campaignId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

/** A message in the test chat. */
async function say(direction: 'inbound' | 'outbound', body: string, withCampaign = false): Promise<string> {
  return (await rows(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, campaign_id, provider_message_id)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'delivered' : 'sent'}, 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
            ${kms.blindIndex(body)}, 'system', ${withCampaign ? campaignId : null}, ${`wa-${randomBytes(6).toString('hex')}`})
    RETURNING id`))[0]!.id as string;
}
const lastSent = async (): Promise<string> => {
  const r = (await rows(sql`SELECT body_enc FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`))[0]!;
  return new TextDecoder().decode(kms.decrypt(r.body_enc as Uint8Array));
};
const recipient = async (): Promise<Row> =>
  (await rows(sql`SELECT ai_status AS status, ai_summary AS summary, ai_status_at AS at FROM campaign_recipient WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}`))[0]!;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Pune Cabs', slug: `pc-${randomBytes(3).toString('hex')}`, email: 'a@pc.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true }, { type: 'user', id: adminId });
  supervisorId = (await addUserToOrg(db, hasher, { orgId, email: 'priya@pc.test', password: 'x', displayName: 'Priya Sharma', role: 'agent' })).userId;
  senderId = (await rows(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`))[0]!.id as string;
  contactId = (await rows(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Sunil Patil', 'test') RETURNING id`))[0]!.id as string;
  conv = (await rows(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`))[0]!.id as string;
  const t = await saveTemplate(db, orgId, {
    name: 'Driver walk-in', description: 'd', instructions: '', audience: '', firstMessage: 'Hi', knowledge: 'We hire drivers. Walk-in on Saturday. Bring ID and resume.',
    fallbackUserId: supervisorId, fallbackPhone: '+91 90000 11111'
  }, { type: 'user', id: adminId });
  campaignId = (await rows(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, status, ai_template_id)
    VALUES (${orgId}, 'Walk-in', 'Hello', ${senderId}, 'running', ${t.id}) RETURNING id`))[0]!.id as string;
  await db.execute(sql`INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status) VALUES (${orgId}, ${campaignId}, ${contactId}, 'sent')`);
});

/** The chat after the campaign message and a customer reply; returns that reply. */
async function chatWithAi(text = 'Yes how much is the salary?'): Promise<string> {
  await say('outbound', 'Hi Sunil, walk-in on Saturday.', true);
  const reply = await say('inbound', text);
  await claimCampaignReply(db, orgId, conv);
  return reply;
}

describe('the rules the AI follows', () => {
  const rules = systemText('Pune Cabs', 'We hire drivers.', { fallback: { name: 'Priya Sharma', phone: '+91 90000 11111' } });

  it('speaks for the organisation and never calls itself an assistant, an AI or a bot', () => {
    expect(rules).not.toMatch(/you are the whatsapp assistant/i);
    expect(rules).toMatch(/never call yourself an assistant/i);
    expect(rules).toContain('from Pune Cabs');
  });

  it('is told to run the conversation to its end and not to hand over just because it has their details', () => {
    expect(rules).toMatch(/do not hand over just because/i);
    expect(rules).toMatch(/never say that something will be discussed/i);
    expect(rules).toMatch(/recap/i);
    expect(rules).toMatch(/one question per message/i);
    expect(rules).toContain('Priya Sharma (+91 90000 11111) will confirm');
  });

  it('keeps every message short', () => {
    expect(rules).toMatch(/under 240 characters/);
  });

  it('asks for one JSON object with the reply, a status and a summary, unless a plain message is wanted', () => {
    expect(rules).toContain('"reply"');
    expect(rules).toContain('"status"');
    expect(rules).toContain('"summary"');
    expect(systemText('Pune Cabs', 'x', { output: 'plain' })).not.toContain('"status"');
  });
});

describe('reading the AI\'s answer', () => {
  it('takes the reply, the status and the summary out of the JSON, even inside a code fence', () => {
    const turn = parseAiTurn('```json\n{"reply":"Great!","status":"interested","summary":"6 years driving."}\n```');
    expect(turn).toEqual({ reply: 'Great!', status: 'interested', summary: '6 years driving.', handover: false });
  });

  it('sends plain text as it is, with no status', () => {
    expect(parseAiTurn('Thanks for replying!')).toEqual({ reply: 'Thanks for replying!', status: null, summary: null, handover: false });
  });

  it('never lets JSON that did not finish reach the customer', () => {
    expect(parseAiTurn('{"reply": "Hi there, are you')).toEqual({ reply: '', status: null, summary: null, handover: false });
  });

  it('reads that the conversation is finished', () => {
    expect(parseAiTurn('{"reply":"Thanks, see you Saturday.","status":"interested","summary":"Coming.","handover":true}').handover).toBe(true);
  });

  it('ignores a status it does not know', () => {
    expect(parseAiTurn('{"reply":"Hi","status":"maybe","summary":""}')).toEqual({ reply: 'Hi', status: null, summary: null, handover: false });
  });
});

describe('what a turn leaves on the contact', () => {
  it('sends only the reply text and keeps the latest status and summary for the campaign page', async () => {
    const inbound = await chatWithAi();
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ reply: 'Salary depends on experience; Priya will confirm. Which area do you live in?', status: 'talking', summary: 'Asked about salary.' });
    expect((await autoReply({ db, kms, llm }, orgId, conv, inbound)).outcome).toBe('sent');
    expect(await lastSent()).toBe('Salary depends on experience; Priya will confirm. Which area do you live in?');
    expect(await recipient()).toMatchObject({ status: 'talking', summary: 'Asked about salary.' });

    const next = await say('inbound', 'Koramangala. Should I bring any documents?');
    llm.text = JSON.stringify({ reply: 'Please bring your ID and resume. Can you come on Saturday?', status: 'interested', summary: 'Lives in Koramangala. Asked about salary and documents.' });
    await autoReply({ db, kms, llm }, orgId, conv, next);
    expect(await recipient()).toMatchObject({ status: 'interested', summary: 'Lives in Koramangala. Asked about salary and documents.' });
    expect((await recipient()).at).not.toBeNull();
  });

  it('keeps the earlier status and summary when an answer has none, and still sends it', async () => {
    const inbound = await chatWithAi();
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ reply: 'Hello!', status: 'interested', summary: 'Keen.' });
    await autoReply({ db, kms, llm }, orgId, conv, inbound);
    const next = await say('inbound', 'ok');
    llm.text = 'Plain words, no JSON.';
    await autoReply({ db, kms, llm }, orgId, conv, next);
    expect(await lastSent()).toBe('Plain words, no JSON.');
    expect(await recipient()).toMatchObject({ status: 'interested', summary: 'Keen.' });
  });

  it('sends nothing when the answer is JSON that did not finish', async () => {
    const inbound = await chatWithAi();
    const llm = new FakeLlm();
    llm.text = '{"reply": "Hi there, are you';
    expect((await autoReply({ db, kms, llm }, orgId, conv, inbound)).outcome).toBe('skipped');
    expect((await rows(sql`SELECT 1 FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' AND sent_by = 'agent'`))).toHaveLength(0);
  });

  it('hands the chat over from the JSON, sending the closing message and keeping the status it gave', async () => {
    const inbound = await chatWithAi('Yes that is correct');
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ reply: 'Great, see you on Saturday.', status: 'interested', summary: 'Confirmed Saturday. Sunil, 98000 00201.', handover: true });
    expect((await autoReply({ db, kms, llm }, orgId, conv, inbound)).outcome).toBe('handed_over');
    expect(await lastSent()).toBe('Great, see you on Saturday.');
    expect((await rows(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${conv}`))[0]!.a).toBe(supervisorId);
    expect(await recipient()).toMatchObject({ status: 'interested', summary: 'Confirmed Saturday. Sunil, 98000 00201.' });
    const note = (await rows(sql`SELECT body FROM internal_note WHERE conversation_id = ${conv}`))[0]!.body as string;
    expect(note).toContain('Confirmed Saturday');
  });

  it('records the status the model gave when it also hands the chat over', async () => {
    const inbound = await chatWithAi('Please get a person to call me');
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ reply: 'Sure, Priya will call you.', status: 'needs_person', summary: 'Wants a call.' });
    llm.toolCalls = [{ name: 'hand_over_to_human', arguments: { reason: 'Asked for a person.' } }];
    expect((await autoReply({ db, kms, llm }, orgId, conv, inbound)).outcome).toBe('handed_over');
    expect(await recipient()).toMatchObject({ status: 'needs_person', summary: 'Wants a call.' });
  });
});

describe('the campaign page numbers', () => {
  it('counts the people in each status and lists each one\'s summary, and counts people who never answered', async () => {
    const others = [['Asha', 'interested', 'Can come Saturday.'], ['Ravi', 'not_interested', 'Has a job.'], ['Meena', 'needs_person', 'Asked about pay.']] as const;
    for (const [name, status, summary] of others) {
      const id = (await rows(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, ${name}, 'test') RETURNING id`))[0]!.id as string;
      await db.execute(sql`INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status, ai_status, ai_summary) VALUES (${orgId}, ${campaignId}, ${id}, 'sent', ${status}, ${summary})`);
    }
    const out = await listCampaignAiStatus(db, orgId, campaignId);
    expect(out).toEqual({ interested: 1, not_interested: 1, needs_person: 1, talking: 0, noAnswer: 1 });
  });
});

describe('the first message', () => {
  it('is told to be short and from the organisation, never "the assistant"', async () => {
    const llm = new FakeLlm();
    llm.text = 'Hi Sunil, Pune Cabs is holding a driver walk-in this Saturday. Can you come?';
    await db.execute(sql`UPDATE campaign_recipient SET status = 'pending' WHERE campaign_id = ${campaignId}`);
    expect(await writeOpenings({ db, kms, llm }, { orgId, campaignId })).toBe(1);
    const system = llm.calls[0]!.system;
    expect(system).toMatch(/at most 2 short sentences/i);
    expect(system).toMatch(/under 220 characters/i);
    expect(system).toMatch(/never "assistant"/i);
    expect(system).not.toContain('"status"');
    expect(system).not.toMatch(/you are the whatsapp assistant/i);
  });
});
