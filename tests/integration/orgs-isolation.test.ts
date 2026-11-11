import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { assumeRole, inspectDatabaseSecurity, resolveTenantRole, setTenant } from '@crm/db';
import { createSession } from '@crm/core';
import { FAKE, PASSWORD, startHarness, type Harness, type Seed, type Who } from './org-harness.js';

/**
 * Two organisations on one install: nobody in one can see, change or use anything of the other.
 *
 * Organisation A and B each own one of everything (see org-harness.ts). The suite tries to reach A's things as B's admin, B's agent and B's key,
 * by id, by list, by reference inside a create, and straight at the database. Then it checks, from A's side, that nothing of A changed.
 * It also checks the other half of "separate": the same name, shortcut, field key or phone number can exist in both organisations without touching each other.
 *
 * The answer for something that exists in another organisation is the same 404 as for something that does not exist: no 403 that would confirm it is there.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 120_000);
afterAll(async () => { await h.stop(); });

const A = (): Seed => h.A;
const B = (): Seed => h.B;

interface Attempt { label: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: () => string; body?: () => unknown; accept?: number[] }

/** Everything B's people might try against A's things. */
const ATTEMPTS: Attempt[] = [
  { label: 'read a contact', method: 'get', path: () => `/contacts/${A().contactIds[0]!}/detail` },
  { label: 'tag a contact of A', method: 'post', path: () => `/contacts/${A().contactIds[0]!}/tags`, body: () => ({ tagId: B().tagId }) },
  { label: 'put A\'s tag on B\'s contact', method: 'post', path: () => `/contacts/${B().contactIds[0]!}/tags`, body: () => ({ tagId: A().tagId }) },
  { label: 'change a custom field of A\'s contact', method: 'put', path: () => `/contacts/${A().contactIds[0]!}/custom-fields`, body: () => ({ values: { [A().fieldKey]: 'hacked' } }) },
  { label: 'flag A\'s contact do-not-contact', method: 'put', path: () => `/contacts/${A().contactIds[0]!}/do-not-contact`, body: () => ({ value: true }) },
  { label: 'delete A\'s tag', method: 'delete', path: () => `/tags/${A().tagId}` },
  { label: 'bulk-tag A\'s contacts with A\'s tag', method: 'post', path: () => `/tags/${A().tagId}/bulk`, body: () => ({ action: 'add', target: { kind: 'ids', ids: A().contactIds }, dryRun: false }) },
  { label: 'delete A\'s custom field by its key', method: 'delete', path: () => `/custom-fields/${A().fieldKey}`, accept: [404, 204] },
  { label: 'read A\'s chat', method: 'get', path: () => `/conversations/${A().conversationId}` },
  { label: 'read A\'s messages (200 with an empty list is the same answer as for a chat that does not exist; leaks are checked below)', method: 'get', path: () => `/conversations/${A().conversationId}/messages`, accept: [404, 200] },
  { label: 'read A\'s notes (200 with an empty list; no leak is checked below)', method: 'get', path: () => `/conversations/${A().conversationId}/notes`, accept: [404, 200] },
  { label: 'read A\'s person panel', method: 'get', path: () => `/conversations/${A().conversationId}/person` },
  { label: 'read A\'s sender status', method: 'get', path: () => `/conversations/${A().conversationId}/sender-status` },
  { label: 'assign A\'s chat to B\'s admin', method: 'patch', path: () => `/conversations/${A().conversationId}`, body: () => ({ assigneeUserId: h.users.adminB.id }) },
  { label: 'add a note to A\'s chat', method: 'post', path: () => `/conversations/${A().conversationId}/notes`, body: () => ({ body: 'intruder note' }) },
  { label: 'opt A\'s contact out from a chat', method: 'post', path: () => `/conversations/${A().conversationId}/opt-out`, body: () => ({}) },
  { label: 'mark A\'s chat read', method: 'post', path: () => `/conversations/${A().conversationId}/read`, body: () => ({}) },
  { label: 'add a participant to A\'s chat', method: 'post', path: () => `/conversations/${A().conversationId}/participants`, body: () => ({ userId: h.users.adminB.id }) },
  { label: 'remove a participant from A\'s chat', method: 'delete', path: () => `/conversations/${A().conversationId}/participants/${h.users.adminA.id}` },
  { label: 'send into A\'s chat', method: 'post', path: () => '/messages', body: () => ({ conversationId: A().conversationId, body: 'intruder reply' }) },
  { label: 'send from A\'s number', method: 'post', path: () => '/messages', body: () => ({ to: '+919800000099', senderId: A().senderId, body: 'from your number' }), accept: [404, 409] },
  { label: 'read A\'s campaign', method: 'get', path: () => `/campaigns/${A().campaignId}` },
  { label: 'read A\'s campaign ETA', method: 'get', path: () => `/campaigns/${A().campaignId}/eta` },
  { label: 'read A\'s campaign preview', method: 'get', path: () => `/campaigns/${A().campaignId}/preview` },
  { label: 'read A\'s campaign recipients', method: 'get', path: () => `/campaigns/${A().campaignId}/recipients` },
  { label: 'start A\'s campaign', method: 'post', path: () => `/campaigns/${A().campaignId}/start`, body: () => ({}) },
  { label: 'pause A\'s campaign', method: 'post', path: () => `/campaigns/${A().campaignId}/pause` },
  { label: 'cancel A\'s campaign', method: 'post', path: () => `/campaigns/${A().campaignId}/cancel` },
  { label: 'stop the AI on A\'s campaign', method: 'post', path: () => `/campaigns/${A().campaignId}/stop-ai`, body: () => ({}) },
  { label: 'rename A\'s campaign', method: 'patch', path: () => `/campaigns/${A().campaignId}`, body: () => ({ name: 'taken over' }) },
  { label: 'read A\'s AI template', method: 'get', path: () => `/ai/templates/${A().templateId}` },
  { label: 'use A\'s AI template', method: 'post', path: () => `/ai/templates/${A().templateId}/use`, body: () => ({ setAsDefault: true }) },
  { label: 'copy A\'s AI template', method: 'post', path: () => `/ai/templates/${A().templateId}/duplicate` },
  { label: 'delete A\'s AI template', method: 'delete', path: () => `/ai/templates/${A().templateId}` },
  { label: 'restore A\'s AI template', method: 'post', path: () => `/ai/templates/${A().templateId}/restore` },
  { label: 'permanently delete A\'s AI template', method: 'delete', path: () => `/ai/templates/${A().templateId}/permanent` },
  { label: 'overwrite A\'s AI template by saving with its id', method: 'post', path: () => '/ai/templates', body: () => ({ id: A().templateId, name: 'overwritten', description: 'x', instructions: 'x', audience: '', firstMessage: '' }), accept: [404, 403, 422, 409] },
  { label: 'answer now on A\'s chat', method: 'post', path: () => `/ai/conversations/${A().conversationId}/answer-now`, body: () => ({}), accept: [404, 409] },
  { label: 'read the AI notice of A\'s chat', method: 'get', path: () => `/ai/conversations/${A().conversationId}/notice`, accept: [404, 200] },
  { label: 'allow the AI to reply in A\'s chat', method: 'post', path: () => `/ai/conversations/${A().conversationId}/allow-reply`, body: () => ({ reason: 'intruder wants the AI to answer here' }), accept: [404, 409] },
  { label: 'change A\'s admin', method: 'patch', path: () => `/admin/users/${h.users.adminA.id}`, body: () => ({ status: 'disabled' }) },
  { label: 'change A\'s agent role', method: 'patch', path: () => `/admin/users/${h.users.agentA.id}`, body: () => ({ role: 'admin' }) },
  { label: 'reset the password of A\'s admin', method: 'post', path: () => `/admin/users/${h.users.adminA.id}/password`, body: () => ({ password: 'taken-over-password-1' }) },
  { label: 'link A\'s number', method: 'post', path: () => `/senders/${A().senderId}/link`, body: () => ({}) },
  { label: 'unlink A\'s number', method: 'post', path: () => `/senders/${A().senderId}/unlink`, body: () => ({}) },
  { label: 'remove A\'s number', method: 'post', path: () => `/senders/${A().senderId}/remove`, body: () => ({}) },
  { label: 'resume A\'s number', method: 'post', path: () => `/senders/${A().senderId}/resume` },
  { label: 'read A\'s number link state', method: 'get', path: () => `/senders/${A().senderId}/link` },
  { label: 'read A\'s number health', method: 'get', path: () => `/senders/${A().senderId}/health-events`, accept: [404, 200] }
];

