import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { autoReply, claimCampaignReply, createOrgWithAdmin, saveAiSettings, systemText } from '@crm/core';

/**
 * R-047 (2026-11-10, area: ai, found by: live run on four phones): the AI told a customer "a colleague from live@test.local", the team
 * member's login, because the hand-over person is named from their display name and that was their email. An email is never a name.
 *
 * R-048 (same run, area: ai): in an AI campaign with the picture held back until they reply (the default), the AI never answered the new
 * person's first reply. The gateway queues the held picture a moment after the reply, and the AI skips a message when anything newer exists
 * in the chat, so the campaign's own picture counted as "someone already answered". A campaign follow-up is not an answer.
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


beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme Hiring', slug: 'acme-camp', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'ORG-WIDE: answer about jobs only.' }, { type: 'user', id: adminId });
  senderId = ((await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  contactId = ((await db.execute(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'Asha', 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  conv = ((await db.execute(sql`INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  templateId = ((await db.execute(sql`
    INSERT INTO ai_template (org_id, name, description, instructions, created_by)
    VALUES (${orgId}, 'Welding drive', 'd', 'CAMPAIGN TEMPLATE: ask which city they are in.', ${adminId}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});


describe('[R-047] who the customer is told will be in touch', () => {
  it('[R-047] a display name that is an email address is never said to the customer', () => {
    const text = systemText('Acme', 'be kind', { fallback: { name: 'live@test.local', phone: '+91 99641 22631' } });
    expect(text).not.toContain('live@test.local');
    expect(text).toContain('a colleague');
  });

  it('[R-047] a real name still is, with the number', () => {
    const text = systemText('Acme', 'be kind', { fallback: { name: 'Priya Nair', phone: '+91 99641 22631' } });
    expect(text).toContain('Priya Nair (+91 99641 22631)');
  });

  it('[R-047] no name set says a colleague', () => {
    expect(systemText('Acme', 'be kind', { fallback: { name: null, phone: '' } })).toContain('a colleague');
  });
});

describe('[R-048] the AI answering a first reply when a picture was held back for it', () => {
  async function setup(): Promise<{ reply: string }> {
    const camp = await campaign(true);
    await say('outbound', 'Hello Asha, welders needed.', camp);
    const reply = await say('inbound', 'Yes I am interested');
    await claimCampaignReply(db, orgId, conv);
    return { reply };
  }

  it('[R-048] answers even though the campaign queued its held picture after the reply', async () => {
    const { reply } = await setup();
    // What the gateway does a moment after the reply: queue the picture as a message of the same campaign.
    await say('outbound', '', await campaignIdOf(), 'system');
    const llm = new FakeLlm();
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r.outcome).toBe('sent');
    expect(llm.calls).toHaveLength(1);
  });

  it('[R-048] still steps aside when a person wrote in the chat after the reply', async () => {
    const { reply } = await setup();
    await say('outbound', 'Hi Asha, this is Kushal.', null, 'user');
    const llm = new FakeLlm();
    const r = await autoReply({ db, kms, llm }, orgId, conv, reply);
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'superseded' });
    expect(llm.calls).toHaveLength(0);
  });

  it('[R-048] still steps aside when a newer inbound message exists (the AI answers the last one only)', async () => {
    const { reply } = await setup();
    await say('inbound', 'Hello? Anyone?');
    const r = await autoReply({ db, kms, llm: new FakeLlm() }, orgId, conv, reply);
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'superseded' });
  });
});

/** The campaign the chat was set up with. */
async function campaignIdOf(): Promise<string> {
  return ((await db.execute(sql`SELECT id FROM campaign WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`)) as unknown as Array<{ id: string }>)[0]!.id;
}
