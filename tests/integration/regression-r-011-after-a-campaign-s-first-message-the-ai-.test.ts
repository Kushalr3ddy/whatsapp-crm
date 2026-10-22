import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { autoReply, claimCampaignReply, createOrgWithAdmin, saveAiSettings } from '@crm/core';

/**
 * R-011 (2026-10-22, area: ai, found by: Kushal): the first message of a campaign went out, but the AI never took over the replies,
 * because nothing assigned the chat to the assistant and the campaign's AI template was never used. Now a reply to a campaign that has
 * an AI template is handed to the assistant (if nobody owns the chat), and the assistant answers with that template's instructions.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** A model that remembers what it was asked. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    return Promise.resolve({ text: 'Thanks for replying!', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake-1' });
  }
}

let db: Database;
let orgId: string;
let adminId: string;
let botId: string;
let senderId: string;
let contactId: string;
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

/** A campaign, with or without an AI template. */
async function campaign(withTemplate: boolean): Promise<string> {
  return ((await db.execute(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, status, ai_template_id)
    VALUES (${orgId}, 'Outreach', 'Hello!', ${senderId}, 'running', ${withTemplate ? templateId : null}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
}

/** Who owns the chat now. */
const owner = async () => ((await db.execute(sql`SELECT assignee_user_id AS "a" FROM conversation WHERE id = ${conv}`)) as unknown as Array<{ a: string | null }>)[0]!.a;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme Hiring', slug: 'acme-camp', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'ORG-WIDE: answer about jobs only.' }, { type: 'user', id: adminId })).botUserId!;
  senderId = ((await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  contactId = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  templateId = ((await db.execute(sql`
    INSERT INTO ai_template (org_id, name, description, instructions, created_by)
    VALUES (${orgId}, 'Welding drive', 'd', 'CAMPAIGN TEMPLATE: ask which city they are in.', ${adminId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

describe('a reply to a campaign that has an AI template', () => {
  it('[R-011] is handed to the assistant when nobody owns the chat', async () => {
    await say('outbound', 'Hello Asha, welders needed.', await campaign(true));
    await say('inbound', 'Yes I am interested');
    expect(await claimCampaignReply(db, orgId, conv)).toBe(true);
    expect(await owner()).toBe(botId);
  });

  it('[R-011] is answered with the campaign template\'s instructions, not the organisation-wide ones', async () => {
    await say('outbound', 'Hello Asha, welders needed.', await campaign(true));
    const reply = await say('inbound', 'Yes I am interested');
    await claimCampaignReply(db, orgId, conv);
    const llm = new FakeLlm();
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r.outcome).toBe('sent');
    expect(llm.calls[0]!.system).toContain('CAMPAIGN TEMPLATE: ask which city they are in.');
    expect(llm.calls[0]!.system).not.toContain('ORG-WIDE');
  });

  it('[R-011] keeps the organisation-wide instructions for a chat that did not come from a campaign with a template', async () => {
    await say('outbound', 'Hello Asha, welders needed.', await campaign(false));
    const reply = await say('inbound', 'Yes');
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
    await db.execute(sql`UPDATE conversation SET assignee_user_id = ${botId} WHERE id = ${conv}`);
    const llm = new FakeLlm();
    await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(llm.calls[0]!.system).toContain('ORG-WIDE: answer about jobs only.');
  });

  it('[R-011] is left to the person who already owns the chat', async () => {
    await say('outbound', 'Hello Asha', await campaign(true));
    await say('inbound', 'Yes');
    await db.execute(sql`UPDATE conversation SET assignee_user_id = ${adminId} WHERE id = ${conv}`);
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
    expect(await owner()).toBe(adminId);
  });

  it('[R-011] is left to a person who has written in the chat since the campaign message', async () => {
    await say('outbound', 'Hello Asha', await campaign(true));
    await say('inbound', 'Yes');
    await say('outbound', 'Hi Asha, it is Kushal here, let us talk.', null, 'user');
    await say('inbound', 'Great');
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
    expect(await owner()).toBeNull();
  });

  it('[R-011] is not taken when the AI assistant is switched off', async () => {
    await say('outbound', 'Hello Asha', await campaign(true));
    await say('inbound', 'Yes');
    await db.execute(sql`UPDATE ai_setting SET enabled = false WHERE org_id = ${orgId}`);
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
    expect(await owner()).toBeNull();
  });

  it('[R-011] is not taken for a person marked do-not-contact', async () => {
    await say('outbound', 'Hello Asha', await campaign(true));
    await say('inbound', 'Stop');
    await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contactId}`);
    expect(await claimCampaignReply(db, orgId, conv)).toBe(false);
  });
});
