import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, tenantDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { LlmError, type LlmDriver, type LlmRequest, type LlmResponse } from '@crm/llm';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey, saveAiSettings, tidyAiJobs } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The AI queue: requests run one at a time per org, oldest first; the list says who is waiting, what is running and what
 * finished; a waiting request can be cancelled but a running one cannot; people see only their own unless they are admins.
 * A fake model that can be held and released stands in for the provider.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

/** A model that can be held: each call waits until the test releases it, and the busiest moment is recorded. */
class GatedLlm implements LlmDriver {
  readonly name = 'fake';
  calls: string[] = [];
  active = 0;
  peak = 0;
  fail = false;
  private waiting: Array<() => void> = [];
  held = false;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req.messages[0]?.content ?? '');
    this.active++; this.peak = Math.max(this.peak, this.active);
    try {
      if (this.held) await new Promise<void>((r) => { this.waiting.push(r); });
      if (this.fail) throw new LlmError('timeout', 'slow');
      return { text: `Wrote: ${req.messages[0]?.content ?? ''}`, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-1' };
    } finally { this.active--; }
  }
  release(): void { this.held = false; const w = this.waiting; this.waiting = []; for (const r of w) r(); }
}

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let llm: GatedLlm;
let orgId: string;
let adminId: string;
let admin: Record<string, string>;
let agent: Record<string, string>;
let agentId: string;
let keyHeader: Record<string, string>;
let otherAdmin: Record<string, string>;

beforeAll(async () => {
  db = createDatabase(url, { max: 8 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  llm = new GatedLlm();
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage, llm });
});
afterAll(async () => { await app.aiRunner.idle(); await db.$client.end(); media.cleanup(); });

/** The headers a browser session sends: the session cookie plus a matching CSRF pair. */
function asSession(token: string): Record<string, string> {
  return { Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
}

beforeEach(async () => {
  await app.aiRunner.idle();
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  llm.calls = []; llm.active = 0; llm.peak = 0; llm.fail = false; llm.held = false;
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-q', email: 'a@q.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  admin = asSession((await createSession(db, { userId: adminId, orgId })).token);
  const a = await addUserToOrg(db, hasher, { orgId, email: 'ag@q.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentId = a.userId;
  agent = asSession((await createSession(db, { userId: agentId, orgId })).token);
  keyHeader = { Authorization: `Bearer ${(await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send'] })).secret}` };
  await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true }, { type: 'user', id: adminId });
  const other = await createOrgWithAdmin(db, hasher, { orgName: 'Other', slug: 'other-q', email: 'o@q.test', password: 'x', displayName: 'Other' });
  otherAdmin = asSession((await createSession(db, { userId: other.userId, orgId: other.orgId })).token);
});

/** Puts a request in the queue. */
const enqueue = (h: Record<string, string>, input: string, kind: 'command' | 'draft' = 'command') => request(app).post('/api/v1/ai/jobs').set(h).send({ kind, input });
/** The queue as the caller sees it. */
const jobs = async (h: Record<string, string> = admin) => (await request(app).get('/api/v1/ai/jobs').set(h)).body.data as Array<{ id: string; status: string; input: string; position: number | null; result: unknown; error: string | null; mine: boolean }>;
/** Waits until the predicate holds, polling the queue. */
async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timed out waiting');
}

