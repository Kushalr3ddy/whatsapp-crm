import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, addUserToOrg, createSession, saveAiSettings } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The Inbox list and the person panel: search over the name, the number and the (encrypted) last message, the five quick views with
 * their counts, the Filters (campaign, imported file, owner, status), paging, "Needs you", and the fill-ins a chat's person offers.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let otherOrgId: string;
let adminId: string;
let agentId: string;
let botId: string;
let senderId: string;
let admin: Record<string, string>;
let other: Record<string, string>;

const asSession = (token: string): Record<string, string> => ({ Cookie: `crm_session=${token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' });
const enc = (s: string): Buffer => Buffer.from(kms.encrypt(new TextEncoder().encode(s)));
const rows = <T>(r: unknown): T[] => r as T[];

/** Makes a person with a number and a chat on the test number, owned by `assignee`. */
async function chat(name: string, phone: string, opts: { assignee?: string | null; status?: string; unread?: number; fields?: Record<string, string> } = {}): Promise<{ contact: string; conv: string }> {
  const contact = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source, custom_fields) VALUES (${orgId}, ${name}, 'test', ${JSON.stringify(opts.fields ?? {})}::jsonb) RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO contact_identity(org_id, contact_id, kind, value_normalized, is_primary) VALUES (${orgId}, ${contact}, 'phone', ${phone}, true)`);
  const conv = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id, status, unread_count)
    VALUES (${orgId}, ${contact}, ${senderId}, ${opts.assignee ?? null}, ${opts.status ?? 'open'}, ${opts.unread ?? 0}) RETURNING id`))[0]!.id;
  return { contact, conv };
}

/** Adds a message; `at` is minutes ago so the order is fixed. */
async function say(conv: string, direction: 'inbound' | 'outbound', body: string, minutesAgo: number, campaignId: string | null = null): Promise<string> {
  return rows<{ id: string }>(await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, provider_message_id, sent_by, campaign_id, created_at)
    VALUES (${orgId}, ${conv}, ${direction}, ${direction === 'inbound' ? 'received' : 'sent'}, 'text', ${enc(body)}, ${kms.blindIndex(body)},
            ${randomBytes(6).toString('hex')}, ${direction === 'inbound' ? 'system' : 'user'}, ${campaignId}, now() - make_interval(mins => ${minutesAgo}))
    RETURNING id`))[0]!.id;
}

async function campaign(name: string): Promise<string> {
  return rows<{ id: string }>(await db.execute(sql`
    INSERT INTO campaign(org_id, name, body, sender_identity_id, status) VALUES (${orgId}, ${name}, 'hi', ${senderId}, 'running') RETURNING id`))[0]!.id;
}

async function file(name: string, contacts: string[]): Promise<string> {
  const run = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO import_run(org_id, filename, storage_key, sha256, byte_size, status)
    VALUES (${orgId}, ${name}, ${`k-${randomBytes(4).toString('hex')}`}, ${randomBytes(8).toString('hex')}, 10, 'committed') RETURNING id`))[0]!.id;
  let n = 1;
  for (const c of contacts) await db.execute(sql`INSERT INTO import_row(org_id, import_run_id, row_number, outcome, contact_id) VALUES (${orgId}, ${run}, ${n++}, 'created', ${c})`);
  return run;
}

const list = (params: Record<string, string | number> = {}, as = admin) => request(app).get('/api/v1/inbox').query(params).set(as);
const names = (r: { body: { data: Array<{ contactName: string }> } }): string[] => r.body.data.map((x) => x.contactName);

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-inbox', email: 'a@acme.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId; adminId = org.userId;
  agentId = (await addUserToOrg(db, hasher, { orgId, email: 'agent@acme.test', password: 'x', displayName: 'Agent', role: 'agent' })).userId;
  botId = (await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'Jobs only.' }, { type: 'user', id: adminId })).botUserId!;
  admin = asSession((await createSession(db, { userId: adminId, orgId })).token);
  senderId = rows<{ id: string }>(await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label, status) VALUES (${orgId}, 'baileys', 'Pune office', 'active') RETURNING id`))[0]!.id;
  const o = await createOrgWithAdmin(db, hasher, { orgName: 'Other', slug: 'other-inbox', email: 'o@other.test', password: 'x', displayName: 'Other admin' });
  otherOrgId = o.orgId;
  other = asSession((await createSession(db, { userId: o.userId, orgId: otherOrgId })).token);
});

