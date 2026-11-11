import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import {
  createOrgWithAdmin, addUserToOrg, createSession, buildSegmentPredicate, segmentCriteria, countSegmentCriteria,
  countSegmentMatches
} from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The Contacts screen's backend: the grouped filters, files as sources, paging with a total, "Select all N"
 * resolved on the server, the person panel's detail, saved lists that reach a campaign audience, and a file's
 * tag that cannot be deleted. The point of most of these: the people the list shows are exactly the people a
 * bulk action and an export reach, and a filter value can never become SQL.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const hasher = new BuiltinPasswordHasher();

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let adminToken: string;
let agentToken: string;
let senderId: string;
let fileA: string;       // an import run with 4 people
let fileATag: string;
let ownTag: string;
let campaignId: string;
let p: Record<string, string>;   // person name -> contact id

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-contacts-screen');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const get = (path: string, token = agentToken) => request(app).get(`/api/v1${path}`).set(asSession(token));
const names = (body: { data: Array<{ displayName: string }> }) => body.data.map((c) => c.displayName).sort();
const filterQs = (f: object) => `filter=${encodeURIComponent(JSON.stringify(f))}`;

/** One person with a phone, optionally an email, saved columns, and the timestamps the filters read. */
async function person(name: string, o: {
  email?: string; fields?: Record<string, string>; dnc?: boolean; lastInboundDaysAgo?: number; wa?: boolean | null;
} = {}): Promise<string> {
  const id = (await rows<{ id: string }>(sql`
    INSERT INTO contact (org_id, display_name, source, do_not_contact, custom_fields, last_inbound_at)
    VALUES (${orgId}, ${name}, 'test', ${o.dnc ?? false}, ${JSON.stringify(o.fields ?? {})}::jsonb,
            ${o.lastInboundDaysAgo === undefined ? null : sql`now() - make_interval(days => ${o.lastInboundDaysAgo})`})
    RETURNING id`))[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary, wa_registered)
    VALUES (${orgId}, ${id}, 'phone', ${'+9198' + randomBytes(4).toString('hex').replace(/[a-f]/g, '7')}, true, ${o.wa ?? null})`);
  if (o.email !== undefined) {
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized)
      VALUES (${orgId}, ${id}, 'email', ${o.email})`);
  }
  return id;
}

