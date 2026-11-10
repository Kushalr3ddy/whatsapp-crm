import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { API_SCOPES } from '@crm/core';
import { FAKE, PASSWORD, startHarness, type Harness, type Who } from './org-harness.js';

/**
 * Who may do what: the role and credential matrix, and the life of a person's access.
 *
 * Roles in this product: `admin` and `agent` (a person, signed in with a session), plus three machine or outside callers:
 * an API key (limited to the scopes it was minted with), the deployment's bootstrap key (can only create an organisation and mint its first key),
 * and nobody (no credential). A person who is disabled, a key that is revoked or expired and a garbage cookie are all "nobody".
 *
 * Part 1 walks every route in the API once per kind of caller and checks the answer. Part 2 checks how access changes while a person is signed in
 * (role changed, disabled, password reset, membership removed). Part 3 sends the wrong thing: wrong content, wrong ids, wrong cookies, big bodies.
 *
 * "Allowed" below means the caller got past the permission check: any answer except 401, 403 or 500 (a 404 for a made-up id, a 422 for an empty body
 * or a 409 for "the AI is off" all mean the door was open). A 500 anywhere is always a failure.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 120_000);
afterAll(async () => { await h.stop(); });

type Access =
  | { kind: 'admin' }                       // a signed-in admin only
  | { kind: 'scope'; scope: typeof API_SCOPES[number] }   // any signed-in person, or a key holding this scope
  | { kind: 'adminOrScope'; scope: typeof API_SCOPES[number] } // an admin, or a key holding this scope; an agent is refused
  | { kind: 'signedIn' };                   // any signed-in person or key

interface Endpoint {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  body?: unknown;
  access: Access;
  /** Do not let the admin actually run it (it would change the organisation's state); only the refusals are checked. */
  denyOnly?: true;
}

const scope = (s: typeof API_SCOPES[number]): Access => ({ kind: 'scope', scope: s });
const admin: Access = { kind: 'admin' };
const adminOrScope = (s: typeof API_SCOPES[number]): Access => ({ kind: 'adminOrScope', scope: s });

