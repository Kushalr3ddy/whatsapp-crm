import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, handleSend, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Campaigns (P7, first slice).
 *
 * The thing under test is not "can it send to a list" — that part is easy. It is that a
 * campaign **cannot outrun the anti-ban ceiling**, cannot bury an agent's reply, and can be
 * stopped instantly. A bulk sender that ignores the ceiling is how the number is lost, and the
 * number has no recovery path.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN', SEND_RATE_PER_MINUTE: 8, SEND_RATE_PER_DAY: 1500
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let key: string;
let contactIds: string[];

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage('crm-campaigns');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole,
    storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('c','campaigns') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
    VALUES (${orgId}, 'fake', 'blaster', '+919000000001', 'active', now() - interval '30 days')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;

  // Ten reachable people, plus one with no phone number at all.
  contactIds = [];
  for (let i = 0; i < 10; i++) {
    const c = (await db.execute(sql`
      INSERT INTO contact (org_id, display_name, source)
      VALUES (${orgId}, ${`Person ${String(i)}`}, 'test') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${c}, 'phone', ${`+9198765000${String(i).padStart(2, '0')}`}, true)`);
    contactIds.push(c);
  }
  const unreachable = (await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source)
    VALUES (${orgId}, 'No Phone', 'test') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  contactIds.push(unreachable);

  key = (await issueApiKey(db, {
    orgId, name: 'campaigns', scopes: ['messages:send', 'conversations:read']
  })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;

/** Creates a draft campaign over the given contacts. */
const create = (ids: string[] = contactIds, body = 'hello there') =>
  request(app).post('/api/v1/campaigns').set(...auth())
    .send({ name: 'outreach', body, senderIdentityId: senderId, explicitContactIds: ids });

/** A gateway context whose sends are fake and whose jitter costs nothing. */
function gatewayCtx(): WorkContext {
  return {
    db, provider: new FakeChannelProvider(), logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    limits: { perMinute: 8, perDay: 1500 }
  };
}

describe('creating one', () => {
  it('creates a draft and sends nothing', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('draft');

    // A draft has no audience yet and no messages. Creating is not committing.
    const messages = await db.execute(sql`
      SELECT count(*)::int AS n FROM message WHERE org_id = ${orgId}`);
    expect((messages as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('insists the audience is stated exactly once', async () => {
    // Never "everyone" implicitly: a campaign that silently grows is one whose cost and risk
    // nobody can predict.
    const neither = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'x', body: 'y', senderIdentityId: senderId });
    expect(neither.status).toBe(422);

    const both = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({
        name: 'x', body: 'y', senderIdentityId: senderId,
        explicitContactIds: contactIds, fromImportRunId: '00000000-0000-4000-8000-00000000beef'
      });
    expect(both.status).toBe(422);
  });

  it('refuses a sender belonging to someone else', async () => {
    const other = (await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('d','campaigns-2') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const theirSender = (await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${other}, 'fake', 'theirs', 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;

    const r = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'x', body: 'y', senderIdentityId: theirSender, explicitContactIds: contactIds });
    expect(r.status).toBe(404);
  });
});

describe('targeting by tag', () => {
  /** Tags the given contacts with a fresh tag, and returns the tag id. */
  const tagContacts = async (name: string, ids: string[]): Promise<string> => {
    const tagId = (await db.execute(sql`
      INSERT INTO tag (org_id, name) VALUES (${orgId}, ${name}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    for (const c of ids) {
      await db.execute(sql`
        INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${c}, ${tagId})`);
    }
    return tagId;
  };

  it('freezes exactly the tagged contacts as the audience', async () => {
    const tagId = await tagContacts('vip', contactIds.slice(0, 3));
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'to the vips', body: 'hello vip', senderIdentityId: senderId, fromTagId: tagId });
    expect(created.status).toBe(201);

    const started = await request(app)
      .post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    // Only the three tagged, reachable contacts — not the whole book, not the untagged rest.
    expect(started.body.data.progress).toMatchObject({ total: 3, pending: 3, skipped: 0 });
  });

  it('adding a contact to the tag after launch does not change the frozen audience', async () => {
    const tagId = await tagContacts('cohort', contactIds.slice(0, 2));
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'cohort blast', body: 'hi', senderIdentityId: senderId, fromTagId: tagId });
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    // Tag a third contact only AFTER the snapshot — it must not join the run.
    await db.execute(sql`
      INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${contactIds[5]!}, ${tagId})`);
    const r = await request(app).get(`/api/v1/campaigns/${created.body.data.id}`).set(...auth());
    expect(r.body.data.progress.total).toBe(2);
  });

  it('404s for a tag that does not exist', async () => {
    const r = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({
        name: 'x', body: 'y', senderIdentityId: senderId,
        fromTagId: '00000000-0000-4000-8000-0000000000cc'
      });
    expect(r.status).toBe(404);
  });

  it('still insists the audience is stated exactly once, now across three modes', async () => {
    const tagId = await tagContacts('dupe', contactIds.slice(0, 1));
    const twoModes = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({
        name: 'x', body: 'y', senderIdentityId: senderId,
        fromTagId: tagId, explicitContactIds: contactIds
      });
    expect(twoModes.status).toBe(422);
  });
});

describe('starting one', () => {
  it('freezes the audience and reports an unreachable contact rather than dropping it', async () => {
    const created = await create();
    const r = await request(app)
      .post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    expect(r.status).toBe(200);
    // Eleven in, ten sendable, one skipped with a reason. The totals have to add up, or an
    // operator stops trusting them.
    expect(r.body.data.progress).toMatchObject({ total: 11, pending: 10, skipped: 1 });

    const skipped = await db.execute(sql`
      SELECT skip_reason AS "skipReason" FROM campaign_recipient
      WHERE campaign_id = ${created.body.data.id} AND status = 'skipped'`);
    expect((skipped as unknown as Array<{ skipReason: string }>)[0]!.skipReason).toBe('no_phone');
  });

  it('tells you how long it will take, before it starts', async () => {
    const created = await create();
    const r = await request(app)
      .post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    // The number an operator needs at the moment of starting, not afterwards.
    expect(r.body.data.outlook).toMatchObject({ remaining: 10, daysToFinish: 0 });
    expect(r.body.data.outlook.allowanceToday).toBeGreaterThan(0);
  });

  it('warns when the sender is still warming up', async () => {
    // A 5,000-person campaign on a four-day-old number is a months-long proposition, and that
    // must never be a surprise discovered after starting.
    await db.execute(sql`
      UPDATE sender_identity SET warmup_started_at = now() - interval '1 day'
      WHERE id = ${senderId}`);

    const created = await create();
    const r = await request(app)
      .post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    expect(r.body.data.outlook.inWarmup).toBe(true);
    expect(r.body.data.outlook.allowanceToday).toBeLessThanOrEqual(36);
  });

  it('does not re-snapshot when a paused campaign resumes', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth());

    // Somebody new arrives while it is paused. They must not silently join an audience that
    // was already approved.
    const late = (await db.execute(sql`
      INSERT INTO contact (org_id, display_name, source)
      VALUES (${orgId}, 'Latecomer', 'test') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${late}, 'phone', '+919876511111', true)`);

    const resumed = await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    expect(resumed.body.data.progress.total).toBe(11);
  });
});

describe('the ceiling holds', () => {
  it('queues only what the sender may still send today', async () => {
    // The whole point. Ten recipients, a ceiling of four — four messages, not ten.
    await db.execute(sql`
      UPDATE sender_identity SET daily_cap_override = 4 WHERE id = ${senderId}`);
    const created = await create();
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    const queued = await dispatchCampaigns(gatewayCtx());
    expect(queued).toBe(4);

    const messages = await db.execute(sql`
      SELECT count(*)::int AS n FROM message WHERE org_id = ${orgId} AND status = 'queued'`);
    expect((messages as unknown as Array<{ n: number }>)[0]!.n).toBe(4);
  });

  it('counts messages already waiting against the allowance', async () => {
    // Without this a sweep every few seconds would queue the whole audience before the first
    // message had gone out — the ceiling would be enforced on sends but not on the queue.
    await db.execute(sql`
      UPDATE sender_identity SET daily_cap_override = 4 WHERE id = ${senderId}`);
    const created = await create();
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    await dispatchCampaigns(gatewayCtx());
    const second = await dispatchCampaigns(gatewayCtx());
    expect(second).toBe(0);
  });

  it('leaves the rest pending rather than failing them', async () => {
    await db.execute(sql`
      UPDATE sender_identity SET daily_cap_override = 4 WHERE id = ${senderId}`);
    const created = await create();
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());

    const r = await request(app).get(`/api/v1/campaigns/${created.body.data.id}`).set(...auth());
    expect(r.body.data.progress).toMatchObject({ queued: 4, pending: 6 });
    // Still running: there is more to do tomorrow.
    expect(r.body.data.status).toBe('running');
  });

  it('never dispatches a campaign that is not running', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth());

    expect(await dispatchCampaigns(gatewayCtx())).toBe(0);
  });
});

describe('stopping one', () => {
  it('pauses instantly, because pending recipients are simply not dispatched', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());

    const paused = await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth());
    expect(paused.body.data.status).toBe('paused');

    const r = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    // Nothing was queued, so nothing has to be unqueued.
    expect(r.body.data.progress.pending).toBe(10);
    expect(r.body.data.progress.queued).toBe(0);
  });

  it('cancels by marking the rest skipped, so the totals still add up', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/cancel`).set(...auth());

    const r = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    expect(r.body.data.status).toBe('cancelled');
    expect(r.body.data.progress).toMatchObject({ pending: 0, total: 11 });

    const reasons = await db.execute(sql`
      SELECT count(*)::int AS n FROM campaign_recipient
      WHERE campaign_id = ${id} AND skip_reason = 'cancelled'`);
    expect((reasons as unknown as Array<{ n: number }>)[0]!.n).toBe(10);
  });

  it('will not restart something that was cancelled', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/cancel`).set(...auth());

    const again = await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    expect(again.status).toBe(409);
  });
});

describe('finishing', () => {
  it('completes once every recipient has been dealt with', async () => {
    const created = await create(contactIds.slice(0, 3));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());

    // Pretend the gateway sent them.
    await db.execute(sql`
      UPDATE message SET status = 'sent', sent_at = now()
      WHERE org_id = ${orgId} AND status = 'queued'`);
    await dispatchCampaigns(gatewayCtx());

    const r = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    expect(r.body.data.status).toBe('completed');
    expect(r.body.data.progress).toMatchObject({ sent: 3, pending: 0, queued: 0 });
  });

  it('puts campaign messages in the contact’s existing thread', async () => {
    // A campaign message belongs in the same conversation as everything else, not in a
    // parallel history an agent cannot see.
    const created = await create(contactIds.slice(0, 1));
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM conversation
      WHERE org_id = ${orgId} AND contact_id = ${contactIds[0]!}`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(1);

    const tagged = await db.execute(sql`
      SELECT campaign_id AS "campaignId" FROM message WHERE org_id = ${orgId}`);
    expect((tagged as unknown as Array<{ campaignId: string }>)[0]!.campaignId)
      .toBe(created.body.data.id);
  });
});