/** A chat for the person, with the given last inbound / outbound times (days ago, null = none). */
async function chat(contactId: string, inboundDaysAgo: number | null, outboundDaysAgo: number | null): Promise<string> {
  const ago = (d: number | null) => d === null ? null : sql`now() - make_interval(days => ${d})`;
  const id = (await rows<{ id: string }>(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at, last_outbound_at)
    VALUES (${orgId}, ${contactId}, ${senderId}, ${ago(inboundDaysAgo)}, ${ago(outboundDaysAgo)}) RETURNING id`))[0]!.id;
  if (inboundDaysAgo !== null) {
    await db.execute(sql`INSERT INTO message (org_id, conversation_id, direction, status, content_type, created_at)
      VALUES (${orgId}, ${id}, 'inbound', 'delivered', 'text', ${ago(inboundDaysAgo)})`);
  }
  if (outboundDaysAgo !== null) {
    await db.execute(sql`INSERT INTO message (org_id, conversation_id, direction, status, content_type, sent_at)
      VALUES (${orgId}, ${id}, 'outbound', 'sent', 'text', ${ago(outboundDaysAgo)})`);
  }
  return id;
}

async function importRun(filename: string, who: string[], daysAgo: number, raw?: (n: string) => object): Promise<{ id: string; tagId: string }> {
  const tag = (await rows<{ id: string }>(sql`
    INSERT INTO tag (org_id, name) VALUES (${orgId}, ${filename}) RETURNING id`))[0]!.id;
  const id = (await rows<{ id: string }>(sql`
    INSERT INTO import_run (org_id, filename, byte_size, sha256, storage_key, status, headers, mapping, summary, created_at)
    VALUES (${orgId}, ${filename}, 1, ${randomBytes(8).toString('hex')}, 'k', 'committed',
            ${JSON.stringify(['Name', 'Phone', 'City', 'Due date'])}::jsonb,
            ${JSON.stringify({ version: 1, displayName: { from: 'Name' }, identities: [{ from: 'Phone', kind: 'phone' }] })}::jsonb,
            ${JSON.stringify({ tagId: tag })}::jsonb, now() - make_interval(days => ${daysAgo}))
    RETURNING id`))[0]!.id;
  for (const [i, name] of who.entries()) {
    await db.execute(sql`
      INSERT INTO import_row (org_id, import_run_id, row_number, outcome, contact_id, raw)
      VALUES (${orgId}, ${id}, ${i + 1}, 'created', ${p[name]!},
              ${JSON.stringify(raw?.(name) ?? { Name: name, Phone: '9', City: 'Pune', 'Due date': '12 Nov' })}::jsonb)`);
    await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${p[name]!}, ${tag})`);
  }
  return { id, tagId: tag };
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'cs', slug: 'cs', email: 'admin@cs.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  const agent = await addUserToOrg(db, hasher, {
    orgId, email: 'agent@cs.test', password: 'x', displayName: 'Agent', role: 'agent' });
  agentToken = (await createSession(db, { userId: agent.userId, orgId })).token;
  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 'Pune office', '+919000000001', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO custom_field (org_id, key, label, type) VALUES (${orgId}, 'city', 'City', 'text')`);

  p = {};
  p['Asha'] = await person('Asha Rao', { email: 'asha@x.test', fields: { city: 'Pune' }, lastInboundDaysAgo: 2, wa: true });
  p['Bilal'] = await person('Bilal Khan', { fields: { city: 'Mumbai' }, lastInboundDaysAgo: 40, wa: false });
  p['Chitra'] = await person('Chitra Iyer', { email: 'chitra@x.test', fields: { city: 'Pune' } });
  p['Dev'] = await person('Dev Patil', { dnc: true, fields: { city: '' }, lastInboundDaysAgo: 120 });
  p['Esha'] = await person('Esha Nair', { fields: { note: 'asha lives here' } });
  p['Farid'] = await person('Farid Shaikh', { email: 'farid@x.test' });
  // People are named by their first word in `p`.
  for (const k of Object.keys(p)) p[k.split(' ')[0]!] = p[k]!;

  // Chats: Asha wrote last (waiting for us), Bilal was answered, Chitra was messaged and never replied.
  await chat(p['Asha']!, 2, 5);
  await chat(p['Bilal']!, 40, 3);
  await chat(p['Chitra']!, null, 20);
  await chat(p['Dev']!, 120, null);

  ({ id: fileA, tagId: fileATag } = await importRun('Drivers Pune.csv', ['Asha', 'Bilal', 'Chitra', 'Dev'], 5));
  await importRun('Dealers Sep.xlsx', ['Esha', 'Farid'], 49);
  ownTag = (await rows<{ id: string }>(sql`
    INSERT INTO tag (org_id, name) VALUES (${orgId}, 'Called') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${p['Asha']!}, ${ownTag})`);

  // One campaign Asha and Bilal were in (sent), Chitra skipped.
  campaignId = (await rows<{ id: string }>(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, status, started_at)
    VALUES (${orgId}, 'Diwali offer', 'hi', ${senderId}, 'completed', now() - interval '3 days') RETURNING id`))[0]!.id;
  for (const [who, status] of [['Asha', 'sent'], ['Bilal', 'sent'], ['Chitra', 'skipped']] as const) {
    await db.execute(sql`INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status)
      VALUES (${orgId}, ${campaignId}, ${p[who]!}, ${status})`);
  }
});

