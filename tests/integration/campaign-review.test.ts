import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createOrgWithAdmin, createSession } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * The New campaign screen's backend: the review before a draft exists (several picks counted once, who is left out and why, the fill-ins
 * with samples and a few real people), the downloadable list of people with a blank fill-in, where each file and tag was last used, a draft
 * made from several picks, "messaged recently" as a choice with its own number of days, and a missing name reading "there".
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
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
let senderId: string;
let adminToken: string;
let tagA: string;
let tagB: string;
let people: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-campaign-review');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

const asSession = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=c`, 'x-csrf-token': 'c' });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

/** Five people: 0 and 1 are in tag A, 1 and 2 in tag B (1 is in both), 3 asked to stop, 4 has no number. Person 2 has no due date and no name. */
beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'r', slug: 'review', email: 'admin@r.test', password: 'x', displayName: 'Admin' });
  orgId = org.orgId;
  adminToken = (await createSession(db, { userId: org.userId, orgId })).token;
  senderId = (await rows<{ id: string }>(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active') RETURNING id`))[0]!.id;
  await db.execute(sql`INSERT INTO custom_field (org_id, key, label, type) VALUES (${orgId}, 'due_date', 'Due Date', 'date')`);
  tagA = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'a') RETURNING id`))[0]!.id;
  tagB = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'b') RETURNING id`))[0]!.id;
  const names: Array<string | null> = ['Asha Rao', 'Bilal Khan', null, 'Dev Patel', 'Esha Gupta'];
  const due = [{ due_date: '2026-11-12' }, { due_date: '2026-11-13' }, {}, { due_date: '2026-11-14' }, { due_date: '2026-11-15' }];
  people = [];
  for (let i = 0; i < 5; i++) {
    const c = (await rows<{ id: string }>(sql`
      INSERT INTO contact (org_id, display_name, source, custom_fields, do_not_contact)
      VALUES (${orgId}, ${names[i] ?? null}, 'test', ${JSON.stringify(due[i])}::jsonb, ${i === 3}) RETURNING id`))[0]!.id;
    if (i !== 4) {
      await db.execute(sql`INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${orgId}, ${c}, 'phone', ${`+9198765000${String(i).padStart(2, '0')}`}, true)`);
    }
    people.push(c);
  }
  for (const [c, t] of [[0, tagA], [1, tagA], [1, tagB], [2, tagB], [3, tagB], [4, tagB]] as const) {
    await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${people[c]!}, ${t})`);
  }
});

function ctx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)), sweepBatchSize: 50
  };
}
const review = (targets: unknown[], days?: number) =>
  request(app).post('/api/v1/campaigns/review').set(asSession(adminToken)).send({ targets, senderIdentityId: senderId, ...(days === undefined ? {} : { days }) });
const tag = (id: string) => ({ kind: 'tag', id });
const sentTexts = async (): Promise<string[]> => {
  const m = await rows<{ body: Uint8Array }>(sql`SELECT body_enc AS body FROM message WHERE direction = 'outbound' ORDER BY created_at`);
  return m.map((r) => new TextDecoder().decode(kms.decrypt(r.body)));
};

describe('the review before a draft exists', { timeout: 60_000 }, () => {
  it('counts a person in two picks once, and says who is left out and why', async () => {
    const r = await review([tag(tagA), tag(tagB)]);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 5, askedToStop: 1, noNumber: 1, recentlyMessaged: 0, recentDays: 14, defaultRecentDays: 14 });
    expect((await review([tag(tagA)])).body.data.total).toBe(2);
  });

  it('reads everyone when asked, and nobody with no picks', async () => {
    expect((await review([{ kind: 'everyone' }])).body.data.total).toBe(5);
    expect((await review([])).status).toBe(422);
  });

  it('lists the fill-ins with their kind, how many have each, and real people to preview as', async () => {
    const d = (await review([tag(tagB)])).body.data;
    const byKey = new Map((d.fields as Array<{ key: string; have: number; type: string; label: string }>).map((f) => [f.key, f]));
    expect(byKey.get('due_date')).toMatchObject({ have: 3, type: 'date', label: 'Due Date' });
    expect(byKey.get('name')).toMatchObject({ have: 3, type: 'text' });
    // Only people who can be messaged are offered to preview as: not the one who asked to stop, not the one with no number.
    const named = (d.people as Array<{ name: string | null; values: Record<string, string> }>);
    expect(named).toHaveLength(2);
    expect(named.some((p) => p.name === null)).toBe(true);
    expect(named.find((p) => p.name === 'Bilal Khan')!.values).toMatchObject({ first_name: 'Bilal', due_date: '13 Nov 2026' });
  });

  it('gives the quiet hours and the wait between messages, so the page can say when it ends', async () => {
    const d = (await review([tag(tagA)])).body.data;
    expect(d.quietHours).toMatchObject({ enabled: true, start: '22:00', end: '08:00' });
    expect(d.gapMinMs).toBeLessThan(d.gapMaxMs);
  });

  it('counts the people another campaign messaged from this number within the days given', async () => {
    const first = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'first', body: 'hello', senderIdentityId: senderId, fromTagId: tagA });
    await request(app).post(`/api/v1/campaigns/${first.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    const d = (await review([tag(tagA)], 14)).body.data;
    expect(d.recentlyMessaged).toBe(2);
    expect(d.recentDays).toBe(14);
    // Nobody was messaged from a number that is not this one.
    const other = (await rows<{ id: string }>(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status) VALUES (${orgId}, 'fake', 'o', '+919000000002', 'active') RETURNING id`))[0]!.id;
    const o = await request(app).post('/api/v1/campaigns/review').set(asSession(adminToken)).send({ targets: [tag(tagA)], senderIdentityId: other });
    expect(o.body.data.recentlyMessaged).toBe(0);
  });
});

describe('who has no value for a fill-in', { timeout: 60_000 }, () => {
  it('lists the people of the picks with no value, as name and number, leaving out those who cannot be messaged', async () => {
    const r = await request(app).post('/api/v1/campaigns/review/blanks').set(asSession(adminToken)).send({ targets: [tag(tagB)], key: 'due_date' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([{ name: null, phone: '+919876500002' }]);
    const names = await request(app).post('/api/v1/campaigns/review/blanks').set(asSession(adminToken)).send({ targets: [tag(tagB)], key: 'name' });
    expect(names.body.data).toEqual([{ name: null, phone: '+919876500002' }]);
  });
});

describe('where each file and tag was last used', { timeout: 60_000 }, () => {
  it('names the last campaign that was started with it, and nothing for a draft', async () => {
    const draft = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'just a draft', body: 'hi', senderIdentityId: senderId, fromTagId: tagA });
    expect((await request(app).get('/api/v1/campaigns/audience-history').set(asSession(adminToken))).body.data.tags).toEqual({});
    await request(app).post(`/api/v1/campaigns/${draft.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    const h = (await request(app).get('/api/v1/campaigns/audience-history').set(asSession(adminToken))).body.data;
    expect(h.tags[tagA]).toMatchObject({ name: 'just a draft' });
    expect(h.tags[tagB]).toBeUndefined();
  });
});

