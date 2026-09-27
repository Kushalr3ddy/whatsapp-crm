import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Conversation assignment, status and list filters (F3, chunk 1).
 *
 * These are the controls that turn one shared queue into a team dividing work, so the tests
 * that matter most are the ones that keep a thread from crossing a tenant boundary: a
 * conversation in another org is a 404, and an assignee from another org is refused outright,
 * because `assignee_user_id` points at `app_user`, which has no tenancy of its own.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;

let orgA: string;
let orgB: string;
let userA1: string;
let userA2: string;
let userB1: string;
let convA: string;
let keyA: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);

  const orgs = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','patch-a'), ('b','patch-b') RETURNING id, slug`)
  ) as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'patch-a')!.id;
  orgB = orgs.find((o) => o.slug === 'patch-b')!.id;

  const users = (await db.execute(sql`
    INSERT INTO app_user(email, display_name) VALUES
      ('a1@patch.test','Agent A1'), ('a2@patch.test','Agent A2'), ('b1@patch.test','Agent B1')
    RETURNING id, email`)
  ) as unknown as Array<{ id: string; email: string }>;
  userA1 = users.find((u) => u.email === 'a1@patch.test')!.id;
  userA2 = users.find((u) => u.email === 'a2@patch.test')!.id;
  userB1 = users.find((u) => u.email === 'b1@patch.test')!.id;

  // A1 and A2 belong to org A; B1 to org B. This is the membership that assignment is checked
  // against, not the raw app_user row.
  await db.execute(sql`
    INSERT INTO org_membership(org_id, user_id, role) VALUES
      (${orgA}, ${userA1}, 'agent'), (${orgA}, ${userA2}, 'agent'), (${orgB}, ${userB1}, 'agent')`);

  const sender = (await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status)
    VALUES (${orgA}, 'baileys', 'A number', 'active') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const contact = (await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source)
    VALUES (${orgA}, 'someone', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const conv = (await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id)
    VALUES (${orgA}, ${contact[0]!.id}, ${sender[0]!.id}) RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  convA = conv[0]!.id;

  keyA = (await issueApiKey(db, {
    orgId: orgA, name: 'patch-a', scopes: ['conversations:read', 'conversations:write']
  })).secret;
});

/** Counts audit rows for one action against one target — the trail an assignment must leave. */
async function auditCount(orgId: string, action: string, targetId: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM audit_log
    WHERE org_id = ${orgId} AND action = ${action} AND target_id = ${targetId}`)
  ) as unknown as Array<{ n: number }>;
  return rows[0]!.n;
}

describe('PATCH /conversations/:id — assignment', () => {
  it('assigns a thread to an org member and writes an audit row', async () => {
    const r = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userA1 });
    expect(r.status).toBe(200);
    expect(r.body.data.assigneeUserId).toBe(userA1);
    expect(await auditCount(orgA, 'conversation.assigned', convA)).toBe(1);
  });

  it('unassigns with an explicit null', async () => {
    await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userA1 });
    const r = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: null });
    expect(r.status).toBe(200);
    expect(r.body.data.assigneeUserId).toBeNull();
  });

  it('refuses an assignee from another org with 422, not a leak', async () => {
    const r = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userB1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOT_A_MEMBER');
  });

  it('does not write a second audit row when the assignee is unchanged', async () => {
    await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userA2 });
    await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userA2 });
    // The value did not move on the second call, so it is not a change worth recording.
    expect(await auditCount(orgA, 'conversation.assigned', convA)).toBe(1);
  });
});

describe('PATCH /conversations/:id — status and validation', () => {
  it('resolves and reopens a thread, each writing an audit row', async () => {
    const closed = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ status: 'closed' });
    expect(closed.body.data.status).toBe('closed');
    const reopened = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ status: 'open' });
    expect(reopened.body.data.status).toBe('open');
    expect(await auditCount(orgA, 'conversation.status_changed', convA)).toBe(2);
  });

  it('rejects an empty body', async () => {
    const r = await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({});
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('is a 404 for a conversation in another org', async () => {
    const other = (await db.execute(sql`
      INSERT INTO sender_identity(org_id, provider, label, status)
        VALUES (${orgB}, 'baileys', 'B number', 'active') RETURNING id`)
    ) as unknown as Array<{ id: string }>;
    const c = (await db.execute(sql`
      INSERT INTO contact(org_id, display_name, source) VALUES (${orgB}, 'b person', 'test') RETURNING id`)
    ) as unknown as Array<{ id: string }>;
    const convB = ((await db.execute(sql`
      INSERT INTO conversation(org_id, contact_id, sender_identity_id)
        VALUES (${orgB}, ${c[0]!.id}, ${other[0]!.id}) RETURNING id`)
    ) as unknown as Array<{ id: string }>)[0]!.id;

    const r = await request(app).patch(`/api/v1/conversations/${convB}`)
      .set('Authorization', `Bearer ${keyA}`).send({ status: 'closed' });
    expect(r.status).toBe(404);
  });

  it('rejects a malformed id with 422 before it reaches the database', async () => {
    const r = await request(app).patch('/api/v1/conversations/not-a-uuid')
      .set('Authorization', `Bearer ${keyA}`).send({ status: 'closed' });
    expect(r.status).toBe(422);
  });
});

describe('GET /conversations — filters', () => {
  it('narrows to unassigned, then to a named assignee', async () => {
    const unassigned = await request(app).get('/api/v1/conversations?assignee=unassigned')
      .set('Authorization', `Bearer ${keyA}`);
    expect((unassigned.body.data as Array<{ id: string }>).map((c) => c.id)).toContain(convA);

    await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ assigneeUserId: userA1 });

    const stillUnassigned = await request(app).get('/api/v1/conversations?assignee=unassigned')
      .set('Authorization', `Bearer ${keyA}`);
    expect((stillUnassigned.body.data as Array<{ id: string }>).map((c) => c.id)).not.toContain(convA);

    const byUser = await request(app).get(`/api/v1/conversations?assignee=${userA1}`)
      .set('Authorization', `Bearer ${keyA}`);
    const rowA = (byUser.body.data as Array<{ id: string; assigneeName: string | null }>)
      .find((c) => c.id === convA);
    expect(rowA?.assigneeName).toBe('Agent A1');
  });

  it('narrows by status', async () => {
    await request(app).patch(`/api/v1/conversations/${convA}`)
      .set('Authorization', `Bearer ${keyA}`).send({ status: 'closed' });
    const open = await request(app).get('/api/v1/conversations?status=open')
      .set('Authorization', `Bearer ${keyA}`);
    expect((open.body.data as Array<{ id: string }>).map((c) => c.id)).not.toContain(convA);
    const closed = await request(app).get('/api/v1/conversations?status=closed')
      .set('Authorization', `Bearer ${keyA}`);
    expect((closed.body.data as Array<{ id: string }>).map((c) => c.id)).toContain(convA);
  });

  it('refuses assignee=me for an API key, which has no identity', async () => {
    const r = await request(app).get('/api/v1/conversations?assignee=me')
      .set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(422);
  });
});