describe('GET /contacts: paging, total and the columns of the table', () => {
  it('returns a total and pages by offset', async () => {
    const first = await get('/contacts?sort=name_asc&limit=4');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(6);
    expect(names(first.body)).toHaveLength(4);
    const second = await get('/contacts?sort=name_asc&limit=4&offset=4');
    expect(second.body.data).toHaveLength(2);
    expect(second.body.total).toBe(6);
    const all = [...first.body.data, ...second.body.data].map((c: { displayName: string }) => c.displayName);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
    const desc = await get('/contacts?sort=name_desc&limit=2');
    expect(desc.body.data[0].displayName).toBe('Farid Shaikh');
  });

  it('accepts up to 250 rows and refuses more', async () => {
    expect((await get('/contacts?limit=250')).status).toBe(200);
    expect((await get('/contacts?limit=251')).status).toBe(422);
  });

  it('carries last active, the file, the last campaign and which tag is the file’s', async () => {
    const r = await get(`/contacts?q=${encodeURIComponent('Asha Rao')}`);
    const a = r.body.data[0];
    expect(a.lastActiveAt).not.toBeNull();
    expect(a.file).toMatchObject({ id: fileA, filename: 'Drivers Pune.csv' });
    expect(a.lastCampaign).toMatchObject({ id: campaignId, name: 'Diwali offer' });
    expect(a.tags.map((t: { name: string; isFile: boolean }) => [t.name, t.isFile]))
      .toEqual([['Drivers Pune.csv', true], ['Called', false]]);
    const chitra = (await get('/contacts?q=Chitra')).body.data[0];
    expect(chitra.lastActiveAt).toBeNull();
    expect(chitra.lastCampaign).toBeNull();   // skipped is not "in a campaign"
  });

  it('gives each person’s row of the picked file, every column, and nothing without a file', async () => {
    const withFile = await get(`/contacts?file=${fileA}&q=Bilal`);
    expect(withFile.body.data[0].fileValues).toMatchObject({ City: 'Pune', 'Due date': '12 Nov' });
    expect((await get('/contacts?q=Bilal')).body.data[0].fileValues).toBeNull();
  });
});

describe('search covers name, phone and email only', () => {
  it('matches a name, an email and a phone', async () => {
    expect(names((await get('/contacts?q=asha')).body)).toEqual(['Asha Rao']);      // not Esha, whose saved note says "asha"
    expect(names((await get('/contacts?q=chitra@x')).body)).toEqual(['Chitra Iyer']);
    const phone = (await rows<{ v: string }>(sql`
      SELECT value_normalized AS v FROM contact_identity WHERE contact_id = ${p['Farid']!} AND kind = 'phone'`))[0]!.v;
    expect(names((await get(`/contacts?q=${encodeURIComponent(phone)}`)).body)).toEqual(['Farid Shaikh']);
  });

  it('does not look inside saved columns any more', async () => {
    expect((await get('/contacts?q=lives')).body.total).toBe(0);
  });
});

