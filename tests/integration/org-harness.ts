import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, issueApiKey, API_SCOPES } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Shared set-up for the organisation / role / shared-resource suites (orgs-roles-matrix, orgs-isolation, shared-template-campaign).
 *
 * It builds two organisations on the test database and everyone who can act in them:
 *
 *   Organisation A: two admins, two agents, one disabled agent, and one API key per scope (plus an all-scope key, a revoked key and an expired key).
 *   Organisation B: an admin, an agent and an all-scope key.
 *
 * Each organisation also gets one of everything a person can own (contact, tag, custom field, saved reply, AI template, campaign, number,
 * chat and note), so a test can try to reach A's thing from B and check it is still there afterwards.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';

/** A well-formed id that belongs to nobody. */
export const FAKE = '00000000-0000-4000-8000-000000000000';

/** The password every named person in the cast signs in with. Long enough for the API's 12-character rule. */
export const PASSWORD = 'correct-horse-1234';

/** Everyone who can make a request. A name here is a key of `Harness.headers`. */
export type Who =
  | 'anon' | 'bootstrap' | 'garbage'
  | 'adminA' | 'adminA2' | 'agentA' | 'agentA2' | 'disabledA'
  | 'adminB' | 'agentB'
  | 'keyAll' | 'keyRevoked' | 'keyExpired' | 'keyB'
  | `key:${typeof API_SCOPES[number]}`;

/** One organisation's own things, created through the API as its admin. */
export interface Seed {
  orgId: string;
  senderId: string;
  contactIds: string[];
  tagId: string;
  fieldKey: string;
  cannedId: string;
  templateId: string;
  campaignId: string;
  conversationId: string;
  noteId: string | null;
}

/** Everything a suite needs: the app, the database, the cast and a way to call as any of them. */
export interface Harness {
  app: ReturnType<typeof buildApp>;
  db: Database;
  config: Config;
  hasher: BuiltinPasswordHasher;
  users: Record<'adminA' | 'adminA2' | 'agentA' | 'agentA2' | 'disabledA' | 'adminB' | 'agentB', { id: string; email: string; orgId: string }>;
  tokens: Record<string, string>;
  headers: Record<Who, Record<string, string>>;
  A: Seed;
  B: Seed;
  /** Calls the API as one of the cast. The body is sent as JSON. */
  call: (who: Who, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown) => request.Test;
  /** Runs a query on the test database. */
  rows: <T>(q: ReturnType<typeof sql>) => Promise<T[]>;
  /** Signs a fresh session for someone, so a test can end or age one without disturbing the shared cast. */
  freshSession: (userId: string, orgId: string) => Promise<{ token: string; headers: Record<string, string> }>;
  stop: () => Promise<void>;
}

/** The headers a signed-in person's browser sends: the session cookie and a matching CSRF cookie and header. */
export const sessionHeaders = (token: string): Record<string, string> => ({ Cookie: `crm_session=${token}; crm_csrf=c`, 'x-csrf-token': 'c' });

/** The headers an integration sends: a key as a bearer token. */
export const keyHeaders = (secret: string): Record<string, string> => ({ Authorization: `Bearer ${secret}` });