describe('GET /inbox: search', () => {
  it('finds a chat by name, by number (any way it is typed) and by the text of its last message', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    const b = await chat('Rahul Nair', '+919632055102');
    await say(a.conv, 'inbound', 'Is Saturday morning possible?', 5);
    await say(b.conv, 'inbound', 'What is the on-road price for the ZXi?', 4);

    expect(names(await list({ q: 'priya' }))).toEqual(['Priya Sharma']);
    expect(names(await list({ q: '+91 98450' }))).toEqual(['Priya Sharma']);
    expect(names(await list({ q: '9632055' }))).toEqual(['Rahul Nair']);
    const byText = await list({ q: 'on-road' });
    expect(names(byText)).toEqual(['Rahul Nair']);
    expect(byText.body.data[0].lastMessage.text).toBe('What is the on-road price for the ZXi?');
    expect(names(await list({ q: 'nobody-has-this' }))).toEqual([]);
  });

  it('searches only the last message, not older ones', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    await say(a.conv, 'inbound', 'old words zebra', 10);
    await say(a.conv, 'outbound', 'newest words', 1);
    expect(names(await list({ q: 'zebra' }))).toEqual([]);
    expect(names(await list({ q: 'newest' }))).toEqual(['Priya Sharma']);
  });

  it('takes a % or _ in the search as typed, not as a wildcard', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    await say(a.conv, 'inbound', 'hello', 1);
    expect(names(await list({ q: '%%%' }))).toEqual([]);
    expect(names(await list({ q: '_' }))).toEqual([]);
  });

  it('keeps the chip counts in step with the search', async () => {
    const a = await chat('Priya Sharma', '+919845012345', { unread: 2 });
    const b = await chat('Rahul Nair', '+919632055102');
    await say(a.conv, 'inbound', 'hi there', 2);
    await say(b.conv, 'inbound', 'hi too', 1);
    const r = await list({ q: 'priya' });
    expect(r.body.meta.counts).toEqual({ all: 1, needs: 1, unread: 1, ai: 0, you: 1 });
    expect(r.body.meta.total).toBe(1);
  });
});

describe('GET /inbox: the quick views and their counts', () => {
  it('counts Needs you, Unread, AI answering and You answering, and the chip filters the list', async () => {
    const waiting = await chat('Waiting person', '+911111111111', { assignee: adminId, unread: 1 });
    await say(waiting.conv, 'inbound', 'help me', 3);
    const answered = await chat('Answered person', '+912222222222', { assignee: adminId });
    await say(answered.conv, 'inbound', 'help', 6);
    await say(answered.conv, 'outbound', 'done', 5);
    const aiChat = await chat('AI person', '+913333333333', { assignee: botId, unread: 3 });
    await say(aiChat.conv, 'inbound', 'hello', 2);
    const unowned = await chat('Nobody person', '+914444444444');
    await say(unowned.conv, 'inbound', 'anyone?', 1);

    const all = await list();
    expect(all.body.meta.counts).toEqual({ all: 4, needs: 2, unread: 2, ai: 1, you: 3 });
    expect(all.body.meta.orgTotal).toBe(4);

    expect(names(await list({ view: 'needs' })).sort()).toEqual(['Nobody person', 'Waiting person']);
    expect(names(await list({ view: 'unread' })).sort()).toEqual(['AI person', 'Waiting person']);
    expect(names(await list({ view: 'ai' }))).toEqual(['AI person']);
    expect(names(await list({ view: 'you' })).sort()).toEqual(['Answered person', 'Nobody person', 'Waiting person']);
    const needs = await list({ view: 'needs' });
    expect(needs.body.meta.total).toBe(2);
    expect(needs.body.data.every((r: { needsYou: boolean }) => r.needsYou)).toBe(true);
    // The other chips keep their own numbers while one is chosen.
    expect(needs.body.meta.counts.all).toBe(4);
  });

  it('shows an AI-owned chat under Needs you only when the AI is stuck on the last message', async () => {
    const stuck = await chat('Stuck on price', '+915555555555', { assignee: botId });
    await say(stuck.conv, 'inbound', 'price?', 4);
    const fine = await chat('AI is fine', '+916666666666', { assignee: botId });
    await say(fine.conv, 'inbound', 'hello', 4);
    await db.execute(sql`INSERT INTO ai_run(org_id, conversation_id, kind, outcome, reason, created_at) VALUES (${orgId}, ${stuck.conv}, 'reply', 'failed', 'model_timeout', now() - interval '3 minutes')`);
    await db.execute(sql`INSERT INTO ai_run(org_id, conversation_id, kind, outcome, reason, created_at) VALUES (${orgId}, ${fine.conv}, 'reply', 'sent', null, now() - interval '3 minutes')`);
    expect(names(await list({ view: 'needs' }))).toEqual(['Stuck on price']);

    // Once something goes out in the chat, the failed attempt no longer counts.
    await say(stuck.conv, 'outbound', 'A person answered', 1);
    expect(names(await list({ view: 'needs' }))).toEqual([]);
  });

  it('does not show a closed chat under Needs you', async () => {
    const c = await chat('Closed one', '+917777777777', { assignee: adminId, status: 'closed' });
    await say(c.conv, 'inbound', 'hello', 1);
    expect(names(await list({ view: 'needs', status: 'any' }))).toEqual([]);
  });
});

