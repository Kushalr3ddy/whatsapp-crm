import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { LlmError, type LlmDriver, type LlmRequest, type LlmResponse, type LlmToolCall } from '@crm/llm';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey, saveAiSettings } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The AI assistant running campaigns on instruction: create, start, pause, resume, edit — through the same code a person
 * uses, audited as the assistant's user, never past an anti-ban gate, and starting only when the org allowed it.
 * A fake model answers with whatever tool calls the test sets.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN',
  SEND_RATE_PER_MINUTE: 8, SEND_RATE_PER_DAY: 1500
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

/** A model that answers with the tool calls the test sets, and remembers what it was shown. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  toolCalls: LlmToolCall[] = [];
  text = 'Done.';
  fail = false;
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    if (this.fail) return Promise.reject(new LlmError('timeout', 'slow'));
    return Promise.resolve({ text: this.text, toolCalls: this.toolCalls, usage: { inputTokens: 20, outputTokens: 9 }, model: 'fake-1' });
  }
}

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let llm: FakeLlm;
let orgId: string;
let adminId: string;
let botId: string;
let senderId: string;
let tagId: string;
let segmentId: string;
let admin: Record<string, string>;
let agent: Record<string, string>;
let keyHeader: Record<string, string>;

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

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  llm.calls = []; llm.toolCalls = []; llm.text = 'Done.'; llm.fail = false;
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-cmd', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  admin = asSession((await createSession(db, { userId: adminId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'ag@acme.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agent = asSession((await createSession(db, { userId: a.userId, orgId })).token);
  keyHeader = { Authorization: `Bearer ${(await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send'] })).secret}` };
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true }, { type: 'user', id: adminId })).botUserId!;
  senderId = ((await db.execute(sql`INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at) VALUES (${orgId}, 'fake', 'Main', '+919000000001', 'active', now() - interval '30 days') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  tagId = ((await db.execute(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'pune') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  segmentId = ((await db.execute(sql`INSERT INTO segment (org_id, name, definition) VALUES (${orgId}, 'warm', '{"match":"all","rules":[]}'::jsonb) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  for (let i = 0; i < 3; i++) {
    const c = ((await db.execute(sql`INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${`P${String(i)}`}, 'test') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary) VALUES (${orgId}, ${c}, 'phone', ${`+9198765001${String(i).padStart(2, '0')}`}, true)`);
    await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${c}, ${tagId})`);
  }
});

/** Instructs the assistant as the given caller. */
const command = (h: Record<string, string>, instruction = 'send the pune reminder') => request(app).post('/api/v1/ai/commands').set(h).send({ instruction });
/** Reads a campaign row. */
const campaign = async (id: string) => (await db.execute(sql`SELECT status, name, body, gate_overrides AS "gates" FROM campaign WHERE id = ${id}`) as unknown as Array<{ status: string; name: string; body: string; gates: string[] }>)[0]!;
/** A running campaign made directly, for the pause/resume/edit cases. */
async function makeCampaign(status: string): Promise<string> {
  return ((await db.execute(sql`INSERT INTO campaign (org_id, name, body, sender_identity_id, from_tag_id, status) VALUES (${orgId}, 'Existing', 'Old text', ${senderId}, ${tagId}, ${status}) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
}
const create = (extra: object = {}): LlmToolCall => ({ name: 'create_campaign', arguments: { name: 'Pune reminder', body: 'Hi {{name}}, walk-in on Friday', tagId, senderId, ...extra } });

describe('instructing the assistant', () => {
  it('prepares a draft by default, and never starts without the org’s permission', async () => {
    llm.toolCalls = [create({ start: true })];
    const r = await command(admin);
    expect(r.status).toBe(200);
    expect(r.body.data.message).toBe('Done.');
    const [action] = r.body.data.actions as Array<{ ok: boolean; detail: string; campaignId: string }>;
    expect(action!.ok).toBe(true);
    expect(action!.detail).toMatch(/not started: an admin must press Start/);
    expect(await campaign(action!.campaignId)).toMatchObject({ status: 'draft', body: 'Hi {{name}}, walk-in on Friday', gates: [] });
    // Audited as the assistant, with who asked.
    const audit = await db.execute(sql`SELECT action, actor_id, actor_type, after FROM audit_log WHERE org_id = ${orgId} AND action IN ('campaign.created','ai.command') ORDER BY at`) as unknown as Array<{ action: string; actor_id: string; actor_type: string; after: { requestedBy?: string } }>;
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_id])).toEqual([['campaign.created', 'agent', botId], ['ai.command', 'agent', botId]]);
    expect(audit[1]!.after.requestedBy).toBe(adminId);
    expect(await db.execute(sql`SELECT 1 FROM ai_run WHERE org_id = ${orgId} AND kind = 'campaign_action' AND outcome = 'sent'`)).toHaveLength(1);
  });

  it('starts the campaign when the org allowed it, at the normal safe rate, with no gate lifted', async () => {
    await saveAiSettings(db, orgId, { mayStartCampaigns: true });
    llm.toolCalls = [create({ start: true })];
    const [action] = (await command(admin)).body.data.actions as Array<{ ok: boolean; detail: string; campaignId: string }>;
    expect(action!.detail).toMatch(/Created and started: 3 people/);
    expect(await campaign(action!.campaignId)).toMatchObject({ status: 'running', gates: [] });
  });

  it('pauses a running campaign, refuses to resume without permission, resumes with it', async () => {
    const id = await makeCampaign('running');
    llm.toolCalls = [{ name: 'pause_campaign', arguments: { campaignId: id } }];
    expect((await command(admin)).body.data.actions[0].ok).toBe(true);
    expect((await campaign(id)).status).toBe('paused');

    llm.toolCalls = [{ name: 'resume_campaign', arguments: { campaignId: id } }];
    const refused = (await command(admin)).body.data.actions[0];
    expect(refused).toMatchObject({ ok: false });
    expect(refused.detail).toMatch(/not allowed the assistant to start/);
    expect((await campaign(id)).status).toBe('paused');

    await saveAiSettings(db, orgId, { mayStartCampaigns: true });
    expect((await command(admin)).body.data.actions[0].ok).toBe(true);
    expect((await campaign(id)).status).toBe('running');
  });

  it('edits a paused or draft campaign, but not a running one', async () => {
    const draft = await makeCampaign('draft');
    llm.toolCalls = [{ name: 'edit_campaign', arguments: { campaignId: draft, body: 'New text with parking info' } }];
    expect((await command(admin)).body.data.actions[0].ok).toBe(true);
    expect((await campaign(draft)).body).toBe('New text with parking info');

    const running = await makeCampaign('running');
    llm.toolCalls = [{ name: 'edit_campaign', arguments: { campaignId: running, body: 'Sneaky change' } }];
    const r = (await command(admin)).body.data.actions[0];
    expect(r).toMatchObject({ ok: false });
    expect(r.detail).toMatch(/Pause it first/);
    expect((await campaign(running)).body).toBe('Old text');
  });

  it('only uses what exists: an invented tag, number or campaign is refused and nothing is created', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    llm.toolCalls = [create({ tagId: ghost }), create({ senderId: ghost }), { name: 'pause_campaign', arguments: { campaignId: ghost } }, create({ segmentId })];
    const actions = (await command(admin)).body.data.actions as Array<{ ok: boolean; detail: string }>;
    expect(actions.map((a) => a.ok)).toEqual([false, false, false, false]);
    expect(actions[3]!.detail).toMatch(/exactly one tag or one segment/);
    expect(await db.execute(sql`SELECT 1 FROM campaign WHERE org_id = ${orgId}`)).toHaveLength(0);
  });

  it('does only a few things per instruction, and has no way to cancel or lift a gate', async () => {
    llm.toolCalls = Array.from({ length: 8 }, () => create());
    expect((await command(admin)).body.data.actions).toHaveLength(5);
    llm.toolCalls = [{ name: 'cancel_campaign', arguments: { campaignId: await makeCampaign('running') } }, { name: 'override_gates', arguments: {} }];
    const actions = (await command(admin)).body.data.actions as Array<{ ok: boolean; detail: string }>;
    expect(actions.every((a) => !a.ok && /not something the assistant can do/.test(a.detail))).toBe(true);
  });

  it('shows the model names and ids but no contacts, and keeps the instruction out of the audit log', async () => {
    await command(admin, 'send the SECRET-WORD reminder');
    const system = llm.calls[0]!.system;
    expect(system).toContain('pune');
    expect(system).toContain(senderId);
    expect(system).not.toContain('P0');
    expect(system).not.toContain('+9198765');
    const audit = await db.execute(sql`SELECT after FROM audit_log WHERE action = 'ai.command'`) as unknown as Array<{ after: unknown }>;
    expect(JSON.stringify(audit)).not.toContain('SECRET-WORD');
  });

  it('is for signed-in admins and message-sending API keys only; and needs AI on and a working model', async () => {
    expect((await command(agent)).status).toBe(403);
    expect((await request(app).post('/api/v1/ai/commands').send({ instruction: 'x y z' })).status).toBe(401);
    expect((await command(keyHeader)).status).toBe(200);
    expect((await command(admin, 'no')).status).toBe(422);

    llm.fail = true;
    expect((await command(admin)).status).toBe(502);
    llm.fail = false;
    await saveAiSettings(db, orgId, { enabled: false });
    const off = await command(admin);
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('AI_OFF');
  });
});

describe('campaign editing and the Write-with-AI helper', () => {
  it('PATCH /campaigns/:id edits a draft or paused campaign and refuses a running one', async () => {
    const id = await makeCampaign('paused');
    const ok = await request(app).patch(`/api/v1/campaigns/${id}`).set(admin).send({ name: 'Renamed' });
    expect(ok.status).toBe(200);
    expect((await campaign(id)).name).toBe('Renamed');
    const running = await makeCampaign('running');
    expect((await request(app).patch(`/api/v1/campaigns/${running}`).set(admin).send({ body: 'x' })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/campaigns/${id}`).set(admin).send({})).status).toBe(422);
    expect((await request(app).patch(`/api/v1/campaigns/00000000-0000-4000-8000-000000000000`).set(admin).send({ name: 'x' })).status).toBe(404);
  });

  it('writes campaign wording from a goal without creating or sending anything', async () => {
    llm.text = 'Hi {{name}}, {walk in|drop by} on Friday at 10am!';
    const r = await request(app).post('/api/v1/ai/draft-campaign-text').set(agent).send({ goal: 'remind people about the Friday walk-in' });
    expect(r.status).toBe(200);
    expect(r.body.data.body).toBe('Hi {{name}}, {walk in|drop by} on Friday at 10am!');
    expect(llm.calls[0]!.messages).toEqual([{ role: 'user', content: 'remind people about the Friday walk-in' }]);
    expect(await db.execute(sql`SELECT 1 FROM campaign WHERE org_id = ${orgId}`)).toHaveLength(0);
    await saveAiSettings(db, orgId, { enabled: false });
    expect((await request(app).post('/api/v1/ai/draft-campaign-text').set(agent).send({ goal: 'remind people' })).status).toBe(409);
  });

  it('tells screens whether AI is on', async () => {
    expect((await request(app).get('/api/v1/ai/status').set(agent)).body.data).toEqual({ enabled: true });
    await saveAiSettings(db, orgId, { enabled: false });
    expect((await request(app).get('/api/v1/ai/status').set(agent)).body.data).toEqual({ enabled: false });
  });
});
