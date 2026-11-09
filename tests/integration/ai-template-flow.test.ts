import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse, LlmToolCall } from '@crm/llm';
import {
  autoReply, claimCampaignReply, createOrgWithAdmin, addUserToOrg, saveAiSettings, saveTemplate, campaignAiUsage, stopCampaignAi, recordAiRun, writeExample, suggestFillIns, detectSensitive, rewriteKnowledge, listAiUsage, AiTemplateError
} from '@crm/core';

/**
 * The AI template in use: who a chat is handed to when the AI is not sure, which columns of a person it may see, what every AI call
 * costs in credits, a photo getting the fixed reply, stopping the AI on one campaign, and the example conversation.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** A model that answers with what the test sets and remembers what it was asked. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  text = 'Thanks for replying!';
  toolCalls: LlmToolCall[] = [];
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    return Promise.resolve({ text: this.text, toolCalls: this.toolCalls, usage: { inputTokens: 11, outputTokens: 7 }, model: 'fake-1' });
  }
}

let db: Database;
let orgId: string;
let adminId: string;
let botId: string;
let supervisorId: string;
let senderId: string;
let contactId: string;
let conv: string;
let templateId: string;
let campaignId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
// What this file made must not stay behind: other files (the gateway's dispatch, for one) read every org in the shared database, and a
// pending recipient here carries an opening encrypted with this file's own key.
afterAll(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  await db.$client.end();
});

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

/** A message in the test chat. */
async function say(direction: 'inbound' | 'outbound', body: string, withCampaign = false, contentType = 'text'): Promise<string> {
  const enc = contentType === 'text' ? Buffer.from(kms.encrypt(new TextEncoder().encode(body))) : null;
  return (await rows(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, campaign_id, provider_message_id)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'delivered' : 'sent'}, ${contentType}, ${enc}, ${contentType === 'text' ? kms.blindIndex(body) : null},
            'system', ${withCampaign ? campaignId : null}, ${`wa-${randomBytes(6).toString('hex')}`})
    RETURNING id`))[0]!.id as string;
}
const owner = async () => (await rows(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${conv}`))[0]!.a as string | null;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Pune Cabs', slug: `pc-${randomBytes(3).toString('hex')}`, email: 'a@pc.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true }, { type: 'user', id: adminId })).botUserId!;
  supervisorId = (await addUserToOrg(db, hasher, { orgId, email: 'priya@pc.test', password: 'x', displayName: 'Priya Sharma', role: 'agent' })).userId;
  senderId = (await rows(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`))[0]!.id as string;
  contactId = (await rows(sql`INSERT INTO contact(org_id, display_name, source, custom_fields) VALUES (${orgId}, 'Sunil Patil', 'test', ${JSON.stringify({ city: 'Bangalore', salary_note: 'secret-note' })}::jsonb) RETURNING id`))[0]!.id as string;
  conv = (await rows(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`))[0]!.id as string;
  const t = await saveTemplate(db, orgId, {
    name: 'Driver walk-in', description: 'd', instructions: '', audience: '', firstMessage: 'Hi', knowledge: 'We hire drivers. Walk-in on Saturday.',
    sensitive: [{ detail: 'Pay: 22,000 to 30,000', mode: 'general' }], fallbackUserId: supervisorId, fallbackPhone: '+91 90000 11111', visibleColumns: ['city']
  }, { type: 'user', id: adminId });
  templateId = t.id;
  campaignId = (await rows(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, status, ai_template_id)
    VALUES (${orgId}, 'Walk-in', 'Hello', ${senderId}, 'running', ${templateId}) RETURNING id`))[0]!.id as string;
});

/** Puts the chat with the AI after the campaign message and a customer reply, and returns that reply. */
async function chatWithAi(): Promise<string> {
  await say('outbound', 'Hi Sunil, walk-in on Saturday.', true);
  const reply = await say('inbound', 'What is the pay?');
  await claimCampaignReply(db, orgId, conv);
  return reply;
}

describe('what the AI is told', () => {
  it('names the person who will get in touch, never says "I will check", and sees only the chosen columns', async () => {
    const reply = await chatWithAi();
    const llm = new FakeLlm();
    await autoReply({ db, kms, llm }, orgId, conv, reply);
    const system = llm.calls[0]!.system;
    expect(system).toContain('Priya Sharma (+91 90000 11111) will confirm');
    expect(system).not.toContain('say you will check on it');
    expect(system).toContain('city: Bangalore');
    expect(system).toContain('name: Sunil Patil');
    expect(system).not.toContain('secret-note');
    expect(system).toMatch(/Pay: 22,000 to 30,000: keep it general/);
  });
});

describe('handing a chat over', () => {
  it('gives it to the person the template names, with a note that carries what the customer gave', async () => {
    const reply = await chatWithAi();
    const llm = new FakeLlm();
    llm.toolCalls = [{ name: 'hand_over_to_human', arguments: { reason: 'Sunil Patil, +91 98000 00201, sunil@example.com. Asked about a visa.' } }];
    expect((await autoReply({ db, kms, llm }, orgId, conv, reply)).outcome).toBe('handed_over');
    expect(await owner()).toBe(supervisorId);
    const note = (await rows(sql`SELECT body FROM internal_note WHERE conversation_id = ${conv}`))[0]!.body as string;
    expect(note).toContain('Priya Sharma');
    expect(note).toContain('sunil@example.com');
  });

  it('leaves it with nobody when that person is no longer in the team', async () => {
    const reply = await chatWithAi();
    await db.execute(sql`DELETE FROM org_membership WHERE user_id = ${supervisorId} AND org_id = ${orgId}`);
    const llm = new FakeLlm();
    llm.toolCalls = [{ name: 'hand_over_to_human', arguments: { reason: 'asked for a person' } }];
    await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(await owner()).toBeNull();
  });
});

describe('credits', () => {
  it('counts each model call against the campaign and the template, and not the fixed photo reply', async () => {
    const reply = await chatWithAi();
    const llm = new FakeLlm();
    await autoReply({ db, kms, llm }, orgId, conv, reply);
    const photo = await say('inbound', '', false, 'image');
    await autoReply({ db, kms, llm }, orgId, conv, photo);
    const runs = await rows(sql`SELECT kind, campaign_id AS c, template_id AS t, input_tokens AS i, model FROM ai_run WHERE conversation_id = ${conv} ORDER BY created_at`);
    expect(runs[0]).toMatchObject({ kind: 'reply', c: campaignId, t: templateId, i: 11, model: 'fake-1' });
    expect(runs[1]).toMatchObject({ kind: 'fixed_reply', model: null });
    expect(await campaignAiUsage(db, orgId, campaignId)).toEqual({ credits: 1, openings: 0, replies: 1 });
    const sent = (await rows(sql`SELECT body_enc FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`))[0]!;
    expect(new TextDecoder().decode(kms.decrypt(sent.body_enc as Uint8Array))).toBe('Thanks for your response. We will reach out to you soon.');
  });
});

describe('stopping the AI on one campaign', () => {
  it('moves its chats to the template\'s person, makes the AI skip them, and sends later replies to that person', async () => {
    const reply = await chatWithAi();
    expect(await owner()).toBe(botId);
    await db.transaction((tx) => stopCampaignAi(tx, orgId, campaignId, { type: 'user', id: adminId }));
    expect(await owner()).toBe(supervisorId);
    const llm = new FakeLlm();
    expect((await autoReply({ db, kms, llm }, orgId, conv, reply)).outcome).toBe('skipped');
    expect(llm.calls).toHaveLength(0);

    // A later reply in a chat nobody owns goes to that person too, not to the AI.
    await db.execute(sql`UPDATE conversation SET assignee_user_id = NULL WHERE id = ${conv}`);
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
    expect(await owner()).toBe(supervisorId);
  });
});

describe('the example conversation', () => {
  const draft = () => ({
    knowledge: 'We hire drivers. Walk-in on Saturday.', sensitive: [], fallbackUserId: supervisorId, fallbackPhone: '+91 90000 11111', visibleColumns: ['city']
  });

  it('writes both sides from the template and one person, sends nothing, and costs one credit', async () => {
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ lines: [{ from: 'ai', text: 'Hi Sunil, walk-in on Saturday.' }, { from: 'customer', text: 'Interested' }], note: 'Sunil Patil, +91 98000 00201' });
    const lines = await writeExample({ db, llm }, orgId, { ...draft(), templateId }, contactId);
    expect(lines.map((l) => l.from)).toEqual(['ai', 'customer', 'event']);
    expect(lines[2]!.text).toContain('Priya Sharma');
    expect(llm.calls[0]!.system).toContain('city: Bangalore');
    expect(llm.calls[0]!.system).not.toContain('secret-note');
    expect((await rows(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conv}`))[0]!.n).toBe(0);
    expect((await rows(sql`SELECT kind, template_id AS t FROM ai_run WHERE kind = 'example'`))[0]).toMatchObject({ kind: 'example', t: templateId });
  });

  it('is refused while the AI is off, and says so when the model answers with nothing usable', async () => {
    const llm = new FakeLlm();
    llm.text = 'sorry';
    await expect(writeExample({ db, llm }, orgId, draft(), contactId)).rejects.toBeInstanceOf(AiTemplateError);
    await saveAiSettings(db, orgId, { enabled: false }, { type: 'user', id: adminId });
    await expect(writeExample({ db, llm }, orgId, draft(), contactId)).rejects.toMatchObject({ code: 'ai_off' });
  });
});

