import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession } from '@crm/core';
import { LlmError, type LlmDriver, type LlmRequest, type LlmResponse } from '@crm/llm';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/** AI templates: describe in plain words, the AI writes instructions, save, pick again; admin only, and limited per minute. */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

/** A model that answers with whatever text the test sets, and remembers what it was asked. */
class FakeLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  text = JSON.stringify({ name: 'Zephyr X launch', instructions: 'Who you are\n- A showroom assistant\nAbout\n- Zephyr X, 7 seats', audience: 'people who want a car', firstMessage: 'Hi {{name}}', missing: [] });
  fail = false;
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    if (this.fail) return Promise.reject(new LlmError('timeout', 'slow'));
    return Promise.resolve({ text: this.text, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake-1' });
  }
}

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let llm: FakeLlm;
let orgId: string;
let admin: Record<string, string>;
let agent: Record<string, string>;

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
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'tpl', slug: `tpl-${randomBytes(3).toString('hex')}`, email: 'admin@tpl.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  admin = asSession((await createSession(db, { userId: org.userId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'agent@tpl.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agent = asSession((await createSession(db, { userId: a.userId, orgId })).token);
  llm.calls = []; llm.fail = false;
});

/** Switches the assistant on (it needs the data-sharing note accepted first). */
async function switchOn(): Promise<void> {
  await request(app).put('/api/v1/ai/settings').set(admin).send({ enabled: true, acceptConsent: true });
}
const generate = (h: Record<string, string>, description: string) => request(app).post('/api/v1/ai/templates/generate').set(h).send({ description });

describe('writing a template from a description', () => {
  it('is refused while the assistant is off', async () => {
    const r = await generate(admin, 'I own a showroom');
    expect(r.status).toBe(409);
    expect(llm.calls).toHaveLength(0);
  });

  it('writes instructions, and sends the model only the description with the do-not-summarise rule', async () => {
    await switchOn();
    const r = await generate(admin, 'I own a car showroom. Zephyr X has 7 seats and costs Rs 14 lakh.');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Zephyr X launch', audience: 'people who want a car' });
    expect(r.body.data.instructions).toContain('Zephyr X, 7 seats');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.system).toContain('DO NOT SUMMARISE');
    expect(llm.calls[0]!.messages[0]!.content).toContain('Rs 14 lakh');
  });

  it('refuses a description over the limit before it reaches the model', async () => {
    await switchOn();
    const r = await generate(admin, 'x'.repeat(8001));
    expect(r.status).toBe(422);
    expect(llm.calls).toHaveLength(0);
  });

  it('says so when the model gives nothing usable or is slow', async () => {
    await switchOn();
    llm.text = 'I cannot do that';
    expect((await generate(admin, 'a showroom')).status).toBe(502);
    llm.fail = true;
    expect((await generate(admin, 'a showroom')).status).toBe(502);
  });

  it('is for admins only', async () => {
    await switchOn();
    expect((await generate(agent, 'a showroom')).status).toBe(403);
  });

  it('allows a few a minute and then asks to wait', async () => {
    await switchOn();
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await generate(admin, 'a showroom')).status;
    expect(last).toBe(429);
  });
});

