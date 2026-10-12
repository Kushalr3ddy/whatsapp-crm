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
 * Presence (D-17): "who has this thread open right now".
 *
 * A heartbeat marks a person as viewing for 30 s; others see them in the conversation, the
 * caller never sees themselves, an API key cannot beat, and a thread in another org is a 404.
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

/** The thread as `who` sees it. */
async function viewersFor(headers: Record<string, string>) {
  const r = await request(app).get(`/api/v1/conversations/${conv}`).set(headers);
  expect(r.status).toBe(200);
  return (r.body.data.viewers as Array<{ userId: string; name: string }>).map((v) => v.name);
}
function beat(headers: Record<string, string>) {
  return request(app).post(`/api/v1/conversations/${conv}/presence`).set(headers);
}

describe('presence', () => {
  it('shows a viewer to others but never to themselves', async () => {
    expect((await beat(asSession(agent2Token))).status).toBe(204);
    expect(await viewersFor(asSession(agent1Token))).toEqual(['Agent Two']);
    expect(await viewersFor(asSession(agent2Token))).toEqual([]);
  });

  it('lists several viewers by name', async () => {
    await beat(asSession(agent2Token));
    await beat(asSession(adminToken));
    expect(await viewersFor(asSession(agent1Token))).toEqual(['Admin', 'Agent Two']);
  });

  it('forgets someone not seen for 30 seconds', async () => {
    await beat(asSession(agent2Token));
    await db.execute(sql`
      UPDATE conversation_presence SET seen_at = now() - interval '31 seconds'
      WHERE conversation_id = ${conv}`);
    expect(await viewersFor(asSession(agent1Token))).toEqual([]);
  });

  it('drops a viewer who leaves, and sweeps stale rows on the next beat', async () => {
    await beat(asSession(agent2Token));
    const left = await request(app).delete(`/api/v1/conversations/${conv}/presence`)
      .set(asSession(agent2Token));
    expect(left.status).toBe(204);
    expect(await viewersFor(asSession(agent1Token))).toEqual([]);

    await beat(asSession(adminToken));
    await db.execute(sql`
      UPDATE conversation_presence SET seen_at = now() - interval '10 minutes'
      WHERE conversation_id = ${conv}`);
    await beat(asSession(agent1Token));
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS n FROM conversation_presence WHERE conversation_id = ${conv}`)
    ) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses an API key and does not leak across orgs', async () => {
    const reader = (await issueApiKey(db, { orgId, name: 'r', scopes: ['conversations:read'] })).secret;
    expect((await beat({ Authorization: `Bearer ${reader}` })).status).toBe(422);

    const other = await createOrgWithAdmin(db, hasher, {
      orgName: 'other', slug: 'other-org', email: 'o@other.test', password: 'x', displayName: 'Outsider'
    });
    const outsider = (await createSession(db, { userId: other.userId, orgId: other.orgId })).token;
    expect((await beat(asSession(outsider))).status).toBe(404);
  });

  it('shows viewers in the inbox list too', async () => {
    await beat(asSession(agent2Token));
    const list = await request(app).get('/api/v1/conversations').set(asSession(agent1Token));
    expect(list.body.data[0].viewers).toEqual([{ userId: agent2, name: 'Agent Two', typing: false }]);
  });
});