describe('the grouped filters', () => {
  const who = async (f: object, extra = '') => names((await get(`/contacts?${filterQs(f)}${extra}`)).body)
    .map((n) => n.split(' ')[0]);

  it('how they responded', async () => {
    expect(await who({ replied: 'ever' })).toEqual(['Asha', 'Bilal', 'Dev']);
    expect(await who({ replied: 'never' })).toEqual(['Chitra', 'Esha', 'Farid']);
    expect(await who({ activeWithinDays: 7 })).toEqual(['Asha']);
    expect(await who({ activeWithinDays: 90 })).toEqual(['Asha', 'Bilal']);
    expect(await who({ activeOlderThanDays: 90 })).toEqual(['Dev']);
  });

  it('waiting for us means they wrote last, even in a resolved chat', async () => {
    // Asha wrote 2 days ago and we last wrote 5 days ago; Dev wrote and was never answered; Bilal was answered.
    expect(await who({ waitingForUs: true })).toEqual(['Asha', 'Dev']);
    await db.execute(sql`UPDATE conversation SET status = 'closed' WHERE contact_id = ${p['Dev']!}`);
    expect(await who({ waitingForUs: true })).toEqual(['Asha', 'Dev']);
  });

  it('what you sent', async () => {
    expect(await who({ campaigns: 'some' })).toEqual(['Asha', 'Bilal']);
    expect(await who({ campaigns: 'never' })).toEqual(['Chitra', 'Dev', 'Esha', 'Farid']);
    expect(await who({ campaignId })).toEqual(['Asha', 'Bilal']);
    expect(await who({ lastContactedWithinDays: 7 })).toEqual(['Asha', 'Bilal']);
    expect(await who({ notContactedWithinDays: 7 })).toEqual(['Chitra', 'Dev', 'Esha', 'Farid']);
  });

  it('can you reach them', async () => {
    expect(await who({ dnc: 'only' })).toEqual(['Dev']);
    expect(await who({ dnc: 'exclude' })).toEqual(['Asha', 'Bilal', 'Chitra', 'Esha', 'Farid']);
    expect(await who({ whatsapp: 'yes' })).toEqual(['Asha']);
    expect(await who({ whatsapp: 'no' })).toEqual(['Bilal']);
    expect(await who({ whatsapp: 'unchecked' })).toEqual(['Chitra', 'Dev', 'Esha', 'Farid']);
    expect(await who({ email: 'yes' })).toEqual(['Asha', 'Chitra', 'Farid']);
    expect(await who({ email: 'no' })).toEqual(['Bilal', 'Dev', 'Esha']);
    expect(await who({ importedWithinDays: 30 })).toEqual(['Asha', 'Bilal', 'Chitra', 'Dev']);
    expect(await who({ importedWithinDays: 90 })).toHaveLength(6);
  });

  it('column rules on saved columns', async () => {
    expect(await who({ fieldRules: [{ key: 'city', op: 'is', value: 'pune' }] })).toEqual(['Asha', 'Chitra']);
    expect(await who({ fieldRules: [{ key: 'city', op: 'isnot', value: 'Pune' }] })).toEqual(['Bilal', 'Dev', 'Esha', 'Farid']);
    expect(await who({ fieldRules: [{ key: 'city', op: 'has', value: 'umb' }] })).toEqual(['Bilal']);
    expect(await who({ fieldRules: [{ key: 'city', op: 'blank' }] })).toEqual(['Dev', 'Esha', 'Farid']);
    expect(await who({ fieldRules: [{ key: 'city', op: 'filled' }] })).toEqual(['Asha', 'Bilal', 'Chitra']);
    // A rule with nothing to compare filters nothing.
    expect(await who({ fieldRules: [{ key: 'city', op: 'is', value: ' ' }] })).toHaveLength(6);
  });

  it('combines with AND, with a file, a tag and a search', async () => {
    expect(await who({ campaigns: 'some', email: 'yes' })).toEqual(['Asha']);
    expect(await who({ email: 'yes' }, `&file=${fileA}`)).toEqual(['Asha', 'Chitra']);
    expect(await who({ email: 'yes' }, `&tag=${ownTag}`)).toEqual(['Asha']);
    expect(await who({ email: 'yes' }, '&q=ch')).toEqual(['Chitra']);
  });

  it('the count agrees with the list', async () => {
    const f = { email: 'yes', dnc: 'exclude' };
    const list = await get(`/contacts?${filterQs(f)}&file=${fileA}`);
    const count = await get(`/contacts/count?${filterQs(f)}&file=${fileA}`);
    expect(count.body.data.total).toBe(list.body.total);
    expect(list.body.total).toBe(2);
  });

  it('refuses a filter it does not know, and one that is not JSON', async () => {
    expect((await get(`/contacts?${filterQs({ dropTable: true })}`)).status).toBe(422);
    expect((await get(`/contacts?${filterQs({ fieldRules: [{ key: 'City; DROP', op: 'is', value: 'x' }] })}`)).status).toBe(422);
    expect((await get(`/contacts?${filterQs({ activeWithinDays: 0 })}`)).status).toBe(422);
    expect((await get('/contacts?filter=%7Bnope')).status).toBe(422);
    expect((await get('/contacts/count?filter=%7Bnope')).status).toBe(422);
  });
});