describe('dry-run preview (before start)', () => {
  /** Tags the given contacts with a fresh tag, and returns the tag id. */
  const tagContacts = async (name: string, ids: string[]): Promise<string> => {
    const tagId = (await db.execute(sql`
      INSERT INTO tag (org_id, name) VALUES (${orgId}, ${name}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    for (const c of ids) {
      await db.execute(sql`
        INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${c}, ${tagId})`);
    }
    return tagId;
  };

  it('counts the would-be audience without freezing it, and forecasts the reachable ones', async () => {
    // Two reachable people plus the one with no number, all tagged.
    const tagId = await tagContacts('preview', [contactIds[0]!, contactIds[1]!, contactIds[10]!]);
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'p', body: 'y', senderIdentityId: senderId, fromTagId: tagId });
    const id = created.body.data.id as string;

    const r = await request(app).get(`/api/v1/campaigns/${id}/preview`).set(...auth());
    expect(r.status).toBe(200);
    expect(r.body.data.audience).toMatchObject({ total: 3, reachable: 2, unreachable: 1 });
    expect(typeof r.body.data.forecast.daysToFinish).toBe('number');

    // A preview writes nothing — the campaign is still a draft with no recipients frozen.
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM campaign_recipient WHERE campaign_id = ${id}`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('matches exactly what start then freezes', async () => {
    const tagId = await tagContacts('exact', contactIds.slice(0, 4));
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'p', body: 'y', senderIdentityId: senderId, fromTagId: tagId });
    const id = created.body.data.id as string;

    const preview = await request(app).get(`/api/v1/campaigns/${id}/preview`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    const after = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    // The preview's reachable count is precisely the pending recipients start creates.
    expect(preview.body.data.audience.reachable).toBe(after.body.data.progress.pending);
  });

  it('404s for a campaign that does not exist', async () => {
    const r = await request(app)
      .get('/api/v1/campaigns/00000000-0000-4000-8000-0000000000bb/preview').set(...auth());
    expect(r.status).toBe(404);
  });
});

describe('per-recipient results (who it reached, and why not the rest)', () => {
  it('lists every recipient with a status, none silently absent (AC-5)', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());

    const r = await request(app).get(`/api/v1/campaigns/${id}/recipients?limit=200`).set(...auth());
    expect(r.status).toBe(200);
    // Eleven frozen: ten pending, one skipped — the same totals GET /:id reports.
    expect(r.body.data).toHaveLength(11);
    const statuses = r.body.data.map((x: { status: string }) => x.status).sort();
    expect(statuses.filter((s: string) => s === 'pending')).toHaveLength(10);
    expect(statuses.filter((s: string) => s === 'skipped')).toHaveLength(1);
    // Each row carries who it is and, for a skip, why.
    const skipped = r.body.data.find((x: { status: string }) => x.status === 'skipped');
    expect(skipped.displayName).toBe('No Phone');
    expect(skipped.skipReason).toBeTruthy();
  });

  it('filters to one status', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());

    const r = await request(app)
      .get(`/api/v1/campaigns/${id}/recipients?status=skipped`).set(...auth());
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].displayName).toBe('No Phone');
  });

  it('searches by the contact’s name or number', async () => {
    const created = await create();
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());

    const byName = await request(app)
      .get(`/api/v1/campaigns/${id}/recipients?q=Person 3`).set(...auth());
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].displayName).toBe('Person 3');

    const byPhone = await request(app)
      .get(`/api/v1/campaigns/${id}/recipients?q=98765000${'05'}`).set(...auth());
    expect(byPhone.body.data).toHaveLength(1);
    expect(byPhone.body.data[0].displayName).toBe('Person 5');
  });

  it('reflects the message delivery status once dispatched', async () => {
    const created = await create(contactIds.slice(0, 3));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());
    await db.execute(sql`
      UPDATE message SET status = 'delivered', sent_at = now()
      WHERE org_id = ${orgId} AND status = 'queued'`);
    await dispatchCampaigns(gatewayCtx());   // reconcile moves recipients to 'sent'

    const r = await request(app).get(`/api/v1/campaigns/${id}/recipients`).set(...auth());
    expect(r.body.data).toHaveLength(3);
    for (const row of r.body.data) {
      expect(row.status).toBe('sent');
      expect(row.messageStatus).toBe('delivered');
    }
  });

  it('404s for a campaign that does not exist, rather than an empty list', async () => {
    const r = await request(app)
      .get('/api/v1/campaigns/00000000-0000-4000-8000-0000000000aa/recipients').set(...auth());
    expect(r.status).toBe(404);
  });
});

