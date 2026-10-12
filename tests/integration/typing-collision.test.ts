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
 * Typing and the collision warning (D-54).
 *
 * Typing is a short-lived mark on the presence row. The collision warning is a soft 409: when
 * someone else replied in the last 15 s or is typing right now, a second reply is held with
 * `COLLISION` until the sender says "send anyway". API keys are exempt, and your own reply
 * never collides with you.
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
  agent1 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a1@lock.test', password: 'x', displayName: 'Agent One', role: 'agent'
  })).userId;
  agent2 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a2@lock.test', password: 'x', displayName: 'Agent Two', role: 'agent'
  })).userId;

  agent1Token = (await createSession(db, { userId: agent1, orgId })).token;
  agent2Token = (await createSession(db, { userId: agent2, orgId })).token;

  const s = (await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status)
    VALUES (${orgId}, 'baileys', 'n', 'active') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  const c = (await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>;
  // Unassigned, so any agent may reply and the collision rule is the only thing under test.
  conv = ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id)
    VALUES (${orgId}, ${c[0]!.id}, ${s[0]!.id}) RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
});

const as = (t: string) => asSession(t);

/** The people on the thread (excluding the caller) with their typing flag. */
async function whoIsHere(token: string) {
  const r = await request(app).get(`/api/v1/conversations/${conv}/presence`).set(as(token));
  expect(r.status).toBe(200);
  return r.body.data as Array<{ name: string; typing: boolean }>;
}
const typingPing = (token: string) =>
  request(app).post(`/api/v1/conversations/${conv}/typing`).set(as(token));
const send = (token: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/messages').set(as(token))
    .send({ conversationId: conv, body: 'hello', ...extra });

describe('typing indicator', () => {
  it('shows who is typing to the others, never to themselves', async () => {
    expect((await typingPing(agent2Token)).status).toBe(204);
    expect(await whoIsHere(agent1Token)).toEqual([{ userId: agent2, name: 'Agent Two', typing: true }]);
    expect(await whoIsHere(agent2Token)).toEqual([]);
  });

  it('stops counting as typing after 8 seconds but stays a viewer', async () => {
    await typingPing(agent2Token);
    await db.execute(sql`
      UPDATE conversation_presence SET typing_at = now() - interval '9 seconds'
      WHERE conversation_id = ${conv}`);
    expect(await whoIsHere(agent1Token)).toEqual([{ userId: agent2, name: 'Agent Two', typing: false }]);
  });

  it('is not cleared by an ordinary presence heartbeat', async () => {
    await typingPing(agent2Token);
    await request(app).post(`/api/v1/conversations/${conv}/presence`).set(as(agent2Token));
    expect((await whoIsHere(agent1Token))[0]!.typing).toBe(true);
  });

  it('appears on the conversation and the list too', async () => {
    await typingPing(agent2Token);
    const one = await request(app).get(`/api/v1/conversations/${conv}`).set(as(agent1Token));
    expect(one.body.data.viewers[0]).toMatchObject({ name: 'Agent Two', typing: true });
    const list = await request(app).get('/api/v1/conversations').set(as(agent1Token));
    expect(list.body.data[0].viewers[0]).toMatchObject({ name: 'Agent Two', typing: true });
  });

  it('refuses an API key and a stranger org’s thread', async () => {
    const reader = (await issueApiKey(db, { orgId, name: 'r', scopes: ['conversations:read'] })).secret;
    const byKey = await request(app).post(`/api/v1/conversations/${conv}/typing`)
      .set({ Authorization: `Bearer ${reader}` });
    expect(byKey.status).toBe(422);
    const other = await createOrgWithAdmin(db, hasher, {
      orgName: 'other', slug: 'other-org', email: 'o@other.test', password: 'x', displayName: 'Outsider'
    });
    const outsider = (await createSession(db, { userId: other.userId, orgId: other.orgId })).token;
    expect((await typingPing(outsider)).status).toBe(404);
  });
});

describe('collision warning', () => {
  it('holds a reply sent right after someone else’s, naming them', async () => {
    expect((await send(agent2Token)).status).toBe(202);
    const held = await send(agent1Token);
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('COLLISION');
    expect(held.body.detail).toContain('Agent Two just replied');
  });

  it('lets "send anyway" through', async () => {
    await send(agent2Token);
    expect((await send(agent1Token, { acknowledgeCollision: true })).status).toBe(202);
  });

  it('does not collide with your own earlier reply', async () => {
    await send(agent1Token);
    expect((await send(agent1Token)).status).toBe(202);
  });

  it('forgets a reply older than 15 seconds', async () => {
    await send(agent2Token);
    await db.execute(sql`
      UPDATE message SET created_at = now() - interval '16 seconds' WHERE conversation_id = ${conv}`);
    expect((await send(agent1Token)).status).toBe(202);
  });

  it('warns when someone else is typing, and clears once they stop', async () => {
    await typingPing(agent2Token);
    const held = await send(agent1Token);
    expect(held.status).toBe(409);
    expect(held.body.detail).toContain('Agent Two is typing');
    await db.execute(sql`
      UPDATE conversation_presence SET typing_at = now() - interval '9 seconds'
      WHERE conversation_id = ${conv}`);
    expect((await send(agent1Token)).status).toBe(202);
  });

  it('exempts an API key, which is an integration and not a person', async () => {
    await send(agent2Token);
    const key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send'] })).secret;
    const r = await request(app).post('/api/v1/messages').set({ Authorization: `Bearer ${key}` })
      .send({ conversationId: conv, body: 'from an integration' });
    expect(r.status).toBe(202);
  });
});
