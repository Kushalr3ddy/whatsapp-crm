import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Two people at once, and people who press the wrong thing or push on purpose.
 *
 * Every area has two kinds of test:
 *   - normal use: it still works when the people are careful, and when two of them work at the same time;
 *   - breaking use: a confused person or an attacker sends the wrong thing, the wrong person's thing or the same thing twice,
 *     and the app refuses it or stays correct, and never answers 500.
 *
 * R-041 to R-043 were written `it.fails` while they were open and are plain tests now that they are fixed (2026-11-10). R-044 is fixed in
 * the web form (apps/web/app/contacts/classic/changed-fields.test.ts); the test here pins the API, which is last write wins per field.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let otherOrgId: string;
let adminA: string; let adminB: string; let agent1: string; let agent2: string; let otherUser: string;
let tokenA: string; let tokenB: string; let token1: string; let token2: string;
let readOnlyKey: string; let sendKey: string;
let senderId: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 8 });
  media = tempStorage('crm-races');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'race', slug: 'race-org', email: 'a@race.test', password: 'x', displayName: 'Admin A' });
  orgId = org.orgId; adminA = org.userId;
  adminB = (await addUserToOrg(db, hasher, { orgId, email: 'b@race.test', password: 'x', displayName: 'Admin B', role: 'admin' })).userId;
  agent1 = (await addUserToOrg(db, hasher, { orgId, email: 'one@race.test', password: 'x', displayName: 'Agent One', role: 'agent' })).userId;
  agent2 = (await addUserToOrg(db, hasher, { orgId, email: 'two@race.test', password: 'x', displayName: 'Agent Two', role: 'agent' })).userId;
  tokenA = (await createSession(db, { userId: adminA, orgId })).token;
  tokenB = (await createSession(db, { userId: adminB, orgId })).token;
  token1 = (await createSession(db, { userId: agent1, orgId })).token;
  token2 = (await createSession(db, { userId: agent2, orgId })).token;
  readOnlyKey = (await issueApiKey(db, { orgId, name: 'ro', scopes: ['contacts:read'] })).secret;
  sendKey = (await issueApiKey(db, { orgId, name: 'send', scopes: ['messages:send'] })).secret;

  const other = await createOrgWithAdmin(db, hasher, { orgName: 'other', slug: 'other-org', email: 'o@other.test', password: 'x', displayName: 'Other Admin' });
  otherOrgId = other.orgId; otherUser = other.userId;

  senderId = (await rows<{ id: string }>(sql`INSERT INTO sender_identity (org_id, provider, label, status) VALUES (${orgId}, 'fake', 'n', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`
    INSERT INTO custom_field (org_id, key, label, type, options) VALUES
      (${orgId}, 'city', 'City', 'text', ARRAY[]::text[]),
      (${orgId}, 'stage', 'Stage', 'select', ARRAY['new', 'won']::text[]),
      (${orgId}, 'age', 'Age', 'number', ARRAY[]::text[])`);
});

/** A chat in the first org: nobody owns it unless `owner` is given. */
async function makeChat(owner: string | null = null, org: string = orgId): Promise<{ conv: string; contact: string }> {
  const contact = (await rows<{ id: string }>(sql`INSERT INTO contact (org_id, display_name, source) VALUES (${org}, 'Customer', 'test') RETURNING id`))[0]!.id;
  const sender = org === orgId ? senderId : (await rows<{ id: string }>(sql`INSERT INTO sender_identity (org_id, provider, label, status) VALUES (${org}, 'fake', 'o', 'active') RETURNING id`))[0]!.id;
  const conv = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id, assignee_user_id) VALUES (${org}, ${contact}, ${sender}, ${owner}) RETURNING id`))[0]!.id;
  return { conv, contact };
}
const owner = async (conv: string): Promise<string | null> => (await rows<{ a: string | null }>(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${conv}`))[0]!.a;
const outbound = async (conv: string): Promise<number> => (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conv} AND direction = 'outbound'`))[0]!.n;
const send = (headers: Record<string, string>, body: Record<string, unknown>) => request(app).post('/api/v1/messages').set(headers).send(body);