describe('isolation', () => {
  it('will not show another tenant’s campaign', async () => {
    const created = await create();
    const other = (await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('e','campaigns-3') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const otherKey = (await issueApiKey(db, {
      orgId: other, name: 'other', scopes: ['conversations:read']
    })).secret;

    const r = await request(app).get(`/api/v1/campaigns/${created.body.data.id}`)
      .set('Authorization', `Bearer ${otherKey}`);
    expect(r.status).toBe(404);
  });
});

describe('body variation on dispatch (D-26)', () => {
  it('renders spintax and {{name}} into each recipient’s message', async () => {
    const created = await create(contactIds.slice(0, 3), '{Hi|Hey} {{name}}');
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());

    const rows = await db.execute(sql`
      SELECT body_enc AS "bodyEnc" FROM message WHERE campaign_id = ${id}`);
    const bodies = (rows as unknown as Array<{ bodyEnc: Uint8Array }>)
      .map((r) => new TextDecoder().decode(kms.decrypt(r.bodyEnc)));

    expect(bodies).toHaveLength(3);
    // Each is a rendered copy: one of the spintax openers, then the contact's own name.
    for (const b of bodies) expect(b).toMatch(/^(Hi|Hey) Person [0-9]$/);
    // And the names differ — the variable was filled per recipient, not left literal.
    expect(new Set(bodies).size).toBe(3);
  });
});