describe('GET /inbox: filters', () => {
  it('filters by status (open by default), owner, campaign and imported file, and the filters add up', async () => {
    const a = await chat('Priya Sharma', '+919845012345', { assignee: adminId });
    const b = await chat('Rahul Nair', '+919632055102', { assignee: agentId });
    const c = await chat('Fatima Khan', '+919886021456', { status: 'closed' });
    const diwali = await campaign('Diwali offer');
    const monsoon = await campaign('Monsoon offer');
    await say(a.conv, 'outbound', 'Diwali hi', 9, diwali);
    await say(b.conv, 'outbound', 'Monsoon hi', 9, monsoon);
    await say(c.conv, 'outbound', 'Diwali hi', 9, diwali);
    const drivers = await file('Drivers Pune.csv', [a.contact, c.contact]);

    expect(names(await list()).sort()).toEqual(['Priya Sharma', 'Rahul Nair']);
    expect(names(await list({ status: 'closed' }))).toEqual(['Fatima Khan']);
    expect(names(await list({ status: 'any' })).sort()).toEqual(['Fatima Khan', 'Priya Sharma', 'Rahul Nair']);
    expect(names(await list({ owner: 'me' }))).toEqual(['Priya Sharma']);
    expect(names(await list({ owner: 'unassigned', status: 'any' }))).toEqual(['Fatima Khan']);
    expect(names(await list({ owner: agentId }))).toEqual(['Rahul Nair']);
    expect(names(await list({ campaigns: diwali, status: 'any' })).sort()).toEqual(['Fatima Khan', 'Priya Sharma']);
    expect(names(await list({ campaigns: `${diwali},${monsoon}` })).sort()).toEqual(['Priya Sharma', 'Rahul Nair']);
    expect(names(await list({ files: drivers }))).toEqual(['Priya Sharma']);
    expect(names(await list({ files: drivers, campaigns: monsoon }))).toEqual([]);
  });

  it('lists the campaigns and files chats came from, with how many chats', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    const b = await chat('Rahul Nair', '+919632055102');
    const diwali = await campaign('Diwali offer');
    await say(a.conv, 'outbound', 'hi', 9, diwali);
    await say(b.conv, 'outbound', 'hi', 9, diwali);
    await file('Drivers Pune.csv', [a.contact]);
    const r = await request(app).get('/api/v1/inbox/filters').set(admin);
    expect(r.status).toBe(200);
    expect(r.body.data.campaigns).toEqual([{ id: diwali, name: 'Diwali offer', chats: 2 }]);
    expect(r.body.data.files).toMatchObject([{ name: 'Drivers Pune.csv', chats: 1 }]);
  });

  it('refuses a malformed filter instead of widening the list', async () => {
    expect((await list({ campaigns: 'not-a-uuid' })).status).toBe(422);
    expect((await list({ owner: 'everyone-else' })).status).toBe(422);
    expect((await list({ view: 'bogus' })).status).toBe(422);
    expect((await list({ limit: 9999 })).status).toBe(422);
  });

  it('never shows another organisation\'s chats', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    await say(a.conv, 'inbound', 'secret words', 1);
    const r = await list({ q: 'secret' }, other);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.meta.orgTotal).toBe(0);
    expect((await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(other)).status).toBe(404);
  });
});

