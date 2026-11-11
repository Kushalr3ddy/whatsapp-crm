import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { autoReply, claimCampaignReply, createOrgWithAdmin, saveAiSettings, ungroundedClaims, UNGROUNDED_FALLBACK_REPLY } from '@crm/core';

/**
 * [#47, #92] (2026-11-09, found by: live run, LV-3 and LF-14). The AI asked a person to confirm "tomorrow 11 am" for an interview the chat showed at
 * 4:00 PM on 15 Nov, and told another to "bring a copy of your resume and a valid ID" that nothing in its instructions mentioned. The prompt already
 * says never to guess; a request is not a guarantee. The answer is now checked before it is queued: a time, date, amount or document to bring that
 * appears nowhere in the instructions, the facts about the person or the chat is the model's invention. The model gets one more try with the detail
 * named; if it does it again, nothing it made up is sent, the customer is told a colleague will confirm, and the chat goes to a person.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** A model that answers from a script, one answer per call, and remembers what it was asked. */
class ScriptedLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  constructor(private readonly answers: string[]) {}
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)]!;
    return Promise.resolve({ text, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake-1' });
  }
}
const turn = (reply: string): string => JSON.stringify({ reply, status: 'talking', summary: 's', handover: false });

let db: Database;
let orgId: string;
let adminId: string;
let senderId: string;
let conv: string;
let templateId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