/** Starts the app on the test database and builds the cast. Call once in `beforeAll`; call `stop()` in `afterAll`. */
export async function startHarness(): Promise<Harness> {
  const db = createDatabase(url, { max: 10 });
  const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
  const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN' } as unknown as Config;
  const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
  const hasher = new BuiltinPasswordHasher();
  const media: TempStorage = tempStorage('crm-org-harness');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  const app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
  const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

  // A clean slate. The suites run one file at a time (vitest.config.ts), so wiping here cannot hit another file.
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);

  const orgA = await createOrgWithAdmin(db, hasher, { orgName: 'Org A', slug: 'org-a', email: 'admin-a@a.test', password: PASSWORD, displayName: 'Admin A' });
  const orgB = await createOrgWithAdmin(db, hasher, { orgName: 'Org B', slug: 'org-b', email: 'admin-b@b.test', password: PASSWORD, displayName: 'Admin B' });
  const add = async (orgId: string, email: string, displayName: string, role: 'admin' | 'agent') =>
    (await addUserToOrg(db, hasher, { orgId, email, password: PASSWORD, displayName, role })).userId;

  const users = {
    adminA: { id: orgA.userId, email: 'admin-a@a.test', orgId: orgA.orgId },
    adminA2: { id: await add(orgA.orgId, 'admin-a2@a.test', 'Admin A2', 'admin'), email: 'admin-a2@a.test', orgId: orgA.orgId },
    agentA: { id: await add(orgA.orgId, 'agent-a@a.test', 'Agent A', 'agent'), email: 'agent-a@a.test', orgId: orgA.orgId },
    agentA2: { id: await add(orgA.orgId, 'agent-a2@a.test', 'Agent A2', 'agent'), email: 'agent-a2@a.test', orgId: orgA.orgId },
    disabledA: { id: await add(orgA.orgId, 'disabled-a@a.test', 'Disabled A', 'agent'), email: 'disabled-a@a.test', orgId: orgA.orgId },
    adminB: { id: orgB.userId, email: 'admin-b@b.test', orgId: orgB.orgId },
    agentB: { id: await add(orgB.orgId, 'agent-b@b.test', 'Agent B', 'agent'), email: 'agent-b@b.test', orgId: orgB.orgId }
  };

  const tokens: Record<string, string> = {};
  for (const [name, u] of Object.entries(users)) tokens[name] = (await createSession(db, { userId: u.id, orgId: u.orgId })).token;
  // The disabled person had a live session when they were disabled: that session must stop working at once.
  await db.execute(sql`UPDATE app_user SET status = 'disabled' WHERE id = ${users.disabledA.id}`);

  const keyFor = async (orgId: string, name: string, scopes: readonly string[], extra: { expiresAt?: Date } = {}) =>
    (await issueApiKey(db, { orgId, name, scopes, rateLimitPerMin: 0, ...extra })).secret;
  const scopeKeys: Record<string, string> = {};
  for (const s of API_SCOPES) scopeKeys[s] = await keyFor(orgA.orgId, `only ${s}`, [s]);
  const revoked = await issueApiKey(db, { orgId: orgA.orgId, name: 'revoked', scopes: [...API_SCOPES], rateLimitPerMin: 0 });
  await db.execute(sql`UPDATE api_key SET revoked_at = now() WHERE id = ${revoked.id}`);

  const headers = {
    anon: {},
    bootstrap: keyHeaders(config.API_KEY),
    garbage: { Cookie: 'crm_session=not-a-real-session; crm_csrf=c', 'x-csrf-token': 'c' },
    adminA: sessionHeaders(tokens.adminA!), adminA2: sessionHeaders(tokens.adminA2!),
    agentA: sessionHeaders(tokens.agentA!), agentA2: sessionHeaders(tokens.agentA2!),
    disabledA: sessionHeaders(tokens.disabledA!),
    adminB: sessionHeaders(tokens.adminB!), agentB: sessionHeaders(tokens.agentB!),
    keyAll: keyHeaders(await keyFor(orgA.orgId, 'all scopes', API_SCOPES)),
    keyRevoked: keyHeaders(revoked.secret),
    keyExpired: keyHeaders(await keyFor(orgA.orgId, 'expired', API_SCOPES, { expiresAt: new Date(Date.now() - 60_000) })),
    keyB: keyHeaders(await keyFor(orgB.orgId, 'B all scopes', API_SCOPES)),
    ...Object.fromEntries(API_SCOPES.map((s) => [`key:${s}`, keyHeaders(scopeKeys[s]!)]))
  } as unknown as Record<Who, Record<string, string>>;

  const call: Harness['call'] = (who, method, path, body) => {
    const r = request(app)[method](`/api/v1${path}`).set(headers[who]);
    return body === undefined ? r : r.send(body as object);
  };

  const harness: Harness = {
    app, db, config, hasher, users, tokens, headers, call, rows,
    A: undefined as unknown as Seed, B: undefined as unknown as Seed,
    freshSession: async (userId, orgId) => { const t = (await createSession(db, { userId, orgId })).token; return { token: t, headers: sessionHeaders(t) }; },
    stop: async () => { await db.$client.end(); media.cleanup(); }
  };

  harness.A = await seedOrg(harness, 'adminA', orgA.orgId, 'a');
  harness.B = await seedOrg(harness, 'adminB', orgB.orgId, 'b');
  return harness;
}

/** Throws with the response body when a set-up call is refused, so a broken fixture is read at once instead of surfacing as a strange failure later. */
function ok(res: request.Response, what: string): request.Response {
  if (res.status < 200 || res.status >= 300) throw new Error(`seed step "${what}" answered ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

/** Gives one organisation one of everything, through the API as its admin (so the data is real, not hand-inserted). */
async function seedOrg(h: Harness, admin: 'adminA' | 'adminB', orgId: string, tag: string): Promise<Seed> {
  const { call, rows } = h;
  const sender = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, status) VALUES (${orgId}, 'fake', ${`number-${tag}`}, 'active') RETURNING id`))[0]!.id;

  const phone = (n: number): string => (tag === 'a' ? `+9198100000${String(n).padStart(2, '0')}` : `+9198200000${String(n).padStart(2, '0')}`);
  const contactIds: string[] = [];
  for (let n = 1; n <= 3; n++) {
    contactIds.push(String(ok(await call(admin, 'post', '/contacts', { displayName: `${tag.toUpperCase()}-person-${String(n)}`, phone: phone(n) }), 'contact').body.data.id));
  }
  const tagId = String(ok(await call(admin, 'post', '/tags', { name: `${tag}-tag` }), 'tag').body.data.id);
  ok(await call(admin, 'post', `/contacts/${contactIds[0]!}/tags`, { tagId }), 'attach tag');
  const fieldKey = `${tag}_field`;
  ok(await call(admin, 'post', '/custom-fields', { key: fieldKey, label: `${tag} field`, type: 'text' }), 'custom field');
  const cannedId = String(ok(await call(admin, 'post', '/canned-replies', { shortcut: `${tag}-hello`, body: `Hello from ${tag.toUpperCase()}` }), 'canned reply').body.data.id);
  const templateId = String(ok(await call(admin, 'post', '/ai/templates', {
    name: `${tag.toUpperCase()}-template`, description: `The ${tag.toUpperCase()} template`, instructions: `Be kind. Org ${tag.toUpperCase()} only.`, audience: 'everyone', firstMessage: 'Hi {{name}}'
  }), 'template').body.data.id);
  const campaignId = String(ok(await call(admin, 'post', '/campaigns', {
    name: `${tag.toUpperCase()}-campaign`, body: `Hello from campaign ${tag.toUpperCase()}`, senderIdentityId: sender, explicitContactIds: contactIds
  }), 'campaign').body.data.id);

  const conversationId = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactIds[1]!}, ${sender}) RETURNING id`))[0]!.id;
  const note = await call(admin, 'post', `/conversations/${conversationId}/notes`, { body: `${tag.toUpperCase()} private note` });
  ok(note, 'note');

  return { orgId, senderId: sender, contactIds, tagId, fieldKey, cannedId, templateId, campaignId, conversationId, noteId: (note.body.data?.id as string | undefined) ?? null };
}
