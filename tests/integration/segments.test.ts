import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Dynamic segments (D-28) — the saved criteria-based audience.
 *
 * What matters here: the filter engine matches the right contacts (tag / replied / last-contacted,
 * AND-combined, DNC and deleted always excluded), a malformed definition is refused rather than
 * silently run, and a campaign targeting a segment freezes at launch like every other audience. The
 * injection risk is closed by construction (values are bound), which the "bogus value → 0, not an
 * error" case demonstrates.
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

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let key: string;
let tagPune: string;
let tagMumbai: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-segments');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

/** Inserts a contact with a phone, optional tag, optional inbound (replied), optional outbound age. */
async function makeContact(opts: {
  name: string; tagId?: string; repliedEver?: boolean; lastOutboundDaysAgo?: number; dnc?: boolean;
}): Promise<string> {
  const cid = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source, do_not_contact)
    VALUES (${orgId}, ${opts.name}, 'test', ${opts.dnc ?? false}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${cid}, 'phone', ${'+9198' + randomBytes(4).toString('hex')}, true)`);
  if (opts.tagId !== undefined) {
    await db.execute(sql`
      INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${cid}, ${opts.tagId})`);
  }
  if (opts.repliedEver === true || opts.lastOutboundDaysAgo !== undefined) {
    const conv = (await db.execute(sql`
      INSERT INTO conversation (org_id, contact_id, sender_identity_id)
      VALUES (${orgId}, ${cid}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    if (opts.repliedEver === true) {
      await db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type)
        VALUES (${orgId}, ${conv}, 'inbound', 'delivered', 'text')`);
    }
    if (opts.lastOutboundDaysAgo !== undefined) {
      await db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, sent_at)
        VALUES (${orgId}, ${conv}, 'outbound', 'sent', 'text',
                now() - make_interval(days => ${opts.lastOutboundDaysAgo}))`);
    }
  }
  return cid;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('s','segments') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  const tags = (await db.execute(sql`
    INSERT INTO tag (org_id, name) VALUES (${orgId}, 'pune'), (${orgId}, 'mumbai')
    RETURNING id, name`)) as unknown as Array<{ id: string; name: string }>;
  tagPune = tags.find((t) => t.name === 'pune')!.id;
  tagMumbai = tags.find((t) => t.name === 'mumbai')!.id;
  key = (await issueApiKey(db, {
    orgId, name: 's', scopes: ['contacts:read', 'contacts:write', 'messages:send', 'conversations:read']
  })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;
const preview = (definition: object) =>
  request(app).post('/api/v1/segments/preview').set(...auth()).send({ definition });

describe('the filter engine (which contacts a definition matches)', () => {
  it('matches by tag, and never a do-not-contact person', async () => {
    await makeContact({ name: 'Pune A', tagId: tagPune });
    await makeContact({ name: 'Pune B', tagId: tagPune });
    await makeContact({ name: 'Pune DNC', tagId: tagPune, dnc: true });   // excluded always
    await makeContact({ name: 'Mumbai', tagId: tagMumbai });

    const r = await preview({ tagIds: [tagPune] });
    expect(r.status).toBe(200);
    expect(r.body.data.count).toBe(2);
  });

  it('matches replied ever / never', async () => {
    await makeContact({ name: 'Replied', tagId: tagPune, repliedEver: true });
    await makeContact({ name: 'Silent', tagId: tagPune });

    expect((await preview({ replied: 'ever' })).body.data.count).toBe(1);
    expect((await preview({ replied: 'never' })).body.data.count).toBe(1);
  });

  it('matches last-contacted within N days', async () => {
    await makeContact({ name: 'Recent', lastOutboundDaysAgo: 2 });
    await makeContact({ name: 'Stale', lastOutboundDaysAgo: 60 });

    expect((await preview({ lastContactedWithinDays: 7 })).body.data.count).toBe(1);
    expect((await preview({ lastContactedWithinDays: 90 })).body.data.count).toBe(2);
  });

  it('combines criteria with AND', async () => {
    await makeContact({ name: 'Pune replied', tagId: tagPune, repliedEver: true });
    await makeContact({ name: 'Pune silent', tagId: tagPune });
    await makeContact({ name: 'Mumbai replied', tagId: tagMumbai, repliedEver: true });

    const r = await preview({ tagIds: [tagPune], replied: 'ever' });
    expect(r.body.data.count).toBe(1);   // only the Pune contact who has replied
  });

  it('an empty definition matches everyone eligible (reachable-and-not-DNC is a campaign concern)', async () => {
    await makeContact({ name: 'A' });
    await makeContact({ name: 'B' });
    await makeContact({ name: 'DNC', dnc: true });
    expect((await preview({})).body.data.count).toBe(2);
  });
});

describe('a definition cannot inject or run garbage', () => {
  it('refuses an unknown key with 422 (strict)', async () => {
    const r = await preview({ tagIds: [tagPune], evil: "'; DROP TABLE contact; --" });
    expect(r.status).toBe(422);
  });

  it('refuses a non-uuid tag id with 422', async () => {
    const r = await preview({ tagIds: ["'; DROP TABLE contact; --"] });
    expect(r.status).toBe(422);
  });

  it('treats a valid-but-unknown tag id as data — zero matches, not an error', async () => {
    await makeContact({ name: 'Pune', tagId: tagPune });
    const r = await preview({ tagIds: ['00000000-0000-4000-8000-0000000000ee'] });
    expect(r.status).toBe(200);
    expect(r.body.data.count).toBe(0);
  });
});

describe('CRUD and the live count', () => {
  it('creates, lists with a live count, and deletes', async () => {
    await makeContact({ name: 'Pune A', tagId: tagPune });
    await makeContact({ name: 'Pune B', tagId: tagPune });

    const created = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'Pune leads', definition: { tagIds: [tagPune] } });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/v1/segments').set(...auth());
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'Pune leads', contactCount: 2 });

    // The count is live: tag a third Pune contact and it rises without editing the segment.
    await makeContact({ name: 'Pune C', tagId: tagPune });
    const list2 = await request(app).get('/api/v1/segments').set(...auth());
    expect(list2.body.data[0].contactCount).toBe(3);

    const del = await request(app).delete(`/api/v1/segments/${created.body.data.id}`).set(...auth());
    expect(del.status).toBe(204);
    expect((await request(app).get('/api/v1/segments').set(...auth())).body.data).toHaveLength(0);
  });

  it('refuses a duplicate name with 409', async () => {
    await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'dupe', definition: {} });
    const again = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'dupe', definition: {} });
    expect(again.status).toBe(409);
  });
});