describe('suggesting what the AI may see', () => {
  it('takes a file with many columns and returns only column names that are in the file', async () => {
    const columns = Array.from({ length: 90 }, (_, i) => `Column ${String(i)}`).concat(['Current Location', 'Total Experience']);
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ columns: ['Current Location', 'total experience', 'Made Up Column'], reason: 'To check where they live and how senior they are.' });
    const r = await suggestFillIns({ db, llm }, orgId, { knowledge: 'We hire developers.', columns });
    expect(r.columns).toEqual(['Current Location', 'Total Experience']);
    expect(r.reason).toContain('where they live');
    expect(llm.calls[0]!.messages[0]!.content).toContain('Column 89');
    expect((await rows(sql`SELECT kind FROM ai_run WHERE kind = 'fillins'`))).toHaveLength(1);
  });
});

describe('finding sensitive details', () => {
  it('lists the details in the text for the owner to decide, once each, with a starting choice', async () => {
    const llm = new FakeLlm();
    llm.text = JSON.stringify({ items: [
      { detail: 'Company', value: 'Clinisys', suggested: 'general' }, { detail: 'CTC', value: '15 LPA', suggested: 'general' },
      { detail: 'Venue', value: 'Baner Road', suggested: 'show' }, { detail: 'company', value: 'clinisys', suggested: 'show' }, { detail: '', value: 'x', suggested: 'show' }
    ] });
    const items = await detectSensitive({ db, llm }, orgId, 'You represent Clinisys (keep confidential). CTC is 15 LPA. Venue: Baner Road.');
    expect(items).toEqual([
      { detail: 'Company', value: 'Clinisys', suggested: 'general' }, { detail: 'CTC', value: '15 LPA', suggested: 'general' }, { detail: 'Venue', value: 'Baner Road', suggested: 'show' }
    ]);
    expect(llm.calls[0]!.messages[0]!.content).toContain('Clinisys');
  });

  it('is refused for empty text, and says so when the AI answers with nothing usable', async () => {
    const llm = new FakeLlm();
    await expect(detectSensitive({ db, llm }, orgId, '   ')).rejects.toMatchObject({ code: 'invalid' });
    llm.text = 'no json here';
    await expect(detectSensitive({ db, llm }, orgId, 'Some text')).rejects.toMatchObject({ code: 'no_model' });
  });
});