/** Every route, once. Ids are made-up so nothing real is changed: a made-up id answers 404 to a caller who is let in. */
const ENDPOINTS: Endpoint[] = [
  // people, keys, organisation
  { method: 'get', path: '/auth/me', access: { kind: 'signedIn' } },
  { method: 'get', path: '/admin/users', access: admin },
  { method: 'post', path: '/admin/users', body: {}, access: admin },
  { method: 'patch', path: `/admin/users/${FAKE}`, body: { role: 'agent' }, access: admin },
  { method: 'post', path: `/admin/users/${FAKE}/password`, body: { password: 'long-enough-password' }, access: admin },
  { method: 'get', path: '/admin/keys', access: admin },
  { method: 'delete', path: `/admin/keys/${FAKE}`, access: admin },
  // AI assistant, templates
  { method: 'get', path: '/ai/status', access: scope('conversations:read') },
  { method: 'get', path: '/ai/settings', access: admin },
  { method: 'put', path: '/ai/settings', body: {}, access: admin },
  { method: 'get', path: '/ai/usage', access: admin },
  { method: 'get', path: '/ai/always-on-rules', access: admin },
  { method: 'get', path: '/ai/templates', access: admin },
  { method: 'get', path: '/ai/templates/deleted', access: admin },
  { method: 'get', path: `/ai/templates/${FAKE}`, access: admin },
  { method: 'post', path: '/ai/templates', body: {}, access: admin },
  { method: 'post', path: `/ai/templates/${FAKE}/use`, body: {}, access: admin },
  { method: 'delete', path: `/ai/templates/${FAKE}`, access: admin },
  { method: 'post', path: `/ai/templates/${FAKE}/duplicate`, access: admin },
  { method: 'post', path: `/ai/templates/${FAKE}/restore`, access: admin },
  { method: 'delete', path: `/ai/templates/${FAKE}/permanent`, access: admin },
  { method: 'post', path: '/ai/templates/generate', body: {}, access: admin },
  { method: 'post', path: '/ai/templates/rewrite', body: {}, access: admin },
  { method: 'post', path: `/ai/conversations/${FAKE}/allow-reply`, body: {}, access: admin },
  { method: 'get', path: `/ai/conversations/${FAKE}/notice`, access: scope('conversations:read') },
  { method: 'post', path: `/ai/conversations/${FAKE}/answer-now`, body: {}, access: scope('conversations:write') },
  { method: 'get', path: '/ai/jobs', access: scope('messages:send') },
  { method: 'post', path: '/ai/jobs', body: {}, access: scope('messages:send') },
  { method: 'post', path: `/ai/jobs/${FAKE}/cancel`, access: scope('messages:send') },
  { method: 'get', path: '/ai/llm', access: scope('conversations:read') },
  // sending rules, security
  { method: 'get', path: '/antiban/settings', access: admin },
  { method: 'put', path: '/antiban/settings', body: {}, access: admin },
  { method: 'get', path: '/encryption', access: admin },
  { method: 'post', path: '/encryption/pause', access: admin, denyOnly: true },
  { method: 'post', path: '/encryption/resume', access: admin, denyOnly: true },
  { method: 'post', path: '/encryption/verify', access: admin, denyOnly: true },
  { method: 'post', path: '/encryption/new-key', access: admin, denyOnly: true },
  // contacts, tags, fields, lists, imports
  { method: 'get', path: '/contacts', access: scope('contacts:read') },
  { method: 'get', path: '/contacts/count', access: scope('contacts:read') },
  { method: 'get', path: '/contacts/sources', access: scope('contacts:read') },
  { method: 'get', path: '/contacts/export', access: admin },
  { method: 'get', path: `/contacts/${FAKE}/detail`, access: scope('contacts:read') },
  { method: 'post', path: '/contacts', body: {}, access: scope('contacts:write') },
  { method: 'post', path: `/contacts/${FAKE}/tags`, body: { tagId: FAKE }, access: scope('contacts:write') },
  { method: 'put', path: `/contacts/${FAKE}/custom-fields`, body: { values: {} }, access: scope('contacts:write') },
  { method: 'put', path: `/contacts/${FAKE}/do-not-contact`, body: { value: true }, access: scope('contacts:write') },
  { method: 'get', path: '/tags', access: scope('contacts:read') },
  { method: 'post', path: '/tags', body: {}, access: scope('contacts:write') },
  { method: 'delete', path: `/tags/${FAKE}`, access: scope('contacts:write') },
  { method: 'post', path: `/tags/${FAKE}/bulk`, body: {}, access: scope('contacts:write') },
  { method: 'get', path: '/custom-fields', access: scope('contacts:read') },
  { method: 'post', path: '/custom-fields', body: {}, access: admin },
  { method: 'delete', path: '/custom-fields/nothing_here', access: admin },
  { method: 'get', path: '/segments', access: scope('contacts:read') },
  { method: 'post', path: '/segments/preview', body: {}, access: scope('contacts:read') },
  { method: 'post', path: '/segments', body: {}, access: scope('contacts:write') },
  { method: 'delete', path: `/segments/${FAKE}`, access: scope('contacts:write') },
  { method: 'get', path: '/imports', access: scope('contacts:read') },
  { method: 'get', path: `/imports/${FAKE}`, access: scope('contacts:read') },
  { method: 'get', path: `/imports/${FAKE}/rows`, access: scope('contacts:read') },
  { method: 'post', path: `/imports/${FAKE}/run`, body: {}, access: scope('contacts:write') },
  // inbox, chats
  { method: 'get', path: '/conversations', access: scope('conversations:read') },
  { method: 'get', path: '/users', access: scope('conversations:read') },
  { method: 'get', path: '/inbox', access: scope('conversations:read') },
  { method: 'get', path: '/inbox/filters', access: scope('conversations:read') },
  { method: 'get', path: `/conversations/${FAKE}`, access: scope('conversations:read') },
  { method: 'get', path: `/conversations/${FAKE}/messages`, access: scope('conversations:read') },
  { method: 'get', path: `/conversations/${FAKE}/sender-status`, access: scope('conversations:read') },
  { method: 'get', path: `/conversations/${FAKE}/person`, access: scope('conversations:read') },
  { method: 'get', path: `/conversations/${FAKE}/notes`, access: scope('conversations:read') },
  { method: 'post', path: `/conversations/${FAKE}/read`, body: {}, access: scope('conversations:read') },
  { method: 'patch', path: `/conversations/${FAKE}`, body: {}, access: scope('conversations:write') },
  { method: 'post', path: `/conversations/${FAKE}/notes`, body: { body: 'x' }, access: scope('conversations:write') },
  { method: 'post', path: `/conversations/${FAKE}/opt-out`, body: {}, access: scope('conversations:write') },
  { method: 'post', path: `/conversations/${FAKE}/participants`, body: { userId: FAKE }, access: admin },
  { method: 'delete', path: `/conversations/${FAKE}/participants/${FAKE}`, access: admin },
  { method: 'get', path: '/canned-replies', access: scope('conversations:read') },
  { method: 'post', path: '/canned-replies', body: {}, access: scope('conversations:write') },
  { method: 'post', path: '/messages', body: {}, access: scope('messages:send') },
  { method: 'get', path: `/media/${FAKE}`, access: scope('conversations:read') },
  // campaigns
  { method: 'get', path: '/campaigns', access: scope('conversations:read') },
  { method: 'get', path: '/campaigns/media', access: scope('conversations:read') },
  { method: 'get', path: '/campaigns/fill-ins', access: scope('conversations:read') },
  { method: 'get', path: '/campaigns/audience-history', access: scope('conversations:read') },
  { method: 'post', path: '/campaigns/review', body: {}, access: scope('conversations:read') },
  { method: 'get', path: `/campaigns/${FAKE}`, access: scope('conversations:read') },
  { method: 'get', path: `/campaigns/${FAKE}/eta`, access: scope('conversations:read') },
  { method: 'get', path: `/campaigns/${FAKE}/preview`, access: scope('conversations:read') },
  { method: 'get', path: `/campaigns/${FAKE}/recipients`, access: scope('conversations:read') },
  { method: 'post', path: '/campaigns', body: {}, access: scope('messages:send') },
  { method: 'post', path: `/campaigns/${FAKE}/start`, body: {}, access: scope('messages:send') },
  { method: 'post', path: `/campaigns/${FAKE}/pause`, access: scope('messages:send') },
  { method: 'post', path: `/campaigns/${FAKE}/cancel`, access: scope('messages:send') },
  { method: 'patch', path: `/campaigns/${FAKE}`, body: {}, access: scope('messages:send') },
  { method: 'post', path: `/campaigns/${FAKE}/stop-ai`, body: {}, access: scope('messages:send') },
  // numbers
  { method: 'get', path: '/senders', access: scope('senders:read') },
  { method: 'get', path: `/senders/${FAKE}/health-events`, access: scope('senders:read') },
  { method: 'post', path: `/senders/${FAKE}/resume`, access: scope('senders:write') },
  { method: 'post', path: '/senders', body: {}, access: adminOrScope('senders:write') },
  { method: 'post', path: `/senders/${FAKE}/link`, body: {}, access: adminOrScope('senders:write') },
  { method: 'post', path: `/senders/${FAKE}/unlink`, body: {}, access: adminOrScope('senders:write') },
  { method: 'get', path: `/senders/${FAKE}/link`, access: adminOrScope('senders:read') },
  { method: 'post', path: `/senders/${FAKE}/remove`, body: {}, access: admin }
];

