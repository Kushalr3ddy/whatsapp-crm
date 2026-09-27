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
 * The thread lock (F3, admin-override variant).
 *
 * A conversation assigned to one agent is theirs to answer: another agent's reply is refused
 * with 409, the assignee's goes through, an admin overrides, and an API key — an integration,
 * not a person claiming a thread — is exempt. This is the simple stand-in for the presence and
 * collision work parked in D-17.
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
  // Assigned to agent1 from the start — the thread agent1 is holding.
  conv = ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id)
    VALUES (${orgId}, ${c[0]!.id}, ${s[0]!.id}, ${agent1}) RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Posts a reply into the assigned thread as whatever principal the headers describe. */
function reply(headers: Record<string, string>) {
  return request(app).post('/api/v1/messages').set(headers).send({ conversationId: conv, body: 'hi' });
}

describe('a thread assigned to one agent', () => {
  it('refuses another agent’s reply with 409', async () => {
    const r = await reply(asSession(agent2Token));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('THREAD_ASSIGNED');
  });

  it('accepts the assignee’s own reply', async () => {
    const r = await reply(asSession(agent1Token));
    expect(r.status).toBe(202);
  });

  it('lets an admin override and reply', async () => {
    const r = await reply(asSession(adminToken));
    expect(r.status).toBe(202);
  });

  it('does not bind an API key, which is an integration not an agent', async () => {
    const r = await reply({ Authorization: `Bearer ${key}` });
    expect(r.status).toBe(202);
  });
});

describe('an unassigned thread', () => {
  it('lets any agent reply', async () => {
    await db.execute(sql`UPDATE conversation SET assignee_user_id = NULL WHERE id = ${conv}`);
    const r = await reply(asSession(agent2Token));
    expect(r.status).toBe(202);
  });
});