describe('GET /inbox: paging and rows', () => {
  it('pages in the order of latest activity and reports the total', async () => {
    for (let i = 1; i <= 5; i++) {
      const c = await chat(`Person ${String(i)}`, `+91900000000${String(i)}`);
      await say(c.conv, 'inbound', `message ${String(i)}`, 50 - i);
      await db.execute(sql`UPDATE conversation SET last_inbound_at = now() - make_interval(mins => ${50 - i}) WHERE id = ${c.conv}`);
    }
    const first = await list({ limit: 2 });
    expect(names(first)).toEqual(['Person 5', 'Person 4']);
    expect(first.body.meta.total).toBe(5);
    expect(names(await list({ limit: 2, offset: 2 }))).toEqual(['Person 3', 'Person 2']);
    expect(names(await list({ limit: 2, offset: 4 }))).toEqual(['Person 1']);
  });

  it('dates a chat by its newest message even when only one side has spoken', async () => {
    const a = await chat('Only inbound', '+919000000011');
    await say(a.conv, 'inbound', 'hello?', 120);
    await db.execute(sql`UPDATE conversation SET last_inbound_at = now() - make_interval(mins => 120) WHERE id = ${a.conv}`);
    const row = (await list()).body.data[0];
    expect(Date.now() - new Date(row.lastAt).getTime()).toBeGreaterThan(100 * 60_000);
  });

  it('gives each row its owner kind, number, last message and a readable text', async () => {
    const a = await chat('Priya Sharma', '+919845012345', { assignee: botId, unread: 2 });
    await say(a.conv, 'inbound', 'Yes, Saturday works.', 1);
    const row = (await list()).body.data[0];
    expect(row).toMatchObject({
      contactName: 'Priya Sharma', contactPhone: '+919845012345', isAi: true, unreadCount: 2, senderLabel: 'Pune office', status: 'open',
      lastMessage: { text: 'Yes, Saturday works.', direction: 'inbound', kind: 'text' }
    });
    expect(JSON.stringify(row)).not.toContain('BodyEnc');
  });
});

describe('GET /conversations/:id/person', () => {
  it('offers the person\'s own details as fill-ins, only those with a value, and lists their files and campaigns', async () => {
    await db.execute(sql`INSERT INTO custom_field(org_id, key, label, type) VALUES (${orgId}, 'city', 'City', 'text'), (${orgId}, 'due_date', 'Due date', 'date'), (${orgId}, 'offer', 'Offer', 'text')`);
    const a = await chat('Priya Sharma', '+919845012345', { fields: { city: 'Pune', due_date: '2026-11-12' } });
    await db.execute(sql`INSERT INTO contact_identity(org_id, contact_id, kind, value_normalized, is_primary) VALUES (${orgId}, ${a.contact}, 'email', 'priya@example.com', true)`);
    const diwali = await campaign('Diwali offer');
    await say(a.conv, 'outbound', 'Diwali hi', 9, diwali);
    await say(a.conv, 'inbound', 'Yes!', 5);
    await file('Drivers Pune.csv', [a.contact]);

    const r = await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin);
    expect(r.status).toBe(200);
    expect(r.body.data.fillIns).toEqual([
      { key: 'name', label: 'Name', value: 'Priya Sharma' },
      { key: 'first_name', label: 'First name', value: 'Priya' },
      { key: 'phone', label: 'Phone', value: '+919845012345' },
      { key: 'email', label: 'Email', value: 'priya@example.com' },
      { key: 'city', label: 'City', value: 'Pune' },
      { key: 'due_date', label: 'Due date', value: '12 Nov 2026' }
    ]);
    expect(r.body.data.blankKeys).toEqual(['offer']);
    expect(r.body.data.files).toEqual([expect.objectContaining({ name: 'Drivers Pune.csv' })]);
    expect(r.body.data.campaigns).toEqual([expect.objectContaining({ id: diwali, name: 'Diwali offer', replied: true })]);
  });

  it('says a campaign without a reply is not replied to, and 422s a bad id', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    const diwali = await campaign('Diwali offer');
    await say(a.conv, 'outbound', 'Diwali hi', 9, diwali);
    const r = await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin);
    expect(r.body.data.campaigns[0].replied).toBe(false);
    expect((await request(app).get('/api/v1/conversations/nope/person').set(admin)).status).toBe(422);
  });
});