/** What B's three kinds of people may be told. B's admin always gets 404; an agent or key may be stopped earlier by their own permissions (403). */
const CALLERS: Array<[Who, (a: Attempt) => number[]]> = [
  ['adminB', (a) => a.accept ?? [404]],
  ['agentB', (a) => [...(a.accept ?? [404]), 403]],
  ['keyB', (a) => [...(a.accept ?? [404]), 403]]
];

describe('reaching A\'s things by id from B', () => {
  beforeAll(async () => {
    // A real message in A's chat, so "B sees nothing" is a test of the wall and not of an empty chat.
    const sent = await h.call('adminA', 'post', '/messages', { conversationId: A().conversationId, body: 'secret message in A' });
    expect(sent.status).toBe(202);
  });

  it('B reads the messages of A\'s chat and gets nothing of A\'s (an empty list, the same as for a chat that does not exist)', async () => {
    for (const who of ['adminB', 'agentB', 'keyB'] as const) {
      const r = await h.call(who, 'get', `/conversations/${A().conversationId}/messages`);
      expect([200, 404], who).toContain(r.status);
      expect(r.text, who).not.toContain('secret message in A');
      if (r.status === 200) expect(r.body.data, who).toEqual([]);
      const notes = await h.call(who, 'get', `/conversations/${A().conversationId}/notes`);
      expect(notes.text, `${who} notes`).not.toContain('A private note');
      if (notes.status === 200) expect(notes.body.data, `${who} notes`).toEqual([]);
    }
  });

  for (const [who, expected] of CALLERS) {
    it(`${who}: every attempt is a 404 (no 403, no success, no 500), for ${String(ATTEMPTS.length)} different attempts`, async () => {
      const problems: string[] = [];
      for (const a of ATTEMPTS) {
        const r = await h.call(who, a.method, a.path(), a.body?.());
        if (!expected(a).includes(r.status)) problems.push(`${a.label}: ${a.method.toUpperCase()} ${a.path()} -> ${String(r.status)} ${JSON.stringify(r.body).slice(0, 140)}`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  it('afterwards, everything of A is exactly as it was', async () => {
    const camp = await h.call('adminA', 'get', `/campaigns/${A().campaignId}`);
    expect(camp.body.data).toMatchObject({ name: 'A-campaign', status: 'draft' });
    const tpl = await h.call('adminA', 'get', `/ai/templates/${A().templateId}`);
    expect(tpl.body.data).toMatchObject({ name: 'A-template', instructions: 'Be kind. Org A only.' });
    const detail = await h.call('adminA', 'get', `/contacts/${A().contactIds[0]!}/detail`);
    expect(JSON.stringify(detail.body)).not.toContain('hacked');
    expect(JSON.stringify(detail.body)).not.toMatch(/do.not.contact"?:\s*true/i);
    const withTag = await h.call('adminA', 'get', `/contacts?tag=${A().tagId}`);
    expect(JSON.stringify(withTag.body)).toContain('A-person-1');
    const tags = await h.call('adminA', 'get', '/tags');
    expect((tags.body.data as Array<{ name: string }>).map((t) => t.name)).toContain('a-tag');
    const fields = await h.call('adminA', 'get', '/custom-fields');
    expect((fields.body.data as Array<{ key: string }>).map((f) => f.key)).toContain(A().fieldKey);
    const conv = await h.call('adminA', 'get', `/conversations/${A().conversationId}`);
    // A's own admin sent the first message, so the chat is theirs; none of B's people took it.
    expect(conv.body.data.assigneeUserId).toBe(h.users.adminA.id);
    const msgs = await h.rows<{ id: string; direction: string }>(sql`SELECT id, direction FROM message WHERE conversation_id = ${A().conversationId}`);
    expect(msgs, 'only the one message A sent itself, nothing from B\'s attempts').toHaveLength(1);
    const thread = await h.call('adminA', 'get', `/conversations/${A().conversationId}/messages`);
    expect(thread.text).toContain('secret message in A');
    expect(thread.text).not.toContain('intruder');
    const notes = await h.call('adminA', 'get', `/conversations/${A().conversationId}/notes`);
    expect(JSON.stringify(notes.body)).not.toContain('intruder');
    expect((await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversation_participant WHERE conversation_id = ${A().conversationId}`))[0]!.n).toBe(0);
    const sender = await h.rows<{ status: string }>(sql`SELECT status FROM sender_identity WHERE id = ${A().senderId}`);
    expect(sender[0]!.status).toBe('active');
    // A's people are untouched: same role, still active, same password.
    const who = await h.rows<{ status: string; role: string }>(sql`SELECT u.status, m.role FROM app_user u JOIN org_membership m ON m.user_id = u.id WHERE u.id IN (${h.users.adminA.id}, ${h.users.agentA.id}) ORDER BY m.role`);
    expect(who.map((w) => `${w.role}:${w.status}`)).toEqual(['admin:active', 'agent:active']);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: h.users.adminA.email, password: PASSWORD })).status).toBe(200);
  });

  it('and B\'s own things are untouched too (A\'s people trying the same on B)', async () => {
    const asA: Array<[string, 'get' | 'post' | 'patch' | 'delete', string, unknown?]> = [
      ['read B\'s contact', 'get', `/contacts/${B().contactIds[0]!}/detail`],
      ['read B\'s campaign', 'get', `/campaigns/${B().campaignId}`],
      ['start B\'s campaign', 'post', `/campaigns/${B().campaignId}/start`, {}],
      ['delete B\'s template', 'delete', `/ai/templates/${B().templateId}`],
      ['read B\'s chat', 'get', `/conversations/${B().conversationId}`],
      ['disable B\'s admin', 'patch', `/admin/users/${h.users.adminB.id}`, { status: 'disabled' }]
    ];
    for (const [label, m, p, body] of asA) {
      const r = await h.call('adminA', m, p, body);
      expect(r.status, label).toBe(404);
    }
    expect((await h.call('adminB', 'get', `/campaigns/${B().campaignId}`)).body.data).toMatchObject({ name: 'B-campaign', status: 'draft' });
    expect((await h.call('adminB', 'get', `/ai/templates/${B().templateId}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('lists: each organisation sees only its own', () => {
  const MARKERS_OF_A = ['A-person', 'a-tag', 'A-campaign', 'A-template', 'a-hello', 'Hello from A', 'a_field', 'number-a', '@a.test', 'Admin A', 'Agent A', 'A private note', 'Org A'];
  const MARKERS_OF_B = ['B-person', 'b-tag', 'B-campaign', 'B-template', 'b-hello', 'Hello from B', 'b_field', 'number-b', '@b.test', 'Admin B', 'Agent B', 'B private note', 'Org B'];
  const LISTS = ['/contacts', '/contacts/sources', '/tags', '/conversations', '/inbox', '/inbox/filters', '/campaigns', '/canned-replies', '/custom-fields', '/senders', '/users', '/segments', '/imports', '/ai/status'];
  const ADMIN_LISTS = ['/admin/users', '/admin/keys', '/ai/templates', '/ai/templates/deleted', '/contacts/export', '/ai/usage'];

  it('B\'s admin, agent and key never see a trace of A in any list, and A\'s never see B', async () => {
    const problems: string[] = [];
    const check = async (who: Who, path: string, markers: string[], ids: string[]): Promise<void> => {
      const r = await h.call(who, 'get', path);
      if (r.status >= 500) { problems.push(`${who} ${path}: ${String(r.status)}`); return; }
      const text = r.text;
      for (const m of [...markers, ...ids]) if (text.includes(m)) problems.push(`${who} ${path} shows "${m}"`);
    };
    const idsA = [A().orgId, A().senderId, A().tagId, A().cannedId, A().templateId, A().campaignId, A().conversationId, ...A().contactIds, h.users.adminA.id, h.users.agentA.id];
    const idsB = [B().orgId, B().senderId, B().tagId, B().cannedId, B().templateId, B().campaignId, B().conversationId, ...B().contactIds, h.users.adminB.id, h.users.agentB.id];
    for (const p of LISTS) for (const who of ['adminB', 'agentB', 'keyB'] as const) await check(who, p, MARKERS_OF_A, idsA);
    for (const p of ADMIN_LISTS) await check('adminB', p, MARKERS_OF_A, idsA);
    for (const p of LISTS) for (const who of ['adminA', 'agentA', 'keyAll'] as const) await check(who, p, MARKERS_OF_B, idsB);
    for (const p of ADMIN_LISTS) await check('adminA', p, MARKERS_OF_B, idsB);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('counts are per organisation', async () => {
    expect((await h.call('adminA', 'get', '/contacts/count')).body.data.total).toBe(3);
    expect((await h.call('adminB', 'get', '/contacts/count')).body.data.total).toBe(3);
    expect((await h.call('adminB', 'get', '/contacts?q=A-person')).body.data).toEqual([]);
    expect((await h.call('adminA', 'get', '/contacts?q=B-person')).body.data).toEqual([]);
    // A tag of the other organisation filters B's list down to nobody; it does not match B's people and does not unlock A's.
    const crossTag = await h.call('adminB', 'get', `/contacts?tag=${A().tagId}`);
    expect(crossTag.text).not.toContain('A-person');
    expect(((await h.call('adminB', 'get', `/contacts?tag=${B().tagId}`)).body.data as unknown[]).length).toBe(1);
  });

  it('a search that tries to match everything across organisations still only finds its own', async () => {
    for (const q of ['%', '_', '*', '.', "' OR 1=1 --", 'person']) {
      const r = await h.call('adminB', 'get', `/contacts?q=${encodeURIComponent(q)}`);
      expect(r.status).toBeLessThan(500);
      expect(r.text).not.toContain('A-person');
    }
  });

  it('an export holds only the caller\'s organisation', async () => {
    const a = await h.call('adminA', 'get', '/contacts/export');
    const b = await h.call('adminB', 'get', '/contacts/export');
    expect(a.status).toBe(200);
    expect(a.text).toContain('A-person-1');
    expect(a.text).not.toContain('B-person');
    expect(b.text).toContain('B-person-1');
    expect(b.text).not.toContain('A-person');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('using A\'s ids inside something B creates', () => {
  it('a campaign of B naming A\'s number, tag, AI template, contact or list is refused (404) and nothing is created', async () => {
    const before = (await h.call('adminB', 'get', '/campaigns')).body.data.length as number;
    const base = { name: 'sneaky', body: 'hello', senderIdentityId: B().senderId, explicitContactIds: B().contactIds };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['A\'s number', { ...base, senderIdentityId: A().senderId }],
      ['A\'s tag', { name: 'sneaky', body: 'hello', senderIdentityId: B().senderId, fromTagId: A().tagId }],
      ['A\'s AI template', { ...base, aiTemplateId: A().templateId }],
      ['an unknown list', { name: 'sneaky', body: 'hello', senderIdentityId: B().senderId, fromSegmentId: FAKE }]
    ];
    for (const [label, body] of cases) {
      const r = await h.call('adminB', 'post', '/campaigns', body);
      expect(r.status, label).toBe(404);
    }
    for (const who of ['agentB', 'keyB'] as const) {
      expect((await h.call(who, 'post', '/campaigns', { ...base, senderIdentityId: A().senderId })).status, `${who} with A's number`).toBe(404);
    }
    expect((await h.call('adminB', 'get', '/campaigns')).body.data.length).toBe(before);
  });

  it('[DECISION] a campaign of B that lists only A\'s people is accepted but is empty: nobody of A is in it, nothing of A shows in it, and starting it messages nobody', async () => {
    const r = await h.call('adminB', 'post', '/campaigns', { name: 'only A people', body: 'hello', senderIdentityId: B().senderId, explicitContactIds: A().contactIds });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;
    const preview = await h.call('adminB', 'get', `/campaigns/${id}/preview`);
    expect(preview.body.data.audience.total).toBe(0);
    const start = await h.call('adminB', 'post', `/campaigns/${id}/start`, { confirmUnknownFillIns: true });
    expect(start.status).toBeLessThan(500);
    expect(await h.rows(sql`SELECT 1 FROM campaign_recipient WHERE campaign_id = ${id}`)).toHaveLength(0);
    expect(JSON.stringify([preview.body, start.body])).not.toContain('A-person');
  });

  it('a campaign of B listing one of B\'s people and one of A\'s never reaches A\'s person', async () => {
    const r = await h.call('adminB', 'post', '/campaigns', { name: 'mixed', body: 'hello', senderIdentityId: B().senderId, explicitContactIds: [B().contactIds[0]!, A().contactIds[0]!] });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    if (r.status === 201) {
      const id = r.body.data.id as string;
      const recipients = await h.call('adminB', 'get', `/campaigns/${id}/recipients`);
      expect(recipients.text).not.toContain('A-person');
      expect(recipients.text).not.toContain(A().contactIds[0]!);
      const inDb = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM campaign_recipient WHERE campaign_id = ${id} AND contact_id = ${A().contactIds[0]!}`);
      expect(inDb[0]!.n).toBe(0);
    } else {
      expect([404, 422]).toContain(r.status);
    }
  });

  it('editing B\'s campaign to use A\'s number, tag, template or picture is refused', async () => {
    for (const patch of [{ senderIdentityId: A().senderId }, { aiTemplateId: A().templateId }, { fromTagId: A().tagId }]) {
      const r = await h.call('adminB', 'patch', `/campaigns/${B().campaignId}`, patch);
      expect(r.status, JSON.stringify(patch)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    const after = await h.call('adminB', 'get', `/campaigns/${B().campaignId}`);
    expect(after.body.data.senderIdentityId).toBe(B().senderId);
    expect(after.body.data.aiTemplateId ?? null).toBeNull();
  });

  it('B\'s chat cannot be handed to A\'s person, and A\'s person cannot be added to it', async () => {
    const handed = await h.call('adminB', 'patch', `/conversations/${B().conversationId}`, { assigneeUserId: h.users.adminA.id });
    expect(handed.status).toBeGreaterThanOrEqual(400);
    expect(handed.status).toBeLessThan(500);
    const added = await h.call('adminB', 'post', `/conversations/${B().conversationId}/participants`, { userId: h.users.agentA.id });
    expect(added.status).toBeGreaterThanOrEqual(400);
    expect(added.status).toBeLessThan(500);
    const conv = await h.call('adminB', 'get', `/conversations/${B().conversationId}`);
    expect(conv.body.data.assigneeUserId ?? null).toBeNull();
    expect(JSON.stringify(conv.body.data.participants ?? [])).not.toContain(h.users.agentA.id);
  });

  it('a bulk tag over a list of ids that includes A\'s people only touches B\'s', async () => {
    const dry = await h.call('adminB', 'post', `/tags/${B().tagId}/bulk`, { action: 'add', target: { kind: 'ids', ids: [...B().contactIds, ...A().contactIds] }, dryRun: true });
    expect(dry.status).toBeLessThan(500);
    const done = await h.call('adminB', 'post', `/tags/${B().tagId}/bulk`, { action: 'add', target: { kind: 'ids', ids: [...B().contactIds, ...A().contactIds] }, dryRun: false });
    expect(done.status).toBeLessThan(500);
    const links = await h.rows<{ org: string }>(sql`SELECT c.org_id AS org FROM contact_tag ct JOIN contact c ON c.id = ct.contact_id WHERE ct.tag_id = ${B().tagId}`);
    expect(links.every((l) => l.org === B().orgId)).toBe(true);
    const aTagged = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact_tag WHERE contact_id IN (${sql.join(A().contactIds.map((i) => sql`${i}`), sql`, `)}) AND tag_id = ${B().tagId}`);
    expect(aTagged[0]!.n).toBe(0);
  });

  it('a key or a person minted by B\'s admin lands in B even when the body names A', async () => {
    const key = await h.call('adminB', 'post', '/admin/keys', { name: 'aimed at A', scopes: ['contacts:read'], orgId: A().orgId });
    expect(key.status).toBeLessThan(500);
    if (key.status === 201) {
      const seen = await request(h.app).get('/api/v1/contacts').set({ Authorization: `Bearer ${key.body.data.secret as string}` });
      expect(seen.text).toContain('B-person');
      expect(seen.text).not.toContain('A-person');
      expect((await h.call('adminA', 'get', '/admin/keys')).text).not.toContain('aimed at A');
    }
    const user = await h.call('adminB', 'post', '/admin/users', { email: `aimed-${String(Date.now())}@b.test`, password: PASSWORD, displayName: 'Aimed', role: 'admin', orgId: A().orgId });
    expect(user.status).toBeLessThan(500);
    if (user.status === 201) {
      const org = await h.rows<{ org_id: string }>(sql`SELECT m.org_id FROM org_membership m JOIN app_user u ON u.id = m.user_id WHERE u.display_name = 'Aimed'`);
      expect(org.map((o) => o.org_id)).toEqual([B().orgId]);
    }
  });

  it('B cannot create an organisation, or make itself one, without the deployment key', async () => {
    const body = { orgName: 'Clone', slug: 'org-a', email: 'clone@x.test', password: PASSWORD, displayName: 'Clone' };
    expect((await h.call('adminB', 'post', '/admin/orgs', body)).status).toBe(403);
    // With the deployment key a taken slug or a taken email is a 409 and the existing organisation is untouched.
    const taken = await h.call('bootstrap', 'post', '/admin/orgs', body);
    expect(taken.status).toBe(409);
    const takenEmail = await h.call('bootstrap', 'post', '/admin/orgs', { ...body, slug: 'org-clone', email: h.users.adminA.email });
    expect(takenEmail.status).toBe(409);
    expect((await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM org WHERE slug IN ('org-a', 'org-clone')`))[0]!.n).toBe(1);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: h.users.adminA.email, password: PASSWORD })).status).toBe(200);
  });

  it('a session cannot be made to act in an organisation its person does not belong to', async () => {
    const forged = (await createSession(h.db, { userId: h.users.adminA.id, orgId: B().orgId })).token;
    const r = await request(h.app).get('/api/v1/contacts').set({ Cookie: `crm_session=${forged}; crm_csrf=c`, 'x-csrf-token': 'c' });
    expect(r.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('the same names in both organisations', () => {
  it('a tag, a custom field key, a saved reply shortcut, a template name and a campaign name can be used by both without colliding', async () => {
    expect((await h.call('adminB', 'post', '/tags', { name: 'a-tag' })).status).toBe(201);
    expect((await h.call('adminB', 'post', '/custom-fields', { key: A().fieldKey, label: 'same key', type: 'text' })).status).toBe(201);
    expect((await h.call('adminB', 'post', '/canned-replies', { shortcut: 'a-hello', body: 'B says hello' })).status).toBe(201);
    expect((await h.call('adminB', 'post', '/ai/templates', { name: 'A-template', description: 'B copy of the name', instructions: 'B only', audience: '', firstMessage: '' })).status).toBeLessThan(300);
    expect((await h.call('adminB', 'post', '/campaigns', { name: 'A-campaign', body: 'B copy of the name', senderIdentityId: B().senderId, explicitContactIds: B().contactIds })).status).toBe(201);
    // A's own versions are exactly as they were.
    expect((await h.call('adminA', 'get', '/canned-replies')).text).toContain('Hello from A');
    expect((await h.call('adminA', 'get', '/canned-replies')).text).not.toContain('B says hello');
    expect((await h.call('adminA', 'get', `/ai/templates/${A().templateId}`)).body.data.instructions).toBe('Be kind. Org A only.');
    // Inside one organisation the same shortcut is still refused.
    expect((await h.call('adminB', 'post', '/canned-replies', { shortcut: 'a-hello', body: 'again' })).status).toBe(409);
  });

  it('the same phone number in two organisations is two different people, and "do not contact" in one does not reach the other', async () => {
    const phone = '+919877700001';
    const inA = await h.call('adminA', 'post', '/contacts', { displayName: 'Shared Number (A)', phone });
    const inB = await h.call('adminB', 'post', '/contacts', { displayName: 'Shared Number (B)', phone });
    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.body.data.id).not.toBe(inB.body.data.id);
    expect((await h.call('adminB', 'put', `/contacts/${inB.body.data.id as string}/do-not-contact`, { value: true })).status).toBeLessThan(300);
    const a = await h.call('adminA', 'get', `/contacts/${inA.body.data.id as string}/detail`);
    expect(JSON.stringify(a.body)).not.toMatch(/do.?not.?contact"?:\s*true/i);
    // And a number that opted out in B (a STOP) is not blocked in A.
    const blocked = await h.rows<{ org_id: string }>(sql`SELECT org_id FROM contact WHERE id = ${inB.body.data.id as string} AND do_not_contact = true`);
    expect(blocked.map((r) => r.org_id)).toEqual([B().orgId]);
  });

  it('the same email in a contact list is fine in both organisations', async () => {
    expect((await h.call('adminA', 'post', '/contacts', { displayName: 'Mail A', email: 'same@contacts.test' })).status).toBe(201);
    expect((await h.call('adminB', 'post', '/contacts', { displayName: 'Mail B', email: 'same@contacts.test' })).status).toBe(201);
  });

  it('deleting something in B never deletes the same-named thing in A', async () => {
    const bTag = (await h.call('adminB', 'get', '/tags')).body.data as Array<{ id: string; name: string }>;
    const copy = bTag.find((t) => t.name === 'a-tag');
    expect(copy).toBeDefined();
    expect((await h.call('adminB', 'delete', `/tags/${copy!.id}`)).status).toBeLessThan(300);
    expect(((await h.call('adminA', 'get', '/tags')).body.data as Array<{ name: string }>).map((t) => t.name)).toContain('a-tag');
    expect((await h.call('adminB', 'delete', '/custom-fields/' + A().fieldKey)).status).toBeLessThan(300);
    expect(((await h.call('adminA', 'get', '/custom-fields')).body.data as Array<{ key: string }>).map((f) => f.key)).toContain(A().fieldKey);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('the database itself is the second wall', () => {
  const TABLES = ['contact', 'conversation', 'message', 'campaign', 'campaign_recipient', 'tag', 'canned_reply', 'ai_template', 'custom_field', 'sender_identity', 'org_membership', 'audit_log'];

  it('with the restricted role and B\'s organisation set, a query with no WHERE returns none of A\'s rows, in any table that holds organisation data', async () => {
    const tenantRole = await resolveTenantRole(h.db, await inspectDatabaseSecurity(h.db));
    const problems: string[] = [];
    for (const table of TABLES) {
      try {
        const n = await h.db.transaction(async (tx) => {
          if (tenantRole !== null) await assumeRole(tx, tenantRole);
          await setTenant(tx, B().orgId);
          const r = (await tx.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = '${A().orgId}'`))) as unknown as Array<{ n: number }>;
          return r[0]!.n;
        });
        if (n !== 0) problems.push(`${table}: ${String(n)} of A's rows visible to B`);
      } catch (error) {
        problems.push(`${table}: ${(error as Error).message}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('[KNOWN GAP] api_key has no row-level policy: a query as another organisation with no WHERE sees every key row (hashes and prefixes, never secrets). Every route filters it by org, so this is depth only', async () => {
    const tenantRole = await resolveTenantRole(h.db, await inspectDatabaseSecurity(h.db));
    const n = await h.db.transaction(async (tx) => {
      if (tenantRole !== null) await assumeRole(tx, tenantRole);
      await setTenant(tx, B().orgId);
      return ((await tx.execute(sql`SELECT count(*)::int AS n FROM api_key WHERE org_id = ${A().orgId}`)) as unknown as Array<{ n: number }>)[0]!.n;
    });
    // Pins today's state. If a policy is added to api_key this turns red: change it to expect 0 and move the table into the list above.
    expect(n).toBeGreaterThan(0);
  });

  it('with no organisation set at all, the restricted role sees nothing', async () => {
    const tenantRole = await resolveTenantRole(h.db, await inspectDatabaseSecurity(h.db));
    if (tenantRole === null) return; // connecting role is already restricted and a row of a table with no policy cannot be proven here
    for (const table of ['contact', 'conversation', 'campaign', 'ai_template']) {
      // Either no rows or a refusal is safe; rows would not be.
      const n = await h.db.transaction(async (tx) => {
        await assumeRole(tx, tenantRole);
        return ((await tx.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as unknown as Array<{ n: number }>)[0]!.n;
      }).catch(() => 0);
      expect(n, table).toBe(0);
    }
  });

  it('with B\'s organisation set, a write that names A\'s organisation is refused by the database', async () => {
    const tenantRole = await resolveTenantRole(h.db, await inspectDatabaseSecurity(h.db));
    if (tenantRole === null) return;
    await expect(h.db.transaction(async (tx) => {
      await assumeRole(tx, tenantRole);
      await setTenant(tx, B().orgId);
      await tx.execute(sql`INSERT INTO tag (org_id, name) VALUES (${A().orgId}, 'planted by B')`);
    })).rejects.toThrow();
    expect((await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM tag WHERE name = 'planted by B'`))[0]!.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * X-001: one email, two organisations. OPEN BUG, found by this suite on 2026-11-10 (see docs/49-bug-list.md once filed).
 *
 * What the code does today, by design: `addUserToOrg` (packages/core/src/provisioning.ts:104-120) reuses an existing person when the email is already
 * registered, anywhere on the install, and only adds a membership; the password in the request is ignored for them. What it does NOT do is ask that person,
 * or the organisation they belong to. Everything an admin can then do to "a member" acts on the one global account:
 *   - reset the password (team.ts:137 -> provisioning.ts:145 `UPDATE app_user ... WHERE email`, and revokes every session in every organisation),
 *   - disable the account (team.ts:98 `UPDATE app_user SET status`, and revokes every session in every organisation),
 * and sign-in puts that person in the organisation they joined first (auth.ts:123-130 `ORDER BY m.joined_at ASC LIMIT 1`).
 * So an admin of B who knows the email of anyone in A can add them to B, set a password, sign in as them inside A, or lock them out of A.
 *
 * The tests below state what must be true whatever the fix is (refuse the add, or make passwords and status belong to the membership):
 * a person who belongs to A keeps their own password and their access to A, whatever an admin of B does. They are `it.fails` while the bug is open;
 * when it is fixed, change `it.fails` to `it`.
 */
describe('X-001: an admin of one organisation cannot reach a person of another by adding their email', () => {
  /** A new person in A, as an agent, with their own password. */
  async function personOfA(role: 'agent' | 'admin' = 'agent'): Promise<{ id: string; email: string }> {
    const email = `x001-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@a.test`;
    const made = await h.call('adminA', 'post', '/admin/users', { email, password: PASSWORD, displayName: 'Person of A', role });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { id: String(made.body.data.userId), email };
  }
  const signIn = (email: string, password: string) => request(h.app).post('/api/v1/auth/login').send({ email, password });

  it('[X-001] adding an email that belongs to a person of another organisation is refused, and nothing about them changes', async () => {
    const victim = await personOfA();
    const add = await h.call('adminB', 'post', '/admin/users', { email: victim.email, password: 'some-other-password-77', displayName: 'Renamed by B', role: 'agent' });
    expect(add.status).toBe(409);
    expect(add.body.code).toBe('EMAIL_UNAVAILABLE');
    expect((await signIn(victim.email, PASSWORD)).status).toBe(200);
    expect((await signIn(victim.email, 'some-other-password-77')).status).toBe(401);
    const team = await h.call('adminB', 'get', '/admin/users');
    expect(JSON.stringify(team.body.data)).not.toContain(victim.email);
  });

  it('[X-001] a person an operator attached to both organisations cannot have their password or status changed by either organisation admin', async () => {
    const victim = await personOfA();
    await h.rows(sql`INSERT INTO org_membership (org_id, user_id, role) VALUES (${B().orgId}, ${victim.id}, 'agent')`);
    const reset = await h.call('adminB', 'post', `/admin/users/${victim.id}/password`, { password: 'taken-over-password-1' });
    expect(reset.status).toBeGreaterThanOrEqual(400);
    const disable = await h.call('adminB', 'patch', `/admin/users/${victim.id}`, { status: 'disabled' });
    expect(disable.status).toBeGreaterThanOrEqual(400);
    expect((await signIn(victim.email, PASSWORD)).status).toBe(200);
  });

  it('[X-001] after B\'s admin adds their email, resets "their" password and signs in with it, they do not get into A', async () => {
    const victim = await personOfA();
    await h.call('adminB', 'post', '/admin/users', { email: victim.email, password: 'some-other-password-77', displayName: 'x', role: 'agent' });
    await h.call('adminB', 'post', `/admin/users/${victim.id}/password`, { password: 'taken-over-password-1' });
    const login = await signIn(victim.email, 'taken-over-password-1');
    if (login.status !== 200) return; // refused: good
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('crm_session='))!;
    const me = await request(h.app).get('/api/v1/auth/me').set({ Cookie: cookie.split(';')[0]! });
    expect(me.body.data.orgId, 'the session B\'s admin created for themselves is inside A').not.toBe(A().orgId);
  });

  it('[X-001] B\'s admin resetting the password of someone who also belongs to A does not change the password they use for A', async () => {
    const victim = await personOfA();
    await h.call('adminB', 'post', '/admin/users', { email: victim.email, password: 'some-other-password-77', displayName: 'x', role: 'agent' });
    await h.call('adminB', 'post', `/admin/users/${victim.id}/password`, { password: 'taken-over-password-1' });
    expect((await signIn(victim.email, PASSWORD)).status, 'their own password still works').toBe(200);
  });

  it('[X-001] B\'s admin disabling a person who also belongs to A does not lock them out of A', async () => {
    const victim = await personOfA();
    const session = await h.freshSession(victim.id, A().orgId);
    await h.call('adminB', 'post', '/admin/users', { email: victim.email, password: 'some-other-password-77', displayName: 'x', role: 'agent' });
    await h.call('adminB', 'patch', `/admin/users/${victim.id}`, { status: 'disabled' });
    expect((await request(h.app).get('/api/v1/contacts?limit=1').set(session.headers)).status, 'their session in A').toBe(200);
    expect((await signIn(victim.email, PASSWORD)).status, 'their sign-in').toBe(200);
  });

  it('[X-001] the same, aimed at an ADMIN of A: B\'s admin cannot take over A\'s admin', async () => {
    const victim = await personOfA('admin');
    await h.call('adminB', 'post', '/admin/users', { email: victim.email, password: 'some-other-password-77', displayName: 'x', role: 'agent' });
    await h.call('adminB', 'post', `/admin/users/${victim.id}/password`, { password: 'taken-over-password-1' });
    expect((await signIn(victim.email, PASSWORD)).status, 'A\'s admin still signs in with their own password').toBe(200);
  });
});