describe('the outbound-only clamp in campaign dispatch (Layer 1)', () => {
  it('holds a never-replied sender to 20/day, then lifts once it has received an inbound', async () => {
    // 25 reachable contacts; the sender (from beforeEach) has never received an inbound.
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const c = (await db.execute(sql`
        INSERT INTO contact (org_id, display_name, source)
        VALUES (${orgId}, ${`Clamp ${String(i)}`}, 'test') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
      await db.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${orgId}, ${c}, 'phone', ${`+91990000${String(i).padStart(4, '0')}`}, true)`);
      ids.push(c);
    }
    const created = await create(ids);
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());

    // Clamped to 20, not 25, because the number has never been replied to.
    expect(await dispatchCampaigns(gatewayCtx())).toBe(20);

    // Give it an inbound: the clamp lifts and the remaining recipients can queue.
    await db.execute(sql`UPDATE sender_identity SET last_inbound_at = now() WHERE id = ${senderId}`);
    expect(await dispatchCampaigns(gatewayCtx())).toBe(5);
  });
});

describe('the identical-body guard (D-26 backstop)', () => {
  it('caps identical bodies per window, but a varied body is never capped', async () => {
    // Give the sender an inbound so the outbound-only clamp does not also bite.
    await db.execute(sql`UPDATE sender_identity SET last_inbound_at = now() WHERE id = ${senderId}`);
    const capped: WorkContext = {
      ...gatewayCtx(), limits: { perMinute: 8, perDay: 1500, identicalBodyCap: 3 }
    };

    // A no-variation body: all eight recipients share one body, so only three go out this window.
    const flat = await create(contactIds.slice(0, 8), 'exactly the same every time');
    await request(app).post(`/api/v1/campaigns/${flat.body.data.id}/start`).set(...auth());
    expect(await dispatchCampaigns(capped)).toBe(3);
    const flatProg = await request(app).get(`/api/v1/campaigns/${flat.body.data.id}`).set(...auth());
    expect(flatProg.body.data.progress).toMatchObject({ queued: 3, pending: 5 });

    // A varied body ({{name}} renders eight distinct messages) is never capped — all eight queue.
    const varied = await create(contactIds.slice(0, 8), 'Hi {{name}}, a word.');
    // Same people as the campaign above, on purpose — so lift the two recipient-experience gates
    // (cooldown, duplicate-campaign) that would otherwise skip them; this test is about the cap.
    await db.execute(sql`
      UPDATE campaign SET gate_overrides = ARRAY['cooldown', 'duplicate_campaign']
      WHERE id = ${varied.body.data.id}`);
    await request(app).post(`/api/v1/campaigns/${varied.body.data.id}/start`).set(...auth());
    expect(await dispatchCampaigns(capped)).toBe(8);
  });
});