describe('making a draft from the picks', { timeout: 60_000 }, () => {
  const make = (extra: object) => request(app).post('/api/v1/campaigns').set(asSession(adminToken))
    .send({ name: 'n', body: 'hi {{name}}', senderIdentityId: senderId, ...extra });
  const row = async (id: string) => (await rows<{ tag: string | null; ids: string[] | null; days: number | null; leave: boolean }>(sql`
    SELECT from_tag_id AS tag, explicit_contact_ids AS ids, recent_days AS days, leave_out_recent AS leave FROM campaign WHERE id = ${id}`))[0]!;

  it('keeps a single tag as itself, so it is read again at start', async () => {
    const r = await make({ targets: [tag(tagA)], recentDays: 7, leaveOutRecent: true });
    expect(r.status).toBe(201);
    expect(await row(r.body.data.id as string)).toMatchObject({ tag: tagA, ids: null, days: 7, leave: true });
  });

  it('stores several picks as the one list of people, each once', async () => {
    const r = await make({ targets: [tag(tagA), tag(tagB)] });
    const saved = await row((r.body.data as { id: string }).id);
    expect(saved.tag).toBeNull();
    expect([...saved.ids!].sort()).toEqual([...people].sort());
  });

  it('refuses several picks that reach nobody, and a pick together with another way of choosing', async () => {
    const e1 = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'empty one') RETURNING id`))[0]!.id;
    const e2 = (await rows<{ id: string }>(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'empty two') RETURNING id`))[0]!.id;
    const nobody = await make({ targets: [tag(e1), tag(e2)] });
    expect(nobody.status).toBe(404);
    expect(nobody.body.detail).toBe('Nobody is in what you picked.');
    expect((await make({ targets: [tag(tagA)], fromTagId: tagB })).status).toBe(422);
  });
});