const allowed = (status: number): boolean => status !== 401 && status !== 403 && status !== 500;

/** A key that holds one scope, and a key that holds a different one, for the same route. */
const rightKey = (s: typeof API_SCOPES[number]): Who => `key:${s}`;
const wrongKey = (s: typeof API_SCOPES[number]): Who => `key:${API_SCOPES.find((x) => x !== s)!}`;

describe('part 1: every route, every kind of caller', () => {
  it.each(ENDPOINTS.map((e) => [`${e.method.toUpperCase()} ${e.path}  (${e.access.kind}${'scope' in e.access ? `: ${e.access.scope}` : ''})`, e] as const))('%s', async (_label, e) => {
    const problems: string[] = [];
    const expectStatus = async (who: Who, want: (s: number) => boolean, wantText: string): Promise<void> => {
      const r = await h.call(who, e.method, e.path, e.body);
      if (!want(r.status)) problems.push(`${who}: wanted ${wantText}, got ${String(r.status)} ${JSON.stringify(r.body).slice(0, 160)}`);
    };
    const refused = (s: number): boolean => s === 403;
    const nobody = (s: number): boolean => s === 401;

    // Nobody gets in, whatever the route.
    for (const who of ['anon', 'garbage', 'disabledA', 'keyRevoked', 'keyExpired'] as const) await expectStatus(who, nobody, '401');

    // The deployment key can only provision an organisation; it never reaches data or admin routes. (/auth/me answers any caller who authenticated, and says only what kind of caller they are.)
    if (e.access.kind !== 'signedIn') await expectStatus('bootstrap', refused, '403');

    if (e.access.kind === 'admin') {
      if (e.denyOnly !== true) await expectStatus('adminA', allowed, 'allowed');
      await expectStatus('agentA', refused, '403 (admin only)');
      await expectStatus('keyAll', refused, '403 (a key is not a person)');
      await expectStatus('adminB', e.denyOnly === true ? () => true : allowed, 'allowed in their own organisation');
    } else if (e.access.kind === 'signedIn') {
      await expectStatus('adminA', allowed, 'allowed');
      await expectStatus('agentA', allowed, 'allowed');
    } else if (e.access.kind === 'scope') {
      await expectStatus('adminA', allowed, 'allowed');
      await expectStatus('agentA', allowed, 'allowed (an agent has every non-admin permission)');
      await expectStatus('keyAll', allowed, 'allowed');
      await expectStatus(rightKey(e.access.scope), allowed, `allowed for a key with ${e.access.scope}`);
      await expectStatus(wrongKey(e.access.scope), refused, `403 for a key without ${e.access.scope}`);
    } else {
      await expectStatus('adminA', allowed, 'allowed');
      await expectStatus('agentA', refused, '403 (numbers are for admins or a key)');
      await expectStatus('keyAll', allowed, 'allowed');
      await expectStatus(rightKey(e.access.scope), allowed, `allowed for a key with ${e.access.scope}`);
      await expectStatus(wrongKey(e.access.scope), refused, `403 for a key without ${e.access.scope}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('the deployment key can create an organisation, and the same call from an admin or an agent is refused', async () => {
    const body = { orgName: 'Matrix Org', slug: `matrix-${String(Date.now())}`, email: `m${String(Date.now())}@m.test`, password: PASSWORD, displayName: 'Matrix Admin' };
    expect((await h.call('adminA', 'post', '/admin/orgs', body)).status).toBe(403);
    expect((await h.call('agentA', 'post', '/admin/orgs', body)).status).toBe(403);
    expect((await h.call('keyAll', 'post', '/admin/orgs', body)).status).toBe(403);
    expect((await h.call('anon', 'post', '/admin/orgs', body)).status).toBe(401);
    expect((await h.call('bootstrap', 'post', '/admin/orgs', body)).status).toBe(201);
  });

  it('the deployment key can mint a first key for an organisation it names, and nothing else in that organisation', async () => {
    const r = await h.call('bootstrap', 'post', '/admin/keys', { name: 'first key', scopes: ['contacts:read'], orgId: h.A.orgId });
    expect(r.status).toBe(201);
    // The new key works in the organisation it was minted for, within its scope.
    const mine = await request(h.app).get('/api/v1/contacts').set({ Authorization: `Bearer ${r.body.data.secret as string}` });
    expect(mine.status).toBe(200);
    expect((mine.body.data as Array<{ displayName: string }>).every((c) => c.displayName.startsWith('A-'))).toBe(true);
    // The deployment key without an organisation named is refused for a clear reason.
    const noOrg = await h.call('bootstrap', 'post', '/admin/keys', { name: 'no org', scopes: ['contacts:read'] });
    expect(noOrg.status).toBeGreaterThanOrEqual(400);
    expect(noOrg.status).toBeLessThan(500);
  });

  it('a key with several scopes gets exactly those, and a key never gets what it was not minted with', async () => {
    const minted = await h.call('adminA', 'post', '/admin/keys', { name: 'two scopes', scopes: ['contacts:read', 'conversations:read'] });
    expect(minted.status).toBe(201);
    const auth = { Authorization: `Bearer ${minted.body.data.secret as string}` };
    const get = async (p: string) => (await request(h.app).get(`/api/v1${p}`).set(auth)).status;
    expect(await get('/contacts')).toBe(200);
    expect(await get('/conversations')).toBe(200);
    expect(await get('/senders')).toBe(403);
    expect((await request(h.app).post('/api/v1/contacts').set(auth).send({ displayName: 'x', phone: '+919810099999' })).status).toBe(403);
    expect((await request(h.app).post('/api/v1/messages').set(auth).send({})).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('part 2: access changes while a person is signed in', () => {
  const add = async (role: 'admin' | 'agent', tag: string) => {
    const email = `${tag}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@life.test`;
    const made = await h.call('adminA', 'post', '/admin/users', { email, password: PASSWORD, displayName: `Life ${tag}`, role });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body.data as { id?: string; userId?: string }).id ?? (made.body.data as { userId: string }).userId;
    const session = await h.freshSession(id, h.A.orgId);
    return { id, email, ...session };
  };
  const as = (headers: Record<string, string>, method: 'get' | 'post' | 'patch' | 'delete' | 'put', path: string, body?: unknown) => {
    const r = request(h.app)[method](`/api/v1${path}`).set(headers);
    return body === undefined ? r : r.send(body as object);
  };

  it('a new person created by an admin signs in with the password they were given, and is an agent or admin as chosen', async () => {
    const p = await add('agent', 'new');
    const login = await request(h.app).post('/api/v1/auth/login').send({ email: p.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('crm_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    const token = /^crm_session=([^;]+)/.exec(session)![1]!;
    const me = await as({ Cookie: `crm_session=${token}` }, 'get', '/auth/me');
    expect(me.body.data).toMatchObject({ role: 'agent', orgId: h.A.orgId });
  });

  it('demoting an admin to agent takes their admin rights away on their very next request', async () => {
    const p = await add('admin', 'demote');
    expect((await as(p.headers, 'get', '/admin/users')).status).toBe(200);
    expect((await h.call('adminA', 'patch', `/admin/users/${p.id}`, { role: 'agent' })).status).toBe(200);
    expect((await as(p.headers, 'get', '/admin/users')).status).toBe(403);
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(200);
  });

  it('promoting an agent to admin gives them admin rights on their very next request', async () => {
    const p = await add('agent', 'promote');
    expect((await as(p.headers, 'get', '/admin/users')).status).toBe(403);
    expect((await h.call('adminA', 'patch', `/admin/users/${p.id}`, { role: 'admin' })).status).toBe(200);
    expect((await as(p.headers, 'get', '/admin/users')).status).toBe(200);
  });

  it('disabling a person ends their access at once, on a session they already had, and they cannot sign in again', async () => {
    const p = await add('agent', 'disable');
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(200);
    expect((await h.call('adminA', 'patch', `/admin/users/${p.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(401);
    const login = await request(h.app).post('/api/v1/auth/login').send({ email: p.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('a disabled person who is enabled again can sign in again', async () => {
    const p = await add('agent', 'reenable');
    await h.call('adminA', 'patch', `/admin/users/${p.id}`, { status: 'disabled' });
    await h.call('adminA', 'patch', `/admin/users/${p.id}`, { status: 'active' });
    const login = await request(h.app).post('/api/v1/auth/login').send({ email: p.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('a password reset by an admin ends every session of that person, and only the new password works', async () => {
    const p = await add('agent', 'reset');
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(200);
    const reset = await h.call('adminA', 'post', `/admin/users/${p.id}/password`, { password: 'a-brand-new-password-9' });
    expect(reset.status).toBe(200);
    expect(reset.body.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(401);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: p.email, password: PASSWORD })).status).toBe(401);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: p.email, password: 'a-brand-new-password-9' })).status).toBe(200);
  });

  it('an agent cannot reset anyone\'s password, including their own, and cannot make themselves an admin', async () => {
    const p = await add('agent', 'selfhelp');
    expect((await as(p.headers, 'post', `/admin/users/${p.id}/password`, { password: 'sneaky-new-password-1' })).status).toBe(403);
    expect((await as(p.headers, 'patch', `/admin/users/${p.id}`, { role: 'admin' })).status).toBe(403);
    expect((await as(p.headers, 'post', '/admin/users', { email: 'x@life.test', password: PASSWORD, displayName: 'x', role: 'admin' })).status).toBe(403);
    expect((await as(p.headers, 'get', '/auth/me')).body.data.role).toBe('agent');
  });

  it('an agent can flag a person do-not-contact but only an admin can lift it', async () => {
    const id = h.A.contactIds[2]!;
    expect((await h.call('agentA', 'put', `/contacts/${id}/do-not-contact`, { value: true })).status).toBeLessThan(300);
    const lift = await h.call('agentA', 'put', `/contacts/${id}/do-not-contact`, { value: false });
    expect(lift.status).toBe(403);
    expect((await h.call('keyAll', 'put', `/contacts/${id}/do-not-contact`, { value: false })).status).toBeLessThan(500);
    expect((await h.call('adminA', 'put', `/contacts/${id}/do-not-contact`, { value: false })).status).toBeLessThan(300);
  });

  it('signing out ends that session and only that one', async () => {
    const p = await add('agent', 'logout');
    const second = await h.freshSession(p.id, h.A.orgId);
    expect((await as(p.headers, 'post', '/auth/logout')).status).toBeLessThan(300);
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(401);
    expect((await as(second.headers, 'get', '/contacts')).status).toBe(200);
  });

  it('a person whose membership was removed loses access at once', async () => {
    const p = await add('agent', 'removed');
    await h.db.execute(sql`DELETE FROM org_membership WHERE user_id = ${p.id}`);
    expect((await as(p.headers, 'get', '/contacts')).status).toBe(401);
  });

  it('a session past its expiry, or idle for more than 12 hours, is refused', async () => {
    const expired = await add('agent', 'expired');
    await h.db.execute(sql`UPDATE session SET expires_at = now() - interval '1 minute' WHERE user_id = ${expired.id}`);
    expect((await as(expired.headers, 'get', '/contacts')).status).toBe(401);
    const idle = await add('agent', 'idle');
    await h.db.execute(sql`UPDATE session SET last_seen_at = now() - interval '13 hours' WHERE user_id = ${idle.id}`);
    expect((await as(idle.headers, 'get', '/contacts')).status).toBe(401);
  });

  it('a wrong password, a disabled account and an unknown email are told apart by nobody (same answer, same wording)', async () => {
    const wrong = await request(h.app).post('/api/v1/auth/login').send({ email: h.users.agentA.email, password: 'definitely-not-it-0000' });
    const disabled = await request(h.app).post('/api/v1/auth/login').send({ email: h.users.disabledA.email, password: PASSWORD });
    const unknown = await request(h.app).post('/api/v1/auth/login').send({ email: 'nobody@nowhere.test', password: PASSWORD });
    for (const r of [wrong, disabled, unknown]) expect(r.status).toBe(401);
    expect(disabled.body.detail).toBe(wrong.body.detail);
    expect(unknown.body.detail).toBe(wrong.body.detail);
    expect(disabled.body.code).toBe(wrong.body.code);
  });

  it('repeated wrong passwords lock that email for a while, and a different email is not locked with it', async () => {
    const victim = await add('agent', 'lock');
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await request(h.app).post('/api/v1/auth/login').send({ email: victim.email, password: `wrong-guess-${String(i)}-xxxx` })).status;
    expect(last).toBe(429);
    // Even the right password is refused during the lock (that is the point of it).
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: victim.email, password: PASSWORD })).status).toBe(429);
    const other = await request(h.app).post('/api/v1/auth/login').send({ email: h.users.agentA2.email, password: PASSWORD });
    expect(other.status).toBe(200);
  });

  it('creating a person: a second account with the same email is refused, a short password is refused, a role that does not exist is refused', async () => {
    const dup = await h.call('adminA', 'post', '/admin/users', { email: h.users.agentA.email, password: PASSWORD, displayName: 'Dup', role: 'agent' });
    expect(dup.status).toBe(409);
    const short = await h.call('adminA', 'post', '/admin/users', { email: 'short@life.test', password: 'short', displayName: 'S', role: 'agent' });
    expect(short.status).toBe(422);
    for (const role of ['owner', 'ADMIN', 'superadmin', '', null, 7]) {
      const r = await h.call('adminA', 'post', '/admin/users', { email: `role${String(Math.random())}@life.test`.replace('0.', ''), password: PASSWORD, displayName: 'R', role });
      expect(r.status, `role ${JSON.stringify(role)}`).toBe(422);
    }
    // ...and the first account was not touched by either attempt. (The same email in ANOTHER organisation is covered in orgs-isolation.test.ts: X-001.)
    const still = await request(h.app).post('/api/v1/auth/login').send({ email: h.users.agentA.email, password: PASSWORD });
    expect(still.status).toBe(200);
    const me = await h.call('agentA', 'get', '/auth/me');
    expect(me.body.data.orgId).toBe(h.A.orgId);
  });

  it('keys: only an admin mints or revokes; a key cannot mint a key; a revoked key stops at once; an admin sees a colleague\'s keys', async () => {
    expect((await h.call('agentA', 'post', '/admin/keys', { name: 'no', scopes: ['contacts:read'] })).status).toBe(403);
    expect((await h.call('keyAll', 'post', '/admin/keys', { name: 'no', scopes: ['contacts:read'] })).status).toBe(403);
    const made = await h.call('adminA', 'post', '/admin/keys', { name: 'to revoke', scopes: ['contacts:read'], rateLimitPerMin: 0 });
    expect(made.status).toBe(201);
    const auth = { Authorization: `Bearer ${made.body.data.secret as string}` };
    expect((await request(h.app).get('/api/v1/contacts').set(auth)).status).toBe(200);
    // The list shows it, to another admin of the same organisation, and never shows a secret or a hash.
    const listed = await h.call('adminA2', 'get', '/admin/keys');
    const row = (listed.body.data as Array<{ id: string; name: string }>).find((k) => k.name === 'to revoke');
    expect(row).toBeDefined();
    expect(JSON.stringify(listed.body)).not.toContain(made.body.data.secret as string);
    expect(JSON.stringify(listed.body)).not.toMatch(/key_hash|keyHash|"secret"/);
    // A colleague admin can revoke it, and it stops on the next call.
    expect((await h.call('adminA2', 'delete', `/admin/keys/${row!.id}`)).status).toBeLessThan(300);
    expect((await request(h.app).get('/api/v1/contacts').set(auth)).status).toBe(401);
  });

  it('keys: scopes that do not exist and a key with no scopes are refused when minting', async () => {
    expect((await h.call('adminA', 'post', '/admin/keys', { name: 'bad', scopes: ['everything'] })).status).toBe(422);
    expect((await h.call('adminA', 'post', '/admin/keys', { name: 'none', scopes: [] })).status).toBe(422);
    expect((await h.call('adminA', 'post', '/admin/keys', { name: 'admin:all', scopes: ['admin'] })).status).toBe(422);
  });

  it('keys: a key with a low rate limit is slowed down with 429, and other keys are not slowed with it', async () => {
    const made = await h.call('adminA', 'post', '/admin/keys', { name: 'slow', scopes: ['contacts:read'], rateLimitPerMin: 3 });
    const auth = { Authorization: `Bearer ${made.body.data.secret as string}` };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(h.app).get('/api/v1/contacts/count').set(auth)).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toContain(429);
    expect((await h.call('keyAll', 'get', '/contacts/count')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('part 3: the wrong thing, sent by anyone', () => {
  it('a write from a signed-in browser without the CSRF header, or with a different one, is refused', async () => {
    const { Cookie } = h.headers.adminA;
    expect((await request(h.app).post('/api/v1/tags').set({ Cookie }).send({ name: 'no-csrf' })).status).toBe(403);
    expect((await request(h.app).post('/api/v1/tags').set({ Cookie, 'x-csrf-token': 'other' }).send({ name: 'wrong-csrf' })).status).toBe(403);
    expect((await request(h.app).post('/api/v1/tags').set({ Cookie: 'crm_session=' + h.tokens.adminA!, 'x-csrf-token': 'c' }).send({ name: 'no-csrf-cookie' })).status).toBe(403);
    // Reads need no CSRF token.
    expect((await request(h.app).get('/api/v1/tags').set({ Cookie })).status).toBe(200);
  });

  it('a key is not asked for a CSRF token, and a cookie does not make a key stronger', async () => {
    expect((await h.call('key:contacts:write', 'post', '/tags', { name: `by-key-${String(Date.now())}` })).status).toBe(201);
    const mixed = await request(h.app).get('/api/v1/admin/users').set({ ...h.headers['key:contacts:read'], Cookie: 'crm_session=nonsense' });
    expect(mixed.status).toBe(403);
  });

  it.each([
    ['no scheme', { Authorization: 'crm_live_abc' }],
    ['Basic instead of Bearer', { Authorization: 'Basic YTpi' }],
    ['Bearer with nothing', { Authorization: 'Bearer ' }],
    ['Bearer with a made-up key', { Authorization: 'Bearer crm_live_' + 'x'.repeat(32) }],
    ['two keys', { Authorization: 'Bearer a, Bearer b' }],
    ['lowercase scheme and a made-up key', { Authorization: 'bearer nope' }]
  ])('a wrong Authorization header (%s) is 401', async (_name, headers) => {
    expect((await request(h.app).get('/api/v1/contacts').set(headers)).status).toBe(401);
  });

  it('ids that are not ids never reach the database as an id: a clean 4xx, never a 500', async () => {
    for (const bad of ['abc', '123', 'null', 'undefined', '00000000-0000-0000-0000-00000000000', 'g0000000-0000-4000-8000-000000000000', '%00', '..%2F..%2Fetc', "1'%20OR%20'1'='1", '<script>', 'a'.repeat(300)]) {
      for (const p of [`/contacts/${bad}/detail`, `/conversations/${bad}`, `/campaigns/${bad}`, `/ai/templates/${bad}`, `/imports/${bad}`]) {
        const r = await h.call('adminA', 'get', p);
        expect(r.status, `${p}`).toBeGreaterThanOrEqual(400);
        expect(r.status, `${p}`).toBeLessThan(500);
      }
    }
  });

  it('a body that is not JSON, is the wrong shape or is far too big is refused with a 4xx, never a 500', async () => {
    const post = (b: string | object, type = 'application/json') => request(h.app).post('/api/v1/tags').set(h.headers.adminA).set('Content-Type', type).send(b as string);
    for (const [name, r] of [
      ['broken json', await post('{"name": ')],
      ['an array', await post('[1,2,3]')],
      ['a bare string', await post('"hello"')],
      ['null', await post('null')],
      ['wrong content type', await post('name=x', 'application/x-www-form-urlencoded')],
      ['plain text', await post('name', 'text/plain')],
      ['2 MB of json', await post(JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }))]
    ] as const) {
      expect(r.status, name).toBeGreaterThanOrEqual(400);
      expect(r.status, name).toBeLessThan(500);
    }
  });

  it('names that look like attacks are stored as plain text and given back as plain text', async () => {
    const nasty = ['<script>alert(1)</script>', "Robert'); DROP TABLE contact;--", '{{7*7}}', '${7*7}', '../../etc/passwd', '‮evil', '😀'.repeat(20), 'a\u0000b'];
    for (const name of nasty) {
      const r = await h.call('adminA', 'post', '/tags', { name });
      if (r.status === 201) {
        const list = await h.call('adminA', 'get', '/tags');
        expect((list.body.data as Array<{ name: string }>).some((t) => t.name === name.trim())).toBe(true);
      } else {
        expect(r.status, JSON.stringify(name)).toBe(422);
      }
    }
    // The table the injection tried to drop is still there.
    expect((await h.call('adminA', 'get', '/contacts/count')).status).toBe(200);
  });

  it('prototype pollution and extra fields in a body change nothing: a person cannot choose their own role or organisation by adding fields', async () => {
    const sneaky = { displayName: 'Sneaky', phone: '+919810088888', role: 'admin', orgId: h.B.orgId, org_id: h.B.orgId, __proto__: { admin: true }, constructor: { prototype: { admin: true } } };
    const made = await h.call('agentA', 'post', '/contacts', JSON.parse(JSON.stringify(sneaky)) as object);
    expect(made.status).toBeLessThan(500);
    const inB = await h.call('adminB', 'get', '/contacts?q=Sneaky');
    expect(JSON.stringify(inB.body)).not.toContain('Sneaky');
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    const me = await h.call('agentA', 'get', '/auth/me');
    expect(me.body.data.role).toBe('agent');
  });

  it.each(['limit=-1', 'limit=0', 'limit=abc', 'limit=1e9', 'limit=999999', 'offset=-5', 'offset=abc', 'q=' + '%'.repeat(5), 'sort=drop', 'tagId=notauuid', 'from=yesterday'])('list parameters (%s) never crash the server', async (qs) => {
    for (const p of ['/contacts', '/conversations', '/campaigns', '/tags']) {
      const r = await h.call('adminA', 'get', `${p}?${qs}`);
      expect(r.status, `${p}?${qs}`).toBeLessThan(500);
    }
  });

  it('the people list shows a person only what an assignee picker needs: no password hash, no email of other organisations, no secrets', async () => {
    const r = await h.call('agentA', 'get', '/users');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/password|hash|argon|token|secret/i);
    expect(text).not.toContain('b.test');
    expect(text).toContain('Admin A');
  });

  it('what an admin sees of their team never includes password hashes or tokens', async () => {
    const r = await h.call('adminA', 'get', '/admin/users');
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|passwordHash|argon2|token_hash/i);
  });

  it('the first admin of an organisation cannot be removed by an agent or by a key, and the organisation always keeps an admin', async () => {
    expect((await h.call('agentA', 'patch', `/admin/users/${h.users.adminA.id}`, { status: 'disabled' })).status).toBe(403);
    expect((await h.call('keyAll', 'patch', `/admin/users/${h.users.adminA.id}`, { status: 'disabled' })).status).toBe(403);
    const admins = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_membership m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = ${h.A.orgId} AND m.role = 'admin' AND u.status = 'active'`);
    expect(admins[0]!.n).toBeGreaterThanOrEqual(1);
  });
});
