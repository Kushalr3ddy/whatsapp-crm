import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import {
  createOrgWithAdmin, addUserToOrg, createSession, issueApiKey
} from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Message authorship (D-53, first slice).
 *
 * An outbound message records the signed-in agent who sent it, and the thread listing returns
 * that agent's display name. An API key is an integration, so its messages have no author.
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
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let agent1: string;
let conv: string;
let adminToken: string;
let agent1Token: string;
let agent2Token: string;
let key: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** Builds the headers a browser session sends: the session cookie plus a matching CSRF pair. */
function asSession(token: string): { Cookie: string; 'x-csrf-token': string } {
  return { Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' };
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);

  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'lock', slug: 'lock-org', email: 'admin@lock.test',
    password: 'x', displayName: 'Admin'
  });
  orgId = org.orgId;
  const adminId = org.userId;
  agent1 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a1@lock.test', password: 'x', displayName: 'Agent One', role: 'agent'
  })).userId;
  const agent2 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a2@lock.test', password: 'x', displayName: 'Agent Two', role: 'agent'
  })).userId;

  adminToken = (await createSession(db, { userId: adminId, orgId })).token;
  agent1Token = (await createSession(db, { userId: agent1, orgId })).token;
  agent2Token = (await createSession(db, { userId: agent2, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send'] })).secret;

  const s = (await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status)
    VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const c = (await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  // Unassigned, so any agent may reply and the author is the only thing under test.
  conv = ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${c[0]!.id}, ${s[0]!.id}) RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Sends a reply as the principal the headers describe and returns the thread's messages. */
async function replyAndList(headers: Record<string, string>) {
  const sent = await request(app).post('/api/v1/messages').set(headers)
    .send({ conversationId: conv, body: 'hello' });
  expect(sent.status).toBe(202);
  const thread = await request(app).get(`/api/v1/conversations/${conv}/messages`).set(asSession(adminToken));
  expect(thread.status).toBe(200);
  return thread.body.data as Array<{ sentBy: string; sentByUserId: string | null; sentByName: string | null }>;
}

describe('who sent a message', () => {
  it('records the signed-in agent and returns their name', async () => {
    const [m] = await replyAndList(asSession(agent1Token));
    expect(m!.sentByUserId).toBe(agent1);
    expect(m!.sentByName).toBe('Agent One');
  });

  it('keeps two agents’ replies apart', async () => {
    await request(app).post('/api/v1/messages').set(asSession(agent1Token))
      .send({ conversationId: conv, body: 'first' });
    const messages = await replyAndList(asSession(agent2Token));
    expect(messages.map((m) => m.sentByName)).toEqual(['Agent One', 'Agent Two']);
  });

  it('leaves an API key’s message without an author', async () => {
    const [m] = await replyAndList({ Authorization: `Bearer ${key}` });
    expect(m!.sentByUserId).toBeNull();
    expect(m!.sentByName).toBeNull();
    expect(m!.sentBy).toBe('api');
  });
});
