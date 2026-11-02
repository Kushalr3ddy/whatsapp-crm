import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { createOrgWithAdmin, saveAiSettings, dispatchCampaign, writeOpenings } from '@crm/core';

/**
 * A campaign with an AI template: the AI writes each person's first message (not the CRM's fixed body), and only those are sent.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const hasher = new BuiltinPasswordHasher();

/** Writes "Hello <name>, which city are you in?" and remembers what it was asked. */
class OpeningLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  empty = false;
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const name = /Person's name: (.*)/.exec(req.messages[0]!.content)?.[1] ?? '?';
    return Promise.resolve({ text: this.empty ? '' : `Hello ${name}, which city are you in?`, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake-1' });
  }
}

let db: Database;
let orgId: string;
let adminId: string;
let senderId: string;
let campaignId: string;
const tenant = <T>(fn: Parameters<Database['transaction']>[0] extends (tx: infer X) => Promise<infer R> ? (tx: X) => Promise<R> : never) => db.transaction(fn as never) as Promise<T>;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const dispatch = (): Promise<number> => dispatchCampaign(tenant as never, kms, { orgId, campaignId, senderIdentityId: senderId, body: 'FIXED CRM BODY', limit: 10 });
const sentTexts = async (): Promise<string[]> =>
  (await rows<{ body_enc: Uint8Array }>(sql`SELECT body_enc FROM message WHERE org_id = ${orgId} AND campaign_id = ${campaignId} ORDER BY created_at`))
    .map((r) => new TextDecoder().decode(kms.decrypt(r.body_enc)));

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme Hiring', slug: 'acme-open', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'ORG-WIDE' }, { type: 'user', id: adminId });
  senderId = (await rows<{ id: string }>(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`))[0]!.id;
  const templateId = (await rows<{ id: string }>(sql`
    INSERT INTO ai_template (org_id, name, description, instructions, created_by) VALUES (${orgId}, 'Welding', 'd', 'Ask which city they are in.', ${adminId}) RETURNING id`))[0]!.id;
  campaignId = (await rows<{ id: string }>(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, status, ai_template_id)
    VALUES (${orgId}, 'Outreach', 'FIXED CRM BODY', ${senderId}, 'running', ${templateId}) RETURNING id`))[0]!.id;
  for (const name of ['Asha', 'Ravi']) {
    const id = (await rows<{ id: string }>(sql`INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, ${name}, 'test') RETURNING id`))[0]!.id;
    await db.execute(sql`INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status) VALUES (${orgId}, ${campaignId}, ${id}, 'pending')`);
  }
});

describe('the AI writes the first message of an AI-template campaign', () => {
  it('sends nothing until the AI has written an opening for the person', async () => {
    expect(await dispatch()).toBe(0);
    expect(await sentTexts()).toEqual([]);
  });

  it('writes one opening per person from the template and sends that, not the fixed body', async () => {
    const llm = new OpeningLlm();
    expect(await writeOpenings({ db, kms, llm }, { orgId, campaignId })).toBe(2);
    expect(llm.calls[0]!.system).toContain('Ask which city they are in.');
    expect(llm.calls[0]!.system).toContain('FIRST message');
    expect(await dispatch()).toBe(2);
    const texts = await sentTexts();
    expect(texts.sort()).toEqual(['Hello Asha, which city are you in?', 'Hello Ravi, which city are you in?']);
    expect(texts.join()).not.toContain('FIXED CRM BODY');
  });

  it('does not write twice for the same person', async () => {
    const llm = new OpeningLlm();
    await writeOpenings({ db, kms, llm }, { orgId, campaignId });
    expect(await writeOpenings({ db, kms, llm }, { orgId, campaignId })).toBe(0);
    expect(llm.calls).toHaveLength(2);
  });

  it('skips and reports a person after three failed tries, and keeps the others waiting', async () => {
    const llm = new OpeningLlm();
    llm.empty = true;
    for (let i = 0; i < 3; i++) await writeOpenings({ db, kms, llm }, { orgId, campaignId });
    const left = await rows<{ status: string; skip_reason: string | null }>(sql`SELECT status, skip_reason FROM campaign_recipient WHERE campaign_id = ${campaignId}`);
    expect(left.every((r) => r.status === 'skipped' && r.skip_reason === 'ai_opening_failed')).toBe(true);
    expect(await dispatch()).toBe(0);
  });

  it('writes nothing while the AI is switched off', async () => {
    await db.execute(sql`UPDATE ai_setting SET enabled = false WHERE org_id = ${orgId}`);
    const llm = new OpeningLlm();
    expect(await writeOpenings({ db, kms, llm }, { orgId, campaignId })).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(await dispatch()).toBe(0);
  });

  it('a campaign without an AI template still sends its own body', async () => {
    await db.execute(sql`UPDATE campaign SET ai_template_id = NULL WHERE id = ${campaignId}`);
    expect(await dispatch()).toBe(2);
    expect(await sentTexts()).toEqual(['FIXED CRM BODY', 'FIXED CRM BODY']);
  });
});