describe('Select all N: bulk tagging applies the filter on the server', () => {
  const bulk = (tag: string, body: object, token = agentToken) =>
    request(app).post(`/api/v1/tags/${tag}/bulk`).set(asSession(token)).send(body);
  const tagged = async (id: string) =>
    (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact_tag WHERE tag_id = ${id}`))[0]!.n;

  it('tags exactly the filtered set, the same people the list shows, and returns who it added', async () => {
    const f = { email: 'yes' };
    const list = await get(`/contacts?${filterQs(f)}&file=${fileA}`);
    const target = { kind: 'search', importRunId: fileA, criteria: f };
    const dry = await bulk(ownTag, { action: 'add', target });
    expect(dry.body.data).toMatchObject({ dryRun: true, matched: list.body.total });

    const done = await bulk(ownTag, { action: 'add', dryRun: false, expectedCount: list.body.total, target });
    expect(done.status).toBe(200);
    // Asha already had it, so only Chitra was added.
    expect(done.body.data).toMatchObject({ matched: 2, changed: 1, addedIds: [p['Chitra']] });
    const carrying = (await rows<{ id: string }>(sql`SELECT contact_id AS id FROM contact_tag WHERE tag_id = ${ownTag}`))
      .map((r) => r.id).sort();
    expect(carrying).toEqual([p['Asha']!, p['Chitra']!].sort());

    // Undo removes exactly what was added: Asha keeps the tag she had before.
    const undo = await bulk(ownTag, {
      action: 'remove', dryRun: false, target: { kind: 'ids', ids: done.body.data.addedIds }
    });
    expect(undo.body.data.changed).toBe(1);
    expect(await tagged(ownTag)).toBe(1);
  });

  it('refuses when the audience changed since the count was shown', async () => {
    const target = { kind: 'search', criteria: { email: 'yes' } };
    const r = await bulk(ownTag, { action: 'add', dryRun: false, expectedCount: 99, target });
    expect(r.status).toBe(409);
    expect(await tagged(ownTag)).toBe(1);
  });

  it('refuses a criteria key it does not know', async () => {
    const r = await bulk(ownTag, { action: 'add', target: { kind: 'search', criteria: { nope: 1 } } });
    expect(r.status).toBe(422);
  });
});

describe('GET /contacts/sources', () => {
  it('lists files, own tags (not the file tags), saved lists with counts, campaigns and saved columns', async () => {
    await db.execute(sql`INSERT INTO segment (org_id, name, definition, saved)
      VALUES (${orgId}, 'Waiting for us', '{"waitingForUs":true}'::jsonb, true),
             (${orgId}, 'one-off', '{}'::jsonb, false)`);
    const r = await get('/contacts/sources');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.total).toBe(6);
    expect(d.files.map((f: { filename: string; count: number }) => [f.filename, f.count]))
      .toEqual([['Drivers Pune.csv', 4], ['Dealers Sep.xlsx', 2]]);
    // Name and Phone are already columns of the table, so they are not offered as file columns.
    expect(d.files[0].columns).toEqual(['City', 'Due date']);
    expect(d.files[0].tagId).toBe(fileATag);
    expect(d.files[0].tagName).toBe('Drivers Pune.csv');
    expect(d.tags.map((t: { name: string; count: number }) => [t.name, t.count])).toEqual([['Called', 1]]);
    expect(d.lists).toHaveLength(1);
    expect(d.lists[0]).toMatchObject({ name: 'Waiting for us', count: 2 });
    expect(d.campaigns).toEqual([{ id: campaignId, name: 'Diwali offer' }]);
    expect(d.fields).toEqual([{ key: 'city', label: 'City' }]);
  });
});

describe('deleting a tag', () => {
  it('refuses the tag an import added to its file, and deletes one of the person’s own', async () => {
    const file = await request(app).delete(`/api/v1/tags/${fileATag}`).set(asSession(adminToken));
    expect(file.status).toBe(409);
    expect(file.body.code).toBe('FILE_TAG');
    expect((await rows(sql`SELECT 1 FROM tag WHERE id = ${fileATag}`)).length).toBe(1);

    const own = await request(app).delete(`/api/v1/tags/${ownTag}`).set(asSession(adminToken));
    expect(own.status).toBe(204);
    expect((await rows(sql`SELECT 1 FROM contact WHERE id = ${p['Asha']!}`)).length).toBe(1);   // the person stays
  });
});

describe('GET /contacts/:id/detail', () => {
  it('gives the file with every column, the campaigns and the chat', async () => {
    const chatId = (await rows<{ id: string }>(sql`SELECT id FROM conversation WHERE contact_id = ${p['Asha']!}`))[0]!.id;
    const r = await get(`/contacts/${p['Asha']}/detail`);
    expect(r.status).toBe(200);
    expect(r.body.data.source).toMatchObject({ fileId: fileA, filename: 'Drivers Pune.csv' });
    expect(r.body.data.source.columns).toEqual([
      { header: 'Name', value: 'Asha' }, { header: 'Phone', value: '9' },
      { header: 'City', value: 'Pune' }, { header: 'Due date', value: '12 Nov' }
    ]);
    expect(r.body.data.campaigns).toHaveLength(1);
    expect(r.body.data.campaigns[0]).toMatchObject({ id: campaignId, name: 'Diwali offer', numberLabel: 'Pune office' });
    expect(r.body.data.conversationId).toBe(chatId);
  });

  it('says so plainly for a person with no file, no campaign and no chat', async () => {
    const nobody = await person('Nobody');
    const r = await get(`/contacts/${nobody}/detail`);
    expect(r.body.data).toEqual({ source: null, campaigns: [], conversationId: null });
  });

  it('is a 404 for someone who is not there', async () => {
    expect((await get('/contacts/00000000-0000-4000-8000-000000000000/detail')).status).toBe(404);
  });
});

describe('export with the same filter', () => {
  it('exports only the filtered people', async () => {
    const r = await request(app).get(`/api/v1/contacts/export?${filterQs({ email: 'yes' })}&file=${fileA}`)
      .set(asSession(adminToken));
    expect(r.status).toBe(200);
    expect(r.text).toContain('Asha Rao');
    expect(r.text).toContain('Chitra Iyer');
    expect(r.text).not.toContain('Farid Shaikh');
    expect(r.text).not.toContain('Bilal Khan');
  });
});

describe('saved lists reach a campaign audience, and their SQL is bound', () => {
  it('counts a list for the Contacts screen with do-not-contact people, and for a campaign without them', async () => {
    const def = { replied: 'ever' as const };
    expect(await countSegmentCriteria(db, orgId, def)).toBe(3);   // Asha, Bilal and Dev
    expect(await countSegmentMatches(db, orgId, def)).toBe(2);    // Dev is do-not-contact
  });

  it('keeps the do-not-contact rule in the audience predicate but not in the criteria', () => {
    const dialect = new PgDialect();
    const audience = dialect.sqlToQuery(buildSegmentPredicate({ email: 'yes' }, orgId)).sql;
    const criteria = dialect.sqlToQuery(sql.join(segmentCriteria({ email: 'yes' }, orgId), sql` AND `)).sql;
    expect(audience).toContain('do_not_contact = false');
    expect(criteria).not.toContain('do_not_contact');
  });

  it('puts every value, including a column name, in bound parameters and never in the SQL text', () => {
    const evil = "x'); DROP TABLE contact; --";
    const campaign = '11111111-1111-4111-8111-111111111111';
    const def = {
      tagIds: [campaign], campaignId: campaign, activeWithinDays: 9,
      fieldRules: [{ key: evil, op: 'has' as const, value: evil }, { key: 'city', op: 'is' as const, value: evil }]
    };
    const q = new PgDialect().sqlToQuery(buildSegmentPredicate(def, orgId));
    expect(q.sql).not.toContain('DROP');
    expect(q.sql).not.toContain(campaign);
    expect(q.params).toContain(evil);
    expect(q.params.filter((x) => x === evil)).toHaveLength(3);   // the key and the value of one rule, the value of the other
  });

  it('survives a hand-tampered stored definition: wrong values filter wrongly, never inject', async () => {
    const n = await countSegmentCriteria(db, orgId, {
      fieldRules: [{ key: "city' OR '1'='1", op: 'is', value: "' OR 1=1 --" }], activeWithinDays: -5
    });
    expect(n).toBe(0);
    expect((await rows(sql`SELECT 1 FROM contact WHERE org_id = ${orgId}`)).length).toBe(6);
  });

  it('a saved list with the new criteria is stored and used as a campaign audience', async () => {
    const created = await request(app).post('/api/v1/segments').set(asSession(agentToken))
      .send({ name: 'Waiting', definition: { waitingForUs: true, fieldRules: [{ key: 'city', op: 'blank' }] } });
    expect(created.status).toBe(201);
    const bad = await request(app).post('/api/v1/segments').set(asSession(agentToken))
      .send({ name: 'Bad', definition: { whatsapp: 'maybe' } });
    expect(bad.status).toBe(422);
    const preview = await request(app).post('/api/v1/segments/preview').set(asSession(agentToken))
      .send({ definition: { waitingForUs: true } });
    // Dev is waiting too but is do-not-contact, so a campaign would not reach them: Asha alone.
    expect(preview.body.data.count).toBe(1);
  });
});