describe('[R-054] [#85] GET /conversations/:id/person says whether the person asked to stop, and the changes so far', () => {
  const opt = async (a: { contact: string }, doNotContact: boolean, reason: string, via?: string): Promise<void> => {
    await db.execute(sql`INSERT INTO audit_log (org_id, actor_type, actor_id, action, target_type, target_id, after)
      VALUES (${orgId}, 'system', '00000000-0000-4000-8000-000000000000', 'contact.dnc_changed', 'contact', ${a.contact},
              ${JSON.stringify({ doNotContact, reason, ...(via === undefined ? {} : { via }) })}::jsonb)`);
  };

  it('[#85] a person nobody flagged has no opt-out and no history', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    const r = await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin);
    expect(r.body.data.optOut).toEqual({ doNotContact: false, askedToStop: false, at: null, history: [] });
  });

  it('[#85] someone who said STOP: asked to stop, with the change in the history', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    await db.execute(sql`UPDATE contact SET do_not_contact = true, dnc_reason = 'opt_out', dnc_at = now() WHERE id = ${a.contact}`);
    await opt(a, true, 'opt_out', 'keyword');
    const r = await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin);
    expect(r.body.data.optOut).toMatchObject({ doNotContact: true, askedToStop: true });
    expect(r.body.data.optOut.history.map((h: { what: string }) => h.what)).toEqual(['Asked to stop']);
  });

  it('[#85] flagged by hand is "do not contact", not "asked to stop"; after START they can be messaged and the history shows both changes', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    await db.execute(sql`UPDATE contact SET do_not_contact = true, dnc_reason = 'manual', dnc_at = now() WHERE id = ${a.contact}`);
    await opt(a, true, 'manual');
    expect((await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin)).body.data.optOut).toMatchObject({ doNotContact: true, askedToStop: false });
    await db.execute(sql`UPDATE contact SET do_not_contact = false, dnc_reason = NULL, dnc_at = NULL WHERE id = ${a.contact}`);
    await opt(a, false, 'restart_word');
    const r = await request(app).get(`/api/v1/conversations/${a.conv}/person`).set(admin);
    expect(r.body.data.optOut).toMatchObject({ doNotContact: false, askedToStop: false });
    expect(r.body.data.optOut.history.map((h: { what: string }) => h.what)).toEqual(['Started again (sent a start word)', 'Marked do not contact']);
  });
});

describe('GET /conversations/:id/messages: the campaign each message belongs to', () => {
  it('says which campaign sent a message, so the thread can mark where it started', async () => {
    const a = await chat('Priya Sharma', '+919845012345');
    const diwali = await campaign('Diwali offer');
    await say(a.conv, 'outbound', 'Diwali hi', 9, diwali);
    await say(a.conv, 'inbound', 'Yes!', 5);
    const r = await request(app).get(`/api/v1/conversations/${a.conv}/messages`).set(admin);
    expect(r.body.data.map((m: { campaignId: string | null; campaignName: string | null }) => [m.campaignId, m.campaignName]))
      .toEqual([[diwali, 'Diwali offer'], [null, null]]);
  });
});