describe('messaged recently: a choice, with its own days', { timeout: 60_000 }, () => {
  async function firstCampaign(): Promise<void> {
    const first = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'first', body: 'hello', senderIdentityId: senderId, fromTagId: tagA });
    await request(app).post(`/api/v1/campaigns/${first.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    // It is over: nobody is still waiting in it, so only "messaged recently" can apply to the next one.
    await db.execute(sql`UPDATE campaign_recipient SET status = 'sent'`);
    await db.execute(sql`UPDATE campaign SET status = 'completed'`);
  }
  const recipients = async (id: string) => rows<{ status: string; skipReason: string | null }>(sql`
    SELECT status, skip_reason AS "skipReason" FROM campaign_recipient WHERE campaign_id = ${id}`);

  it('sends to them by default (a warning, not a block)', async () => {
    await firstCampaign();
    const second = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'second', body: 'again', senderIdentityId: senderId, fromTagId: tagA });
    await request(app).post(`/api/v1/campaigns/${second.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    expect((await recipients(second.body.data.id as string)).map((r) => r.status)).toEqual(['queued', 'queued']);
  });

  it('leaves them out when asked, skipped as cooldown, and not when the days do not reach back', async () => {
    await firstCampaign();
    await db.execute(sql`UPDATE message SET created_at = now() - interval '10 days'`);
    const wide = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'wide', body: 'again', senderIdentityId: senderId, fromTagId: tagA, leaveOutRecent: true, recentDays: 14 });
    const narrow = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'narrow', body: 'again', senderIdentityId: senderId, fromTagId: tagB, leaveOutRecent: true, recentDays: 7 });
    await request(app).post(`/api/v1/campaigns/${wide.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await request(app).post(`/api/v1/campaigns/${narrow.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    expect((await recipients(wide.body.data.id as string)).map((r) => [r.status, r.skipReason])).toEqual([['skipped', 'cooldown'], ['skipped', 'cooldown']]);
    // 10 days ago is outside 7 days, so nobody in the narrow campaign is left out for it.
    expect((await recipients(narrow.body.data.id as string)).filter((r) => r.skipReason === 'cooldown')).toEqual([]);
  });

  it('the default number of days is a setting', async () => {
    const saved = await request(app).put('/api/v1/antiban/settings').set(asSession(adminToken)).send({ recentDays: 7 });
    expect(saved.status).toBe(200);
    expect((await review([tag(tagA)])).body.data).toMatchObject({ recentDays: 7, defaultRecentDays: 7 });
    expect((await request(app).put('/api/v1/antiban/settings').set(asSession(adminToken)).send({ recentDays: 90 })).status).toBe(422);
  });
});