describe('saving and picking a template again', () => {
  const body = { name: 'Zephyr X launch', description: 'I own a showroom', instructions: 'Who you are\n- A showroom assistant', audience: 'car wanters', firstMessage: 'Hi {{name}}' };

  it('saves the description and the instructions together, and lists it', async () => {
    const saved = await request(app).post('/api/v1/ai/templates').set(admin).send(body);
    expect(saved.status).toBe(200);
    const list = await request(app).get('/api/v1/ai/templates').set(admin);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'Zephyr X launch', description: 'I own a showroom', useCount: 0 });
  });

  it('replaces the same template when saved again with its id', async () => {
    const id = (await request(app).post('/api/v1/ai/templates').set(admin).send(body)).body.data.id;
    await request(app).post('/api/v1/ai/templates').set(admin).send({ ...body, id, name: 'Renamed' });
    const list = (await request(app).get('/api/v1/ai/templates').set(admin)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Renamed');
  });

  it('refuses empty instructions', async () => {
    expect((await request(app).post('/api/v1/ai/templates').set(admin).send({ ...body, instructions: '  ' })).status).toBe(422);
  });

  it('counts a use, and can make the instructions what every chat follows by default', async () => {
    await switchOn();
    const id = (await request(app).post('/api/v1/ai/templates').set(admin).send(body)).body.data.id;
    const used = await request(app).post(`/api/v1/ai/templates/${id}/use`).set(admin).send({ setAsDefault: true });
    expect(used.status).toBe(200);
    expect(used.body.data.useCount).toBe(1);
    const settings = await request(app).get('/api/v1/ai/settings').set(admin);
    expect(settings.body.data.instructions).toBe('Who you are\n- A showroom assistant');
  });

  it('deletes, and answers 404 for one that is gone', async () => {
    const id = (await request(app).post('/api/v1/ai/templates').set(admin).send(body)).body.data.id;
    expect((await request(app).delete(`/api/v1/ai/templates/${id}`).set(admin)).status).toBe(204);
    expect((await request(app).delete(`/api/v1/ai/templates/${id}`).set(admin)).status).toBe(404);
  });

  it('keeps one organisation\'s templates from another', async () => {
    await request(app).post('/api/v1/ai/templates').set(admin).send(body);
    const other = await createOrgWithAdmin(db, hasher, { orgName: 'other', slug: `o-${randomBytes(3).toString('hex')}`, email: 'o@tpl.test', password: 'x', displayName: 'O' });
    const otherAdmin = asSession((await createSession(db, { userId: other.userId, orgId: other.orgId })).token);
    expect((await request(app).get('/api/v1/ai/templates').set(otherAdmin)).body.data).toEqual([]);
  });

  it('shows the fixed always-on rules to an admin', async () => {
    const r = await request(app).get('/api/v1/ai/always-on-rules').set(admin);
    expect(r.status).toBe(200);
    expect(r.body.data.join(' ')).toContain('untrusted');
  });
});

describe('a campaign made from a template', () => {
  /** A sender and a tag to aim a campaign at. */
  async function sendAndTag(): Promise<{ senderId: string; tagId: string }> {
    const senderId = (await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
      VALUES (${orgId}, 'fake', 'tpl', '+919000000777', 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const tagId = (await db.execute(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'car-wanters') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    return { senderId, tagId };
  }
  const save = async () => (await request(app).post('/api/v1/ai/templates').set(admin).send({
    name: 'T', description: 'd', instructions: '- a', audience: '', firstMessage: 'Hi'
  })).body.data.id as string;

  it('keeps the link to the template, and leaves it empty when the template is deleted', async () => {
    const { senderId, tagId } = await sendAndTag();
    const templateId = await save();
    const made = await request(app).post('/api/v1/campaigns').set(admin).send({
      name: 'Launch', body: 'Hi {{name}}', senderIdentityId: senderId, fromTagId: tagId, aiTemplateId: templateId
    });
    expect(made.status).toBe(201);
    const linked = (await db.execute(sql`SELECT ai_template_id AS id FROM campaign WHERE id = ${made.body.data.id}`) as unknown as Array<{ id: string | null }>)[0]!.id;
    expect(linked).toBe(templateId);
    await request(app).delete(`/api/v1/ai/templates/${templateId}`).set(admin);
    const after = (await db.execute(sql`SELECT ai_template_id AS id FROM campaign WHERE id = ${made.body.data.id}`) as unknown as Array<{ id: string | null }>)[0]!.id;
    expect(after).toBeNull();
  });

  it('refuses a template that is not this organisation\'s', async () => {
    const { senderId, tagId } = await sendAndTag();
    const made = await request(app).post('/api/v1/campaigns').set(admin).send({
      name: 'Launch', body: 'Hi', senderIdentityId: senderId, fromTagId: tagId, aiTemplateId: '00000000-0000-4000-8000-000000000000'
    });
    expect(made.status).toBe(404);
  });
});
