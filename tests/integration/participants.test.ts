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
 * Owner + participants (D-53).
 *
 * The owner is `conversation.assignee_user_id`; participants are extra people who may reply and
 * see the chat under "mine". Only an admin adds or removes them, and reassigning the owner
 * drops the old owner off the chat.
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
let agent2: string;
let conv: string;
let adminToken: string;
let agent1Token: string;
let agent2Token: string;
let key: string;
let agent3Token: string;

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
  agent2 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a2@lock.test', password: 'x', displayName: 'Agent Two', role: 'agent'
  })).userId;

  adminToken = (await createSession(db, { userId: adminId, orgId })).token;
  agent1Token = (await createSession(db, { userId: agent1, orgId })).token;
  agent2Token = (await createSession(db, { userId: agent2, orgId })).token;
  const agent3 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a3@lock.test', password: 'x', displayName: 'Agent Three', role: 'agent'
  })).userId;
  agent3Token = (await createSession(db, { userId: agent3, orgId })).token;
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

/** Calls the participant routes as the principal the headers describe. */
function addParticipant(headers: Record<string, string>, userId: string) {
  return request(app).post(`/api/v1/conversations/${conv}/participants`).set(headers).send({ userId });
}
function reply(headers: Record<string, string>) {
  return request(app).post('/api/v1/messages').set(headers).send({ conversationId: conv, body: 'hi' });
}

describe('participants', () => {
  it('lets a participant reply to a thread owned by someone else', async () => {
    expect((await reply(asSession(agent2Token))).status).toBe(409);
    expect((await addParticipant(asSession(adminToken), agent2)).status).toBe(201);
    expect((await reply(asSession(agent2Token))).status).toBe(202);
  });

  it('is admin-only to add or remove', async () => {
    expect((await addParticipant(asSession(agent1Token), agent2)).status).toBe(403);
    expect((await addParticipant({ Authorization: `Bearer ${key}` }, agent2)).status).toBe(403);
    await addParticipant(asSession(adminToken), agent2);
    const del = await request(app).delete(`/api/v1/conversations/${conv}/participants/${agent2}`)
      .set(asSession(agent1Token));
    expect(del.status).toBe(403);
  });

  it('stops a removed participant replying', async () => {
    await addParticipant(asSession(adminToken), agent2);
    const del = await request(app).delete(`/api/v1/conversations/${conv}/participants/${agent2}`)
      .set(asSession(adminToken));
    expect(del.status).toBe(204);
    expect((await reply(asSession(agent2Token))).status).toBe(409);
  });

  it('is idempotent and audits only real changes', async () => {
    await addParticipant(asSession(adminToken), agent2);
    await addParticipant(asSession(adminToken), agent2);
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS n FROM audit_log WHERE action = 'conversation.participant_added'
        AND org_id = ${orgId}`)) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses the owner as a participant and a stranger from another org', async () => {
    const owner = await addParticipant(asSession(adminToken), agent1);
    expect(owner.status).toBe(422);
    expect(owner.body.code).toBe('ALREADY_OWNER');

    const other = await createOrgWithAdmin(db, hasher, {
      orgName: 'other', slug: 'other-org', email: 'o@other.test', password: 'x', displayName: 'Outsider'
    });
    const stranger = await addParticipant(asSession(adminToken), other.userId);
    expect(stranger.status).toBe(422);
    expect(stranger.body.code).toBe('NOT_A_MEMBER');
  });

  it('shows participants in the list and counts the chat under "mine"', async () => {
    await addParticipant(asSession(adminToken), agent2);
    const mine = await request(app).get('/api/v1/conversations?assignee=me').set(asSession(agent2Token));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].participants).toEqual([{ userId: agent2, name: 'Agent Two' }]);
    const notMine = await request(app).get('/api/v1/conversations?assignee=me').set(asSession(agent3Token));
    expect(notMine.body.data).toHaveLength(0);
  });

  it('drops the old owner off when the thread is reassigned, and the new owner is no participant', async () => {
    await addParticipant(asSession(adminToken), agent2);
    const patch = await request(app).patch(`/api/v1/conversations/${conv}`).set(asSession(adminToken))
      .send({ assigneeUserId: agent2 });
    expect(patch.status).toBe(200);
    // agent1 is no longer the owner and was never a participant: locked out.
    expect((await reply(asSession(agent1Token))).status).toBe(409);
    const left = (await db.execute(sql`
      SELECT count(*)::int AS n FROM conversation_participant WHERE conversation_id = ${conv}`)
    ) as unknown as Array<{ n: number }>;
    expect(left[0]!.n).toBe(0);
  });
});