describe('the AI queue', () => {
  it('runs a request and keeps the result in the list', async () => {
    const r = await enqueue(admin, 'first thing');
    expect(r.status).toBe(202);
    await app.aiRunner.idle();
    const [job] = await jobs();
    expect(job).toMatchObject({ status: 'done', input: 'first thing', position: null, mine: true });
    expect(job!.result).toMatchObject({ message: 'Wrote: first thing', actions: [] });
  });

  it('runs one at a time, oldest first, and shows who is running and who is waiting', async () => {
    llm.held = true;
    await enqueue(admin, 'one');
    await until(async () => (await jobs()).some((j) => j.status === 'running'));
    await enqueue(admin, 'two');
    await enqueue(agent, 'three', 'draft');
    const list = await jobs();
    expect(list.find((j) => j.input === 'one')).toMatchObject({ status: 'running', position: null });
    expect(list.find((j) => j.input === 'two')).toMatchObject({ status: 'queued', position: 1 });
    expect(list.find((j) => j.input === 'three')).toMatchObject({ status: 'queued', position: 2 });

    llm.held = false; llm.release();
    await app.aiRunner.idle();
    expect(llm.calls).toEqual(['one', 'two', 'three']);
    expect(llm.peak).toBe(1);
    expect((await jobs()).every((j) => j.status === 'done')).toBe(true);
  });

  it('cancels a waiting request so it never runs, but not a running or finished one', async () => {
    llm.held = true;
    const first = (await enqueue(admin, 'one')).body.data.id as string;
    await until(async () => (await jobs()).some((j) => j.status === 'running'));
    const second = (await enqueue(admin, 'two')).body.data.id as string;

    expect((await request(app).post(`/api/v1/ai/jobs/${first}/cancel`).set(admin)).status).toBe(409);
    expect((await request(app).post(`/api/v1/ai/jobs/${second}/cancel`).set(admin)).status).toBe(200);
    llm.held = false; llm.release();
    await app.aiRunner.idle();

    expect(llm.calls).toEqual(['one']);
    const list = await jobs();
    expect(list.find((j) => j.id === second)).toMatchObject({ status: 'cancelled' });
    expect(list.find((j) => j.id === first)).toMatchObject({ status: 'done' });
    expect((await request(app).post(`/api/v1/ai/jobs/${first}/cancel`).set(admin)).status).toBe(409);
    expect((await request(app).post(`/api/v1/ai/jobs/00000000-0000-4000-8000-000000000000/cancel`).set(admin)).status).toBe(404);
  });

  it('says why a request failed, in plain words, and carries on with the next', async () => {
    llm.fail = true;
    await enqueue(admin, 'doomed');
    await app.aiRunner.idle();
    llm.fail = false;
    await enqueue(admin, 'fine');
    await app.aiRunner.idle();
    const list = await jobs();
    expect(list.find((j) => j.input === 'doomed')).toMatchObject({ status: 'failed' });
    expect(list.find((j) => j.input === 'doomed')!.error).toMatch(/took too long/);
    expect(list.find((j) => j.input === 'fine')).toMatchObject({ status: 'done' });
  });

  it('writes campaign wording as a draft request', async () => {
    await enqueue(agent, 'remind people about Friday', 'draft');
    await app.aiRunner.idle();
    const [job] = await jobs(agent);
    expect(job).toMatchObject({ status: 'done' });
    expect(job!.result).toEqual({ body: 'Wrote: remind people about Friday' });
  });

  it('lets people see and cancel only their own, admins everything, and only admins instruct', async () => {
    llm.held = true;
    await enqueue(admin, 'admin one');
    await until(async () => (await jobs()).some((j) => j.status === 'running'));
    const mineId = (await enqueue(agent, 'agent draft', 'draft')).body.data.id as string;
    const adminsId = (await enqueue(admin, 'admin two')).body.data.id as string;

    expect((await jobs(agent)).map((j) => j.input)).toEqual(['agent draft']);
    expect((await jobs(admin)).map((j) => j.input).sort()).toEqual(['admin one', 'admin two', 'agent draft']);
    expect((await jobs(agent))[0]!.position).toBe(1);
    expect((await jobs(admin)).find((j) => j.input === 'admin two')!.position).toBe(2);

    expect((await enqueue(agent, 'sneaky instruction')).status).toBe(403);
    expect((await request(app).post(`/api/v1/ai/jobs/${adminsId}/cancel`).set(agent)).status).toBe(403);
    expect((await request(app).post(`/api/v1/ai/jobs/${mineId}/cancel`).set(agent)).status).toBe(200);
    expect((await enqueue(keyHeader, 'from an api key')).status).toBe(202);
    expect((await request(app).get('/api/v1/ai/jobs')).status).toBe(401);
    llm.held = false; llm.release();
    await app.aiRunner.idle();
  });

  it('keeps one org’s queue out of another’s', async () => {
    await enqueue(admin, 'private to acme');
    await app.aiRunner.idle();
    expect(await jobs(otherAdmin)).toEqual([]);
  });

  it('refuses the 21st waiting request', async () => {
    llm.held = true;
    await enqueue(admin, 'blocker');
    await until(async () => (await jobs()).some((j) => j.status === 'running'));
    for (let i = 0; i < 20; i++) expect((await enqueue(admin, `waiting ${String(i)}`)).status).toBe(202);
    const full = await enqueue(admin, 'one too many');
    expect(full.status).toBe(429);
    expect(full.body.code).toBe('QUEUE_FULL');
    llm.held = false; llm.release();
    await app.aiRunner.idle();
  });

  it('fails a job whose worker vanished and forgets finished ones after a day', async () => {
    const pinned = tenantDatabase(db, orgId, null);
    await db.execute(sql`INSERT INTO ai_job (org_id, kind, input, status, started_at) VALUES (${orgId}, 'command', 'stuck', 'running', now() - interval '10 minutes')`);
    await db.execute(sql`INSERT INTO ai_job (org_id, kind, input, status, created_at, finished_at) VALUES (${orgId}, 'command', 'ancient', 'done', now() - interval '30 hours', now() - interval '30 hours')`);
    await db.execute(sql`INSERT INTO ai_job (org_id, kind, input, status, created_at, finished_at) VALUES (${orgId}, 'command', 'recent', 'done', now() - interval '2 hours', now() - interval '2 hours')`);
    expect(await tidyAiJobs(pinned, orgId)).toBe(false);
    const list = await jobs();
    expect(list.map((j) => j.input).sort()).toEqual(['recent', 'stuck']);
    expect(list.find((j) => j.input === 'stuck')).toMatchObject({ status: 'failed' });
    expect(list.find((j) => j.input === 'stuck')!.error).toMatch(/interrupted/);
  });
});