// ---------------------------------------------------------------------------------------------------------------------------------
describe('team: who is an admin', () => {
  const patch = (headers: Record<string, string>, id: string, body: unknown) => request(app).patch(`/api/v1/admin/users/${id}`).set(headers).send(body as object);
  const activeAdmins = async (): Promise<number> => (await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM org_membership m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = ${orgId} AND m.role = 'admin' AND u.status = 'active'`))[0]!.n;
  const roleOf = async (id: string): Promise<string> => (await rows<{ r: string }>(sql`SELECT role AS r FROM org_membership WHERE user_id = ${id}`))[0]!.r;

  describe('normal use', () => {
    it('an admin can make an agent an admin, and an admin can step another admin down while two remain', async () => {
      expect((await patch(asSession(tokenA), agent1, { role: 'admin' })).status).toBe(200);
      expect(await roleOf(agent1)).toBe('admin');
      expect((await patch(asSession(tokenA), adminB, { role: 'agent' })).status).toBe(200);
      expect(await roleOf(adminB)).toBe('agent');
    });
  });

  describe('breaking use', () => {
    it('the last admin cannot demote or disable themselves, and cannot be demoted by the API', async () => {
      await db.execute(sql`UPDATE org_membership SET role = 'agent' WHERE user_id = ${adminB}`);
      const demote = await patch(asSession(tokenA), adminA, { role: 'agent' });
      expect(demote.status).toBe(409);
      expect(demote.body.code).toBe('TEAM_RULE');
      expect((await patch(asSession(tokenA), adminA, { status: 'disabled' })).status).toBe(409);
      expect(await activeAdmins()).toBe(1);
    });

    it('an agent cannot change anyone, and a visitor with no sign-in cannot either', async () => {
      expect((await patch(asSession(token1), agent2, { role: 'admin' })).status).toBe(403);
      expect((await patch(asSession(token1), adminA, { role: 'agent' })).status).toBe(403);
      expect((await request(app).patch(`/api/v1/admin/users/${agent2}`).send({ role: 'admin' })).status).toBe(401);
      expect(await roleOf(agent2)).toBe('agent');
      expect(await roleOf(adminA)).toBe('admin');
    });

    it('a cookie with no matching CSRF token is refused', async () => {
      const r = await request(app).patch(`/api/v1/admin/users/${agent2}`).set({ Cookie: `crm_session=${tokenA}; crm_csrf=c` }).send({ role: 'admin' });
      expect(r.status).toBe(403);
      expect(await roleOf(agent2)).toBe('agent');
    });

    it('a person from another organisation cannot be reached, and nothing about them changes', async () => {
      expect((await patch(asSession(tokenA), otherUser, { role: 'agent' })).status).toBe(404);
      expect((await patch(asSession(tokenA), randomUUID(), { role: 'agent' })).status).toBe(404);
      expect(await roleOf(otherUser)).toBe('admin');
    });

    it('nonsense in the body or the address is refused with a plain 4xx, never a 500', async () => {
      for (const body of [{}, { role: 'owner' }, { role: 'admin; DROP TABLE org_membership' }, { status: 'deleted' }, { role: ['admin'] }, 'admin', null]) {
        const r = await patch(asSession(tokenA), agent1, body);
        expect(r.status, JSON.stringify(body)).toBe(422);
      }
      for (const id of ['not-a-uuid', "1' OR '1'='1", '../../etc/passwd', '00000000-0000-0000-0000-00000000000']) {
        const r = await patch(asSession(tokenA), encodeURIComponent(id), { role: 'agent' });
        expect(r.status, id).toBeLessThan(500);
        expect(r.status, id).toBeGreaterThanOrEqual(400);
      }
      expect(await roleOf(agent1)).toBe('agent');
      expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_membership`))[0]!.n).toBeGreaterThan(0);
    });
  });

  describe('two admins at the same moment', () => {
    it('both demoting a third person at once leaves everyone consistent and an admin in place', async () => {
      await db.execute(sql`UPDATE org_membership SET role = 'admin' WHERE user_id = ${agent1}`);
      const [x, y] = await Promise.all([patch(asSession(tokenA), agent1, { role: 'agent' }), patch(asSession(tokenB), agent1, { role: 'agent' })]);
      expect([x.status, y.status].every((s) => s === 200)).toBe(true);
      expect(await roleOf(agent1)).toBe('agent');
      expect(await activeAdmins()).toBeGreaterThanOrEqual(2);
    });

    // R-041. Each request locks only the row of the person it changes, so each counts the other as "still an admin" and both commit.
    it('[R-041] two admins demoting each other at once never leave the organisation with no admin', async () => {
      let worst = 2;
      for (let round = 0; round < 25; round += 1) {
        await db.execute(sql`UPDATE org_membership SET role = 'admin' WHERE user_id IN (${adminA}, ${adminB})`);
        await db.execute(sql`UPDATE org_membership SET role = 'agent' WHERE user_id IN (${agent1}, ${agent2})`);
        await Promise.all([patch(asSession(tokenA), adminB, { role: 'agent' }), patch(asSession(tokenB), adminA, { role: 'agent' })]);
        worst = Math.min(worst, await activeAdmins());
      }
      expect(worst).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it('[R-041] two admins disabling each other at once never leave the organisation with no active admin', async () => {
      let worst = 2;
      for (let round = 0; round < 25; round += 1) {
        await db.execute(sql`UPDATE org_membership SET role = 'admin' WHERE user_id IN (${adminA}, ${adminB})`);
        await db.execute(sql`UPDATE app_user SET status = 'active' WHERE id IN (${adminA}, ${adminB})`);
        await Promise.all([patch(asSession(tokenA), adminB, { status: 'disabled' }), patch(asSession(tokenB), adminA, { status: 'disabled' })]);
        worst = Math.min(worst, await activeAdmins());
      }
      expect(worst).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('sending into a chat', () => {
  describe('normal use', () => {
    it('the first person to reply in an unowned chat becomes its owner, and can keep replying', async () => {
      const { conv } = await makeChat();
      expect((await send(asSession(token1), { conversationId: conv, body: 'hello' })).status).toBe(202);
      expect(await owner(conv)).toBe(agent1);
      expect((await send(asSession(token1), { conversationId: conv, body: 'and again' })).status).toBe(202);
      expect(await outbound(conv)).toBe(2);
    });

    it('an admin can reply in another agent’s chat, and an integration key with the send scope can too', async () => {
      const { conv } = await makeChat(agent1);
      expect((await send(asSession(tokenA), { conversationId: conv, body: 'from the admin' })).status).toBe(202);
      expect((await send({ Authorization: `Bearer ${sendKey}` }, { conversationId: conv, body: 'from the system' })).status).toBe(202);
    });

    it('thirty replies sent at the same moment by the owner are all kept, none lost and none refused', async () => {
      const { conv } = await makeChat(agent1);
      const all = await Promise.all(Array.from({ length: 30 }, (_, i) => send(asSession(token1), { conversationId: conv, body: `m${String(i)}` })));
      expect(all.map((r) => r.status)).toEqual(Array(30).fill(202));
      expect(await outbound(conv)).toBe(30);
    }, 60_000);

    it('the same short reply sent twice on purpose ("ok", "ok") is two messages', async () => {
      const { conv } = await makeChat(agent1);
      await send(asSession(token1), { conversationId: conv, body: 'ok' });
      await send(asSession(token1), { conversationId: conv, body: 'ok' });
      expect(await outbound(conv)).toBe(2);
    });
  });

  describe('breaking use', () => {
    it('another agent is refused in an owned chat, and nothing is queued', async () => {
      const { conv } = await makeChat(agent1);
      const r = await send(asSession(token2), { conversationId: conv, body: 'mine now' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('THREAD_ASSIGNED');
      expect(await outbound(conv)).toBe(0);
      expect(await owner(conv)).toBe(agent1);
    });

    it('a chat in another organisation looks like it does not exist, and an invented id does too', async () => {
      const foreign = await makeChat(null, otherOrgId);
      expect((await send(asSession(tokenA), { conversationId: foreign.conv, body: 'x' })).status).toBe(404);
      expect((await send(asSession(tokenA), { conversationId: randomUUID(), body: 'x' })).status).toBe(404);
      expect(await outbound(foreign.conv)).toBe(0);
      expect(await owner(foreign.conv)).toBeNull();
    });

    it('empty, spaces-only, oversized and control-character messages are refused with 422', async () => {
      const { conv } = await makeChat(agent1);
      for (const body of ['', '   ', '\n\n\t', 'a'.repeat(4097), 'bad\u0000text', 123, null, ['x'], { a: 1 }]) {
        const r = await send(asSession(token1), { conversationId: conv, body });
        expect(r.status, JSON.stringify(body)?.slice(0, 30)).toBe(422);
      }
      expect(await outbound(conv)).toBe(0);
    });

    it('a request that names both a phone and a chat, or neither, or a malformed chat id, is refused', async () => {
      const { conv } = await makeChat(agent1);
      expect((await send(asSession(token1), { conversationId: conv, to: '+919000000009', body: 'x' })).status).toBe(422);
      expect((await send(asSession(token1), { body: 'x' })).status).toBe(422);
      expect((await send(asSession(token1), { conversationId: 'not-a-uuid', body: 'x' })).status).toBe(422);
      expect((await send(asSession(token1), { conversationId: conv, body: 'x', senderId: 'nope' })).status).toBe(422);
      expect(await outbound(conv)).toBe(0);
    });

    it('a visitor with no sign-in, a key without the send scope and a cookie without CSRF are all refused', async () => {
      const { conv } = await makeChat(agent1);
      expect((await request(app).post('/api/v1/messages').send({ conversationId: conv, body: 'x' })).status).toBe(401);
      expect((await send({ Authorization: `Bearer ${readOnlyKey}` }, { conversationId: conv, body: 'x' })).status).toBe(403);
      expect((await send({ Authorization: 'Bearer not-a-real-key' }, { conversationId: conv, body: 'x' })).status).toBe(401);
      expect((await send({ Cookie: `crm_session=${token1}; crm_csrf=c` }, { conversationId: conv, body: 'x' })).status).toBe(403);
      expect(await outbound(conv)).toBe(0);
    });

    it('a message that looks like an attack is just text: stored, queued and nothing else happens', async () => {
      const { conv } = await makeChat(agent1);
      for (const body of ["'; DROP TABLE message; --", '<script>alert(1)</script>', '{{7*7}} ${7*7} %s %n', '../../etc/passwd', 'a'.repeat(4096)]) {
        expect((await send(asSession(token1), { conversationId: conv, body })).status).toBe(202);
      }
      expect(await outbound(conv)).toBe(5);
      expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM org`))[0]!.n).toBe(2);
    });
  });

  describe('two people at the same moment', () => {
    // R-042. Both read "nobody owns it" before either claims it. The loser's claim updates no row and the code carries on and sends.
    // `acknowledgeCollision` is set so that only the ownership rule is being tested, not the "someone is typing" warning.
    it('[R-042] two agents sending the first message in an unowned chat at once: one is accepted and the other is told it is taken', async () => {
      let bothThrough = 0;
      for (let round = 0; round < 25; round += 1) {
        const { conv } = await makeChat();
        const [x, y] = await Promise.all([
          send(asSession(token1), { conversationId: conv, body: 'from one', acknowledgeCollision: true }),
          send(asSession(token2), { conversationId: conv, body: 'from two', acknowledgeCollision: true })
        ]);
        if (x.status === 202 && y.status === 202) bothThrough += 1;
        expect([x.status, y.status].filter((s) => s === 202).length, `round ${String(round)}`).toBeGreaterThanOrEqual(1);
      }
      expect(bothThrough).toBe(0);
    }, 90_000);

    it('the chat always ends with exactly one owner, whichever agent won', async () => {
      const { conv } = await makeChat();
      await Promise.all([
        send(asSession(token1), { conversationId: conv, body: 'a', acknowledgeCollision: true }),
        send(asSession(token2), { conversationId: conv, body: 'b', acknowledgeCollision: true })
      ]);
      expect([agent1, agent2]).toContain(await owner(conv));
    });
  });

  describe('the same click twice', () => {
    // R-043. Nothing identifies "this is the same send again" (a retry after a dropped connection, a second tab, an integration
    // that retries). The screen disables the button while a send is running, so a human double-click is covered; the API is not.
    // The header name below is the proposal in the write-up, pending approval.
    it('[R-043] the same send repeated with the same Idempotency-Key creates one message', async () => {
      const { conv } = await makeChat(agent1);
      const key = randomUUID();
      const [x, y] = await Promise.all([
        send({ ...asSession(token1), 'Idempotency-Key': key }, { conversationId: conv, body: 'pay by Friday' }),
        send({ ...asSession(token1), 'Idempotency-Key': key }, { conversationId: conv, body: 'pay by Friday' })
      ]);
      expect([x.status, y.status].every((s) => s === 202)).toBe(true);
      expect(await outbound(conv)).toBe(1);
    });

    it('two different keys are two messages, so the fix cannot swallow a real second message', async () => {
      const { conv } = await makeChat(agent1);
      await send({ ...asSession(token1), 'Idempotency-Key': randomUUID() }, { conversationId: conv, body: 'ok' });
      await send({ ...asSession(token1), 'Idempotency-Key': randomUUID() }, { conversationId: conv, body: 'ok' });
      expect(await outbound(conv)).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('editing a person’s custom fields', () => {
  const put = (headers: Record<string, string>, id: string, values: unknown) => request(app).put(`/api/v1/contacts/${id}/custom-fields`).set(headers).send({ values } as object);
  const fields = async (id: string): Promise<Record<string, unknown>> => (await rows<{ f: Record<string, unknown> }>(sql`SELECT custom_fields AS f FROM contact WHERE id = ${id}`))[0]!.f;
  let contact: string;
  beforeEach(async () => { contact = (await makeChat()).contact; });

  describe('normal use', () => {
    it('sets, changes and clears fields, and an empty box clears the field', async () => {
      expect((await put(asSession(token1), contact, { city: 'Pune', stage: 'new', age: 31 })).status).toBe(204);
      expect(await fields(contact)).toEqual({ city: 'Pune', stage: 'new', age: 31 });
      expect((await put(asSession(token1), contact, { city: 'Mumbai', stage: null, age: '' })).status).toBe(204);
      expect(await fields(contact)).toEqual({ city: 'Mumbai' });
    });

    it('two people saving different fields at the same moment keep both changes, every time', async () => {
      for (let round = 0; round < 15; round += 1) {
        await db.execute(sql`UPDATE contact SET custom_fields = '{}'::jsonb WHERE id = ${contact}`);
        const [x, y] = await Promise.all([put(asSession(token1), contact, { city: `City${String(round)}` }), put(asSession(token2), contact, { stage: 'won' })]);
        expect([x.status, y.status]).toEqual([204, 204]);
        expect(await fields(contact), `round ${String(round)}`).toEqual({ city: `City${String(round)}`, stage: 'won' });
      }
    }, 60_000);

    it('two people saving the same field at the same moment: one value wins whole, nothing is mixed or broken', async () => {
      const [x, y] = await Promise.all([put(asSession(token1), contact, { city: 'Pune' }), put(asSession(token2), contact, { city: 'Delhi' })]);
      expect([x.status, y.status]).toEqual([204, 204]);
      expect(['Pune', 'Delhi']).toContain((await fields(contact)).city);
    });
  });

  describe('breaking use', () => {
    it('a field that is not defined, a wrong type and a wrong choice are refused and change nothing', async () => {
      await put(asSession(token1), contact, { city: 'Pune' });
      for (const values of [{ nope: 'x' }, { age: 'abc' }, { stage: 'lost' }, { city: 'ok', nope: 'x' }]) {
        const r = await put(asSession(token1), contact, values);
        expect(r.status, JSON.stringify(values)).toBe(422);
      }
      expect(await fields(contact)).toEqual({ city: 'Pune' });
    });

    it('names that attack JavaScript or the database are just undefined fields', async () => {
      // JSON.parse makes real own properties named __proto__ and constructor; an object literal would not.
      const hostile = [
        JSON.parse('{"__proto__":"x"}'), JSON.parse('{"constructor":"x"}'), { ['a'.repeat(300)]: 'x' },
        { "city'; DROP TABLE contact;--": 'x' }, { 'city\u0000': 'x' }
      ] as unknown[];
      for (const values of hostile) {
        const r = await put(asSession(token1), contact, values);
        expect(r.status, JSON.stringify(values).slice(0, 40)).toBeLessThan(500);
      }
      const bad = await request(app).put(`/api/v1/contacts/${contact}/custom-fields`).set(asSession(token1)).set('Content-Type', 'application/json')
        .send('{"values":{"__proto__":{"polluted":true},"city":"x"}}');
      expect(bad.status).toBeLessThan(500);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(await fields(contact)).not.toHaveProperty('polluted');
      expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact`))[0]!.n).toBeGreaterThan(0);
    });

    it('a body that is not { values: {…} } is refused, and a huge value never answers 500', async () => {
      for (const body of [null, 'x', [], { values: 'x' }, { values: [] }, { values: null }, {}]) {
        const r = await request(app).put(`/api/v1/contacts/${contact}/custom-fields`).set(asSession(token1)).send(body as object);
        expect(r.status, JSON.stringify(body)).toBe(422);
      }
      const big = await put(asSession(token1), contact, { city: 'x'.repeat(200_000) });
      expect(big.status).toBeLessThan(500);
    });

    it('a person in another organisation looks like nobody, and an invented id does too', async () => {
      const foreign = (await makeChat(null, otherOrgId)).contact;
      expect((await put(asSession(token1), foreign, { city: 'Pune' })).status).toBe(404);
      expect((await put(asSession(token1), randomUUID(), { city: 'Pune' })).status).toBe(404);
      expect(await fields(foreign)).toEqual({});
    });

    it('no sign-in, a read-only key and a cookie with no CSRF token are refused', async () => {
      expect((await request(app).put(`/api/v1/contacts/${contact}/custom-fields`).send({ values: { city: 'x' } })).status).toBe(401);
      expect((await put({ Authorization: `Bearer ${readOnlyKey}` }, contact, { city: 'x' })).status).toBe(403);
      expect((await put({ Cookie: `crm_session=${token1}; crm_csrf=c` }, contact, { city: 'x' })).status).toBe(403);
      expect(await fields(contact)).toEqual({});
    });
  });

  describe('a page that was opened a while ago', () => {
    // R-044, characterisation. The Contacts form (apps/web/app/contacts/classic) sends EVERY field in the form, changed or not. A person
    // whose page is out of date therefore puts the old value of a field they never touched back over a newer one. Nothing warns anyone.
    // This passes today because it pins what happens today. The fix is a decision (send only what changed, or refuse a stale save).
    it('[R-044] KNOWN: a save that re-sends a field it did not change puts the old value back over someone’s newer one', async () => {
      await put(asSession(token1), contact, { city: 'Pune', stage: 'new' });
      // Both people open the form now and see city Pune, stage new.
      await put(asSession(token2), contact, { stage: 'won' });                                    // Agent Two saves: stage won
      await put(asSession(token1), contact, { city: 'Mumbai', stage: 'new' });                    // Agent One's stale form re-sends stage new
      expect(await fields(contact)).toEqual({ city: 'Mumbai', stage: 'new' });                    // Agent Two's "won" is gone
    });

    it('a save that sends only what the person changed does not disturb anyone else’s fields', async () => {
      await put(asSession(token1), contact, { city: 'Pune', stage: 'new' });
      await put(asSession(token2), contact, { stage: 'won' });
      await put(asSession(token1), contact, { city: 'Mumbai' });
      expect(await fields(contact)).toEqual({ city: 'Mumbai', stage: 'won' });
    });
  });
});
