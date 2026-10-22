import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The AI settings tab's API: choose a provider, list its models, test, and make it the model the install uses. Runs against a small stub
 * of a provider on this machine and a temporary settings file, so it never touches a real key or the real `.env`.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let media: TempStorage;
let app: ReturnType<typeof buildApp>;
let strictApp: ReturnType<typeof buildApp>;
let stub: Server;
let stubUrl: string;
let envFile: string;
let admin: Record<string, string>;
let agent: Record<string, string>;
let orgId: string;
/** What the stub provider does next. */
const stubState = { key: 'good-key', toolCalls: true, requests: [] as string[] };

beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      stubState.requests.push(`${req.method ?? ''} ${req.url ?? ''}`);
      if (req.headers.authorization !== `Bearer ${stubState.key}`) { res.writeHead(401).end(JSON.stringify({ error: 'bad key' })); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a', name: 'Model A', context_length: 32000 }] })); return; }
      const wantsTool = body.includes('"tools"');
      res.end(JSON.stringify({
        model: 'model-a', usage: { prompt_tokens: 3, completion_tokens: 2 },
        choices: [{ message: { content: wantsTool ? null : 'OK', tool_calls: wantsTool && stubState.toolCalls ? [{ function: { name: 'ping', arguments: '{"note":"ok"}' } }] : [] } }]
      }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${String((stub.address() as AddressInfo).port)}/v1`;

  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  envFile = join(mkdtempSync(join(tmpdir(), 'llm-settings-')), 'llm.env');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  const config = (allowPrivate: boolean): Config => ({
    PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN',
    LLM_DRIVER: 'none', LLM_TIMEOUT_MS: 20000, LLM_ENV_FILE: envFile, LLM_ALLOW_PRIVATE_BASE_URL: allowPrivate
  } as unknown as Config);
  app = buildApp({ config: config(true), logger, db, kms, hasher, tenantRole, storage: media.storage });
  strictApp = buildApp({ config: config(false), logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { stub.close(); await db.$client.end(); media.cleanup(); });

/** The headers a browser session sends: the session cookie plus a matching CSRF pair. */
function asSession(token: string): Record<string, string> {
  return { Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'llm', slug: `llm-${randomBytes(3).toString('hex')}`, email: 'admin@llm.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  admin = asSession((await createSession(db, { userId: org.userId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'agent@llm.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agent = asSession((await createSession(db, { userId: a.userId, orgId })).token);
  writeFileSync(envFile, 'ENCRYPTION_KEY=do-not-touch\nOTHER=1\n');
  stubState.key = 'good-key'; stubState.toolCalls = true; stubState.requests = [];
});

const choice = (extra: object = {}) => ({ provider: 'custom', baseUrl: stubUrl, apiKey: 'good-key', model: 'model-a', ...extra });
const get = (h: Record<string, string>) => request(app).get('/api/v1/ai/llm').set(h);

describe('the AI settings tab', () => {
  it('starts with no model, lists the providers, and shows an agent less than an admin', async () => {
    const a = await get(admin);
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ driver: 'none', ready: false, provider: null });
    expect(a.body.data.providers.map((p: { id: string }) => p.id)).toEqual(['groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'ollama', 'custom']);
    expect((await get(agent)).status).toBe(200);
  });

  it('is for admins only: an agent cannot list, test, save or turn off', async () => {
    for (const r of [
      request(app).post('/api/v1/ai/llm/models').set(agent).send(choice()),
      request(app).post('/api/v1/ai/llm/test').set(agent).send(choice()),
      request(app).put('/api/v1/ai/llm').set(agent).send(choice()),
      request(app).delete('/api/v1/ai/llm').set(agent)
    ]) expect((await r).status).toBe(403);
    expect(readFileSync(envFile, 'utf8')).toBe('ENCRYPTION_KEY=do-not-touch\nOTHER=1\n');
  });

  it('lists the provider\'s models, sorted, and says so when the key is refused', async () => {
    const ok = await request(app).post('/api/v1/ai/llm/models').set(admin).send(choice());
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual([{ id: 'model-a', name: 'Model A', contextLength: 32000 }, { id: 'model-b' }]);
    const bad = await request(app).post('/api/v1/ai/llm/models').set(admin).send(choice({ apiKey: 'wrong' }));
    expect(bad.status).toBe(502);
    expect(bad.body.detail).toMatch(/refused the key/);
    expect(JSON.stringify(bad.body)).not.toContain('wrong');
  });

  it('tests a model and reports whether it can call a function', async () => {
    const works = await request(app).post('/api/v1/ai/llm/test').set(admin).send(choice());
    expect(works.body.data).toMatchObject({ usable: true, toolCalling: true });
    stubState.toolCalls = false;
    const noTools = await request(app).post('/api/v1/ai/llm/test').set(admin).send(choice());
    expect(noTools.body.data).toMatchObject({ usable: true, toolCalling: false });
    expect(noTools.body.data.notes[0]).toMatch(/did not call a function/);
    const refused = await request(app).post('/api/v1/ai/llm/test').set(admin).send(choice({ apiKey: 'wrong' }));
    expect(refused.body.data).toMatchObject({ usable: false });
    expect(refused.body.data.problem).toMatch(/refused the key/);
  });

  it('writes the settings after a passing test, keeps every other line, never returns the key, and audits without it', async () => {
    const saved = await request(app).put('/api/v1/ai/llm').set(admin).send(choice());
    expect(saved.status).toBe(200);
    const text = readFileSync(envFile, 'utf8');
    expect(text).toContain('ENCRYPTION_KEY=do-not-touch\nOTHER=1\n');
    expect(text).toContain('LLM_DRIVER=compatible');
    expect(text).toContain('LLM_MODEL=model-a');
    expect(text).toContain('LLM_API_KEY=good-key');
    expect(text).toContain(`LLM_BASE_URL=${stubUrl}`);

    const now = await get(admin);
    expect(now.body.data).toMatchObject({ driver: 'compatible', model: 'model-a', keyLast4: '-key', ready: true, provider: 'custom', source: 'file' });
    // An agent sees which model is in use, but neither the key ending nor the address.
    expect((await get(agent)).body.data).toMatchObject({ model: 'model-a', keyLast4: null, baseUrl: null });
    expect(JSON.stringify(now.body)).not.toContain('good-key');
    expect(JSON.stringify(saved.body)).not.toContain('good-key');

    const audit = await db.execute(sql`SELECT after FROM audit_log WHERE org_id = ${orgId} AND action = 'ai.llm_changed'`) as unknown as Array<{ after: Record<string, unknown> }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ provider: 'custom', model: 'model-a', keyReplaced: true, tested: true });
    expect(JSON.stringify(audit)).not.toContain('good-key');
  });

  it('keeps the saved key when the box is left blank for the same provider, and does not carry it to another provider', async () => {
    await request(app).put('/api/v1/ai/llm').set(admin).send(choice());
    stubState.requests = [];
    const reuse = await request(app).post('/api/v1/ai/llm/models').set(admin).send(choice({ apiKey: '' }));
    expect(reuse.status).toBe(200);
    const other = await request(app).post('/api/v1/ai/llm/models').set(admin).send({ provider: 'groq', model: 'x' });
    expect(other.status).toBe(422);
    expect(other.body.detail).toBe('Enter the API key.');
  });

  it('changes nothing when the test fails, unless the admin chooses to use it anyway', async () => {
    const before = readFileSync(envFile, 'utf8');
    const failed = await request(app).put('/api/v1/ai/llm').set(admin).send(choice({ apiKey: 'wrong' }));
    expect(failed.status).toBe(422);
    expect(failed.body.detail).toMatch(/Nothing was changed/);
    expect(readFileSync(envFile, 'utf8')).toBe(before);
    const anyway = await request(app).put('/api/v1/ai/llm').set(admin).send(choice({ apiKey: 'wrong', anyway: true }));
    expect(anyway.status).toBe(200);
    expect(readFileSync(envFile, 'utf8')).toContain('LLM_API_KEY=wrong');
  });

  it('refuses an address on a private network or plain http when that is not switched on', async () => {
    const r = await request(strictApp).post('/api/v1/ai/llm/models').set(admin).send(choice());
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/https/);
    expect(stubState.requests).toHaveLength(0);                    // nothing was called
    const meta = await request(strictApp).post('/api/v1/ai/llm/test').set(admin).send({ provider: 'custom', baseUrl: 'https://169.254.169.254/v1', apiKey: 'k', model: 'm' });
    expect(meta.status).toBe(422);
    expect(meta.body.detail).toMatch(/private network/);
  });

  it('turns the model off and removes the key, leaving the other lines', async () => {
    await request(app).put('/api/v1/ai/llm').set(admin).send(choice());
    expect((await request(app).delete('/api/v1/ai/llm').set(admin)).status).toBe(204);
    const text = readFileSync(envFile, 'utf8');
    expect(text).toContain('LLM_DRIVER=none');
    expect(text).not.toContain('good-key');
    expect(text).toContain('ENCRYPTION_KEY=do-not-touch');
    expect((await get(admin)).body.data).toMatchObject({ driver: 'none', ready: false });
  });

  it('allows ten settings calls a minute and then asks to wait', async () => {
    let last = 200;
    for (let i = 0; i < 11; i++) last = (await request(app).post('/api/v1/ai/llm/models').set(admin).send(choice())).status;
    expect(last).toBe(429);
  });
});