describe('rewriting what the AI knows', () => {
  const sensitive = [{ detail: 'company name: Clinisys', mode: 'general' as const }, { detail: 'event date: 10th November', mode: 'show' as const }];
  const knowledge = '- What is the name of the company? Clinisys\n- Walk-in on 10th November';

  it('asks the AI again when an exact value is left in, and returns the clean text', async () => {
    const llm = new FakeLlm();
    const answers = ['- You represent Clinisys.\n- Walk-in on 10th November.', '- You represent a software company.\n- Walk-in on 10th November.'];
    llm.complete = (req) => { llm.calls.push(req); return Promise.resolve({ text: answers[llm.calls.length - 1]!, toolCalls: [], usage: { inputTokens: 3, outputTokens: 3 }, model: 'fake-1' }); };
    const text = await rewriteKnowledge({ db, llm }, orgId, { knowledge, sensitive });
    expect(text).toBe(answers[1]);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages[0]!.content).toContain('Clinisys');
    expect((await rows(sql`SELECT count(*)::int AS n FROM ai_run WHERE kind = 'rewrite'`))[0]!.n).toBe(2);
  });

  it('refuses, rather than saving, when the exact value is still there after the second try', async () => {
    const llm = new FakeLlm();
    llm.text = '- You represent Clinisys.';
    await expect(rewriteKnowledge({ db, llm }, orgId, { knowledge, sensitive })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('keeps a detail the owner chose to show, and is refused for empty text', async () => {
    const llm = new FakeLlm();
    llm.text = '- Walk-in on 10th November.';
    expect(await rewriteKnowledge({ db, llm }, orgId, { knowledge, sensitive: [sensitive[1]!] })).toContain('10th November');
    await expect(rewriteKnowledge({ db, llm }, orgId, { knowledge: ' ', sensitive })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the credit log', () => {
  it('lists each activity with what it took, who did it and the model, and leaves out the fixed photo reply', async () => {
    const reply = await chatWithAi();
    const llm = new FakeLlm();
    await autoReply({ db, kms, llm }, orgId, conv, reply);
    await autoReply({ db, kms, llm }, orgId, conv, await say('inbound', '', false, 'image'));
    llm.text = JSON.stringify({ lines: [{ from: 'ai', text: 'Hi' }], note: 'n' });
    await writeExample({ db, llm }, orgId, { knowledge: 'We hire.', sensitive: [], fallbackUserId: null, fallbackPhone: '', visibleColumns: [], templateId }, contactId, adminId);
    const log = await listAiUsage(db, orgId);
    expect(log).toMatchObject({ today: 2, month: 2, total: 2 });
    const campaign = log.activities.find((a) => a.scope === 'campaign')!;
    expect(campaign).toMatchObject({ name: 'Walk-in', who: null, credits: 1, tokens: 18, models: ['fake-1'] });
    expect(campaign.parts).toEqual([{ kind: 'reply', count: 1 }]);
    const template = log.activities.find((a) => a.scope === 'template')!;
    expect(template).toMatchObject({ name: 'Driver walk-in', who: 'Admin', credits: 1 });
    expect(template.parts).toEqual([{ kind: 'example', count: 1 }]);
  });

  it('adds up exactly when many people and chats record at the same moment: calls are only appended, never counted up in place', async () => {
    const calls = Array.from({ length: 40 }, (_, i) => recordAiRun(db, {
      orgId, kind: i % 2 === 0 ? 'opening' : 'reply', outcome: 'written', model: 'fake-1', usage: { inputTokens: 2, outputTokens: 1 },
      campaignId, templateId, userId: null
    }));
    const people = Array.from({ length: 10 }, (_, i) => recordAiRun(db, { orgId, kind: 'rewrite', outcome: 'done', model: 'fake-1', usage: { inputTokens: 1, outputTokens: 1 }, templateId, userId: i % 2 === 0 ? adminId : supervisorId }));
    await Promise.all([...calls, ...people]);
    const log = await listAiUsage(db, orgId);
    expect(log.total).toBe(50);
    // the totals and the activities come from the same statement, so they always agree
    expect(log.activities.reduce((n, a) => n + a.credits, 0)).toBe(50);
    expect(log.activities.find((a) => a.scope === 'campaign')!.credits).toBe(40);
    expect(log.activities.filter((a) => a.scope === 'template').map((a) => [a.who, a.credits]).sort()).toEqual([['Admin', 5], ['Priya Sharma', 5]]);
  });
});