describe('a campaign targeting a segment', () => {
  it('freezes exactly the matching contacts, and later data changes do not move it', async () => {
    await makeContact({ name: 'Pune replied', tagId: tagPune, repliedEver: true });
    await makeContact({ name: 'Pune silent', tagId: tagPune });          // won't match replied:ever

    const seg = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'active pune', definition: { tagIds: [tagPune], replied: 'ever' } });
    const campaign = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'c', body: 'hi', senderIdentityId: senderId, fromSegmentId: seg.body.data.id });
    expect(campaign.status).toBe(201);

    const started = await request(app)
      .post(`/api/v1/campaigns/${campaign.body.data.id}/start`).set(...auth());
    expect(started.body.data.progress).toMatchObject({ total: 1, pending: 1 });

    // Make the silent contact reply AFTER launch — the frozen audience must not grow.
    await makeContact({ name: 'New replier', tagId: tagPune, repliedEver: true });
    const after = await request(app).get(`/api/v1/campaigns/${campaign.body.data.id}`).set(...auth());
    expect(after.body.data.progress.total).toBe(1);
  });

  it('previews a segment audience before start, matching what start then freezes', async () => {
    await makeContact({ name: 'Pune A', tagId: tagPune });
    await makeContact({ name: 'Pune B', tagId: tagPune });

    const seg = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'pune', definition: { tagIds: [tagPune] } });
    const campaign = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'c', body: 'hi', senderIdentityId: senderId, fromSegmentId: seg.body.data.id });
    const id = campaign.body.data.id as string;

    const prev = await request(app).get(`/api/v1/campaigns/${id}/preview`).set(...auth());
    expect(prev.body.data.audience.reachable).toBe(2);
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    const after = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    expect(after.body.data.progress.pending).toBe(2);
  });

  it('404s for a segment that does not exist', async () => {
    const r = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({
        name: 'c', body: 'hi', senderIdentityId: senderId,
        fromSegmentId: '00000000-0000-4000-8000-0000000000dd'
      });
    expect(r.status).toBe(404);
  });
});