/** A real small picture: a PNG, a GIF with two frames, and a JPEG, made on the spot. */
async function pic(kind: 'png' | 'gif' | 'jpeg'): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const base = sharp({ create: { width: 32, height: 24, channels: 3, background: '#d03030' } });
  return kind === 'png' ? base.png().toBuffer() : kind === 'jpeg' ? base.jpeg().toBuffer() : base.gif().toBuffer();
}
const upload = (bytes: Buffer, filename = 'offer.png') =>
  request(app).post(`/api/v1/campaigns/media?filename=${encodeURIComponent(filename)}`).set(...auth()).set('Content-Type', 'application/octet-stream').send(bytes);
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('a campaign with a picture', () => {
  it('stores a picture, lists it, and refuses video, documents, empty and oversized files with the reason', async () => {
    const ok = await upload(await pic('png'));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ contentType: 'image/png', gif: false, uses: 0, filename: 'offer.png' });
    const list = await request(app).get('/api/v1/campaigns/media').set(...auth());
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([ok.body.data.id]);

    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
    const video = await upload(mp4, 'clip.mp4');
    expect(video.status).toBe(415);
    expect(video.body.detail).toContain('MP4 videos are not supported yet');
    expect((await upload(Buffer.from('%PDF-1.4 hello'), 'a.pdf')).status).toBe(415);
    const big = await upload(Buffer.concat([await pic('jpeg'), Buffer.alloc(5 * 1024 * 1024)]), 'big.jpg');
    expect(big.status).toBe(413);
    expect(big.body.detail).toContain('The most is 5 MB');
  });

  it('sends the picture to everyone with the message as the caption', async () => {
    const stored = (await upload(await pic('jpeg'), 'diwali.jpg')).body.data;
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'with picture', body: 'Hi {{name}}, offer!', senderIdentityId: senderId, explicitContactIds: contactIds.slice(0, 3), mediaAssetId: stored.id });
    expect(created.status).toBe(201);
    const detail = await request(app).get(`/api/v1/campaigns/${created.body.data.id}`).set(...auth());
    expect(detail.body.data).toMatchObject({ mediaAssetId: stored.id, mediaFilename: 'diwali.jpg', mediaContentType: 'image/jpeg' });

    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    expect(await dispatchCampaigns(gatewayCtx())).toBe(3);
    const rows = await db.execute(sql`SELECT id, content_type AS "contentType", media_id AS "mediaId" FROM message WHERE campaign_id = ${created.body.data.id}`) as unknown as Array<{ id: string; contentType: string; mediaId: string }>;
    expect(rows).toHaveLength(3);
    for (const r of rows) { expect(r.contentType).toBe('image'); expect(r.mediaId).toBe(stored.id); }

    // The gateway then sends it as a photo with the caption.
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });
    await handleSend({ ...gatewayCtx(), provider, storage: media.storage, sleep: async () => {} }, rows[0]!.id);
    const sent = provider.sent[0]!.content;
    expect(sent.kind === 'freeform' && sent.media?.contentType).toBe('image/jpeg');
    expect(sent.kind === 'freeform' && sent.body).toContain('offer!');
  });

  it('refuses a picture that is not this organisation\'s', async () => {
    const made = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'x', body: 'Hi', senderIdentityId: senderId, explicitContactIds: contactIds.slice(0, 1), mediaAssetId: '00000000-0000-4000-8000-000000000000' });
    expect(made.status).toBe(404);
  });

  it('is unchanged for a text-only campaign', async () => {
    const created = await create(contactIds.slice(0, 2));
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());
    const rows = await db.execute(sql`SELECT content_type AS "contentType", media_id AS "mediaId" FROM message WHERE campaign_id = ${created.body.data.id}`) as unknown as Array<{ contentType: string; mediaId: string | null }>;
    expect(rows.every((r) => r.contentType === 'text' && r.mediaId === null)).toBe(true);
  });

  it.skipIf(!hasFfmpeg)('turns a GIF into a looping clip and sends that as a video with GIF playback', async () => {
    const stored = (await upload(await pic('gif'), 'welcome.gif')).body.data;
    expect(stored).toMatchObject({ contentType: 'image/gif', gif: true });
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'gif', body: 'Welcome!', senderIdentityId: senderId, explicitContactIds: contactIds.slice(0, 1), mediaAssetId: stored.id });
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(gatewayCtx());
    const row = (await db.execute(sql`
      SELECT m.id, m.content_type AS "contentType", ma.content_type AS "mediaType", ma.gif_playback AS "gif", ma.source_asset_id AS "source"
      FROM message m JOIN media_asset ma ON ma.id = m.media_id WHERE m.campaign_id = ${created.body.data.id}`) as unknown as Array<{ id: string; contentType: string; mediaType: string; gif: boolean; source: string }>)[0]!;
    expect(row).toMatchObject({ contentType: 'video', mediaType: 'video/mp4', gif: true, source: stored.id });
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+919000000001' });
    await handleSend({ ...gatewayCtx(), provider, storage: media.storage, sleep: async () => {} }, row.id);
    const sent = provider.sent[0]!.content;
    expect(sent.kind === 'freeform' && sent.media?.gifPlayback).toBe(true);
  });

  it('shows a safe preview of a picture that belongs to no message', async () => {
    const stored = (await upload(await pic('png'))).body.data;
    const thumb = await request(app).get(`/api/v1/media/${stored.id}/thumb`).set(...auth());
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
  });
});