/** A message in the test chat; `campaignId` marks it as sent by that campaign. */
async function say(direction: 'inbound' | 'outbound', body: string, campaignId: string | null = null, sentBy = 'system'): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, campaign_id, provider_message_id)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'delivered' : 'sent'}, 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, ${sentBy}, ${campaignId}, ${`wa-${randomBytes(6).toString('hex')}`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme Hiring', slug: 'acme-ground', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'ORG-WIDE: answer about jobs only.' }, { type: 'user', id: adminId });
  senderId = ((await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const contactId = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  templateId = ((await db.execute(sql`
    INSERT INTO ai_template (org_id, name, description, instructions, created_by)
    VALUES (${orgId}, 'Welding drive', 'd', 'CAMPAIGN TEMPLATE: ask which city they are in.', ${adminId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

describe('[R-057] [#47, #92] the details the AI is allowed to state', () => {
  const chat = 'Your interview is on 15 Nov at 4:00 PM at our Pune office. Reply YES to confirm.';

  it('[#47] an invented time is found: "tomorrow 11 am" when the chat says 4:00 PM on 15 Nov', () => {
    expect(ungroundedClaims('Great! Please confirm tomorrow 11 am.', chat)).toEqual([{ kind: 'time', text: '11 am' }]);
  });
  it('[#47] the time that was given is not flagged, written any of the ways', () => {
    for (const reply of ['See you at 4 PM.', 'See you at 4:00 pm on 15 Nov.', 'See you at 4 p.m. on 15th November.', 'We expect you on Nov 15 at 4pm.']) {
      expect(ungroundedClaims(reply, chat), reply).toEqual([]);
    }
  });
  it('[#47] a date that was not given is found, and one that was is not', () => {
    expect(ungroundedClaims('We will meet on 18 Nov.', chat)).toEqual([{ kind: 'date', text: '18 nov' }]);
    expect(ungroundedClaims('We will meet on 15 Nov.', chat)).toEqual([]);
  });
  it('[#92] "bring a copy of your resume and a valid ID" is found when no instruction mentions them', () => {
    expect(ungroundedClaims('Please bring a copy of your resume and a valid ID.', 'Ask which city they are in.')).toEqual([{ kind: 'document', text: 'resume' }]);
  });
  it('[#92] a document the instructions or the customer mention is allowed', () => {
    expect(ungroundedClaims('Please bring your resume.', 'Candidates should bring their resume to the walk-in.')).toEqual([]);
    expect(ungroundedClaims('Yes, bring your aadhaar card.', 'Do I need to bring my Aadhaar card?')).toEqual([]);
  });
  it('[#47] an amount nobody gave is found; the same figure written another way is not', () => {
    expect(ungroundedClaims('The pay is ₹25,000 per month.', 'Pay is discussed by the recruiter.')).toEqual([{ kind: 'amount', text: '₹25000' }]);
    expect(ungroundedClaims('The pay is ₹25,000 per month.', 'Salary: 25000 a month, never share it before the interview.')).toEqual([]);
  });
  it('an ordinary answer with no concrete detail is never flagged', () => {
    for (const reply of ['Thanks for replying! Which city are you in?', 'Sure, a colleague will call you today.', 'Happy to help. Do you have a driving licence?']) {
      expect(ungroundedClaims(reply, 'Ask which city they are in.'), reply).toEqual([]);
    }
  });
});

describe('[R-057] [#47, #92] the reply that is queued', () => {
  async function arrange(): Promise<{ reply: string }> {
    const camp = ((await db.execute(sql`
      INSERT INTO campaign (org_id, name, body, sender_identity_id, status, ai_template_id)
      VALUES (${orgId}, 'Outreach', 'Hello!', ${senderId}, 'running', ${templateId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await say('outbound', 'Hello Asha, your interview is on 15 Nov at 4:00 PM.', camp);
    const reply = await say('inbound', 'Yes I will come');
    await claimCampaignReply(db, orgId, conv);
    return { reply };
  }
  const sentText = async (): Promise<string[]> => ((await db.execute(sql`
    SELECT body_enc AS b FROM message WHERE conversation_id = ${conv} AND direction = 'outbound' AND sent_by = 'agent' ORDER BY created_at`)) as unknown as Array<{ b: Uint8Array }>)
    .map((r) => new TextDecoder().decode(kms.decrypt(r.b)));

  it('[#47] an answer with only given details is sent as it is, in one model call', async () => {
    const { reply } = await arrange();
    const llm = new ScriptedLlm([turn('Great, see you at 4 PM on 15 Nov!')]);
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r.outcome).toBe('sent');
    expect(llm.calls).toHaveLength(1);
    expect(await sentText()).toEqual(['Great, see you at 4 PM on 15 Nov!']);
  });

  it('[#47] an invented time is sent back to the model once, and the corrected answer is what goes out', async () => {
    const { reply } = await arrange();
    const llm = new ScriptedLlm([turn('Please confirm tomorrow 11 am.'), turn('Great, see you at 4 PM on 15 Nov!')]);
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r.outcome).toBe('sent');
    expect(llm.calls).toHaveLength(2);
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain('11 am');
    expect(await sentText()).toEqual(['Great, see you at 4 PM on 15 Nov!']);
  });

  it('[#92] an invention the second try repeats is never sent: the customer is told a colleague will confirm, and the chat goes to a person with a note', async () => {
    const { reply } = await arrange();
    const llm = new ScriptedLlm([turn('Bring a copy of your resume and a valid ID.'), turn('Do bring your resume and ID proof.')]);
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r.outcome).toBe('handed_over');
    expect(llm.calls).toHaveLength(2);
    expect(await sentText()).toEqual([UNGROUNDED_FALLBACK_REPLY]);
    const notes = ((await db.execute(sql`SELECT body FROM internal_note WHERE conversation_id = ${conv}`)) as unknown as Array<{ body: string }>).map((n) => n.body).join(' ');
    expect(notes).toContain('resume');
    expect(notes).toContain('Please confirm it with them');
  });

  it('[#47] the two model calls are both counted in the usage', async () => {
    const { reply } = await arrange();
    await autoReply({ db, kms, llm: new ScriptedLlm([turn('Come tomorrow 11 am.'), turn('See you at 4 PM.')]) }, orgId, conv, reply);
    const run = (await db.execute(sql`SELECT input_tokens AS i, output_tokens AS o FROM ai_run WHERE conversation_id = ${conv} ORDER BY created_at DESC LIMIT 1`)) as unknown as Array<{ i: number; o: number }>;
    expect(run[0]).toEqual({ i: 10, o: 10 });
  });
});