describe('a person with no name', { timeout: 60_000 }, () => {
  it('reads "there", is never left out for it, and nothing is asked', async () => {
    const created = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'greet', body: 'Hi {{name}}!', senderIdentityId: senderId, fromTagId: tagB, blankFillInChoice: 'skip' });
    await request(app).post(`/api/v1/campaigns/${created.body.data.id as string}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    expect((await sentTexts()).sort()).toEqual(['Hi Bilal Khan!', 'Hi there!']);
  });
});

describe('editing a draft', { timeout: 60_000 }, () => {
  const make = (extra: object) => request(app).post('/api/v1/campaigns').set(asSession(adminToken))
    .send({ name: 'n', body: 'hi {{name}}', senderIdentityId: senderId, ...extra });
  const patch = (id: string, body: object) => request(app).patch(`/api/v1/campaigns/${id}`).set(asSession(adminToken)).send(body);
  const saved = async (id: string) => (await rows<{
    name: string; body: string; sender: string; tag: string | null; ids: string[] | null; picks: unknown; days: number | null; leave: boolean; template: string | null;
  }>(sql`
    SELECT name, body, sender_identity_id AS sender, from_tag_id AS tag, explicit_contact_ids AS ids, audience_targets AS picks,
           recent_days AS days, leave_out_recent AS leave, ai_template_id AS template FROM campaign WHERE id = ${id}`))[0]!;

  it('keeps the picks a draft was made with, so it can be opened with them back', async () => {
    const r = await make({ targets: [tag(tagA), tag(tagB)] });
    expect((await saved(r.body.data.id as string)).picks).toEqual([tag(tagA), tag(tagB)]);
    const detail = await request(app).get(`/api/v1/campaigns/${r.body.data.id as string}`).set(asSession(adminToken));
    expect(detail.body.data).toMatchObject({ audienceTargets: [tag(tagA), tag(tagB)], recentDays: null, leaveOutRecent: false, blankFillInChoice: null });
  });

  it('changes the name, message, number, audience and "messaged recently" of a draft', async () => {
    const r = await make({ targets: [tag(tagA)] });
    const id = r.body.data.id as string;
    const other = (await rows<{ id: string }>(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status) VALUES (${orgId}, 'fake', 'o', '+919000000002', 'active') RETURNING id`))[0]!.id;
    const out = await patch(id, { name: 'renamed', body: 'new words', senderIdentityId: other, targets: [tag(tagA), tag(tagB)], recentDays: 7, leaveOutRecent: true });
    expect(out.status).toBe(200);
    const s = await saved(id);
    expect(s).toMatchObject({ name: 'renamed', body: 'new words', sender: other, tag: null, days: 7, leave: true });
    expect([...s.ids!].sort()).toEqual([...people].sort());
    expect(s.picks).toEqual([tag(tagA), tag(tagB)]);
    // Back to one tag: it is kept as itself again, and the stored list is dropped.
    await patch(id, { targets: [tag(tagB)] });
    expect(await saved(id)).toMatchObject({ tag: tagB, ids: null });
  });

  it('takes a template or picture off with null, and refuses what is not the org\'s', async () => {
    const r = await make({ targets: [tag(tagA)] });
    const id = r.body.data.id as string;
    expect((await patch(id, { aiTemplateId: null, mediaAssetId: null })).status).toBe(200);
    expect((await patch(id, { aiTemplateId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await patch(id, { senderIdentityId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await patch(id, { targets: [tag('00000000-0000-4000-8000-000000000000')] })).status).toBe(404);
    expect((await patch(id, {})).status).toBe(422);
  });

  it('opens a campaign made another way (people ticked in Contacts) as a pick of those people', async () => {
    const r = await make({ explicitContactIds: [people[0]!, people[1]!] });
    const d = (await request(app).get(`/api/v1/campaigns/${r.body.data.id as string}`).set(asSession(adminToken))).body.data;
    expect(d.audienceTargets).toBeNull();
    expect(d.explicitContactIds).toHaveLength(2);
    const out = await patch(r.body.data.id as string, { targets: [{ kind: 'people', ids: [people[0]!] }] });
    expect(out.status).toBe(200);
    expect((await review([{ kind: 'people', ids: [people[0]!, people[1]!] }])).body.data.total).toBe(2);
  });

  it('refuses to change the number, audience, picture or template once it has started, but still allows the wording while paused', async () => {
    const r = await make({ targets: [tag(tagA)] });
    const id = r.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(adminToken)).send({});
    expect((await patch(id, { name: 'too late' })).status).toBe(409);
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(asSession(adminToken)).send({});
    expect((await patch(id, { name: 'paused rename' })).status).toBe(200);
    const refused = await patch(id, { targets: [tag(tagB)] });
    expect(refused.status).toBe(409);
    expect((await saved(id)).tag).toBe(tagA);
  });
});

describe('[R-053] [#76] the review and the draft say who Start will skip as engaged', { timeout: 60_000 }, () => {
  /** An agent (here the admin) owns a chat with person `n` that has had traffic just now: the engagement gate's own definition. */
  async function engage(n: number, ago = '1 hour'): Promise<void> {
    const userId = (await rows<{ id: string }>(sql`SELECT user_id AS id FROM org_membership WHERE org_id = ${orgId} LIMIT 1`))[0]!.id;
    await db.execute(sql`
      INSERT INTO conversation (org_id, contact_id, sender_identity_id, assignee_user_id, last_inbound_at)
      VALUES (${orgId}, ${people[n]!}, ${senderId}, ${userId}, now() - ${ago}::interval)`);
  }
  const recipients = async (id: string) => rows<{ contactId: string; status: string; skipReason: string | null }>(sql`
    SELECT contact_id AS "contactId", status, skip_reason AS "skipReason" FROM campaign_recipient WHERE campaign_id = ${id}`);

  it('counts a person whose chat an agent is handling, and does not count them again as recently messaged', async () => {
    await engage(0);
    const r = await review([tag(tagA)]);
    expect(r.body.data).toMatchObject({ total: 2, engaged: 1, recentlyMessaged: 0, askedToStop: 0, noNumber: 0 });
  });

  it('does not count a chat nobody owns, or one that has been quiet for three days, or a person who asked to stop', async () => {
    await db.execute(sql`INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at) VALUES (${orgId}, ${people[0]!}, ${senderId}, now())`);
    await engage(1, '3 days');
    await engage(3);
    expect((await review([tag(tagA), tag(tagB)])).body.data.engaged).toBe(0);
  });

  it('is the same people Start skips as engaged: the draft preview and the recipients agree with the review', async () => {
    await engage(0);
    const made = await request(app).post('/api/v1/campaigns').set(asSession(adminToken))
      .send({ name: 'engaged', body: 'hello', senderIdentityId: senderId, fromTagId: tagA });
    const id = made.body.data.id as string;
    const preview = await request(app).get(`/api/v1/campaigns/${id}/preview`).set(asSession(adminToken));
    expect(preview.body.data.audience).toMatchObject({ total: 2, reachable: 2, engaged: 1 });
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(asSession(adminToken)).send({});
    await dispatchCampaigns(ctx());
    const skipped = (await recipients(id)).filter((r) => r.skipReason === 'engaged');
    expect(skipped.map((r) => r.contactId)).toEqual([people[0]!]);
    expect((await review([tag(tagA)])).body.data.engaged).toBe(skipped.length);
  });
});
