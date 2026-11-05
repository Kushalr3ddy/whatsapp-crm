import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { campaignEta, issueApiKey, typingMs } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, kickLane } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S3: the schedule is exact. Gaps are drawn once, when the campaign launches, and stored on each recipient; the lane uses the stored
 * gap; and the ETA is arithmetic on those same gaps, so it can be checked to the second.
 */
const API_KEY = randomBytes(32).toString('hex');
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let lane: Lane;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let key: string;

beforeAll(() => { media = tempStorage('antiban-schedule'); });
afterAll(async () => { media.cleanup(); await lane.close(); });
beforeEach(async () => {
  // A fresh org and number for each test, with the API key for it.
  if (lane !== undefined) await lane.close().catch(() => undefined);
  lane = await makeLane();
  const tenantRole = await resolveTenantRole(lane.db, await inspectDatabaseSecurity(lane.db));
  app = buildApp({ config, logger, db: lane.db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
  key = (await issueApiKey(lane.db, { orgId: lane.orgId, name: 'schedule', scopes: ['messages:send', 'conversations:read'] })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;

/** `n` contacts with a phone number each; returns their ids. */
async function people(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await lane.contact()).contactId);
  return ids;
}

async function launch(contactIds: string[], body = 'hello there'): Promise<string> {
  const created = await request(app).post('/api/v1/campaigns').set(...auth())
    .send({ name: 'outreach', body, senderIdentityId: lane.senderId, explicitContactIds: contactIds });
  expect(created.status).toBe(201);
  const started = await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
  expect(started.status).toBe(200);
  return created.body.data.id as string;
}

const recipientGaps = async (campaignId: string): Promise<number[]> => ((await lane.db.execute(sql`
  SELECT planned_gap_ms AS gap FROM campaign_recipient WHERE campaign_id = ${campaignId} ORDER BY id`)
) as unknown as Array<{ gap: number | null }>).map((r) => r.gap as number);

describe('AC-3.1 gaps are drawn once, at launch, and stored', () => {
  it('AC-3.1 starting a campaign gives every recipient a gap between 1 and 50 s', async () => {
    const id = await launch(await people(12));
    const gaps = await recipientGaps(id);
    expect(gaps).toHaveLength(12);
    for (const g of gaps) { expect(g).toBeGreaterThanOrEqual(1_000); expect(g).toBeLessThanOrEqual(50_000); }
    expect(new Set(gaps).size).toBeGreaterThan(6);                       // drawn per recipient, not one gap for all
  });

  it('AC-3.1 pausing and resuming does not draw them again', async () => {
    const id = await launch(await people(8));
    const before = await recipientGaps(id);
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth());
    await request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth());
    expect(await recipientGaps(id)).toEqual(before);
  });

  it('AC-3.1 the lane uses the stored gap: the message carries it and the sends are exactly that far apart', async () => {
    const id = await launch(await people(6));
    const stored = new Map<string, number>(((await lane.db.execute(sql`
      SELECT contact_id AS c, planned_gap_ms AS g FROM campaign_recipient WHERE campaign_id = ${id}`)) as unknown as Array<{ c: string; g: number }>)
      .map((r) => [r.c, r.g]));

    await dispatchCampaigns(lane.ctx());       // every org's campaigns are topped up; this test reads only its own
    const msgs = (await lane.db.execute(sql`
      SELECT m.id, m.planned_gap_ms AS gap, v.contact_id AS "contactId"
      FROM message m JOIN conversation v ON v.id = m.conversation_id WHERE m.campaign_id = ${id} ORDER BY m.created_at, m.id`
    )) as unknown as Array<{ id: string; gap: number; contactId: string }>;
    for (const m of msgs) expect(m.gap).toBe(stored.get(m.contactId));

    await lane.drain();
    const at = lane.provider.sent.map((s) => s.at.getTime());
    expect(at).toHaveLength(6);
    // Message i waits the longer of its stored gap and its typing ("hello there" types for the 2 s floor).
    const diffs = at.slice(1).map((v, i) => v - at[i]!);
    expect(diffs).toEqual(msgs.slice(1).map((m) => Math.max(m.gap, typingMs('hello there'.length))));
  });
});

describe('AC-3.2 GET /campaigns/:id/eta', () => {
  it('AC-3.2 returns finishAt, goNow, afterReset, resetAt, basis and delayedBy', async () => {
    const id = await launch(await people(10));
    const r = await request(app).get(`/api/v1/campaigns/${id}/eta`).set(...auth());
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ goNow: 10, afterReset: 0, resetAt: null, basis: 'time_only', delayedBy: [] });
    expect(new Date(r.body.data.finishAt as string).getTime()).toBeGreaterThan(Date.now());
    const gaps = await recipientGaps(id);
    const sum = gaps.slice(1).reduce((n, g) => n + Math.max(g, 2_000), 2_000);
    // Quiet hours are off for this org, so the finish is exactly the sum of the gaps from now.
    expect(new Date(r.body.data.finishAt as string).getTime() - Date.now()).toBeGreaterThan(sum - 5_000);
    expect(new Date(r.body.data.finishAt as string).getTime() - Date.now()).toBeLessThan(sum + 5_000);
  });

  it('AC-3.2 answers 404 for a campaign that is not there, and refuses a key without the read scope', async () => {
    const missing = await request(app).get('/api/v1/campaigns/00000000-0000-4000-8000-000000000000/eta').set(...auth());
    expect(missing.status).toBe(404);
    const blind = (await issueApiKey(lane.db, { orgId: lane.orgId, name: 'no read', scopes: ['messages:send'] })).secret;
    const denied = await request(app).get('/api/v1/campaigns/00000000-0000-4000-8000-000000000000/eta').set('Authorization', `Bearer ${blind}`);
    expect(denied.status).toBe(403);
  });

  it('AC-3.2 never shows another org\'s campaign', async () => {
    const id = await launch(await people(3));
    const other = await makeLane();
    try {
      const otherKey = (await issueApiKey(other.db, { orgId: other.orgId, name: 'other', scopes: ['conversations:read'] })).secret;
      const r = await request(app).get(`/api/v1/campaigns/${id}/eta`).set('Authorization', `Bearer ${otherKey}`);
      expect(r.status).toBe(404);
    } finally { await other.close(); }
  });
});

describe('AC-3.3 the quota splits the campaign', () => {
  const setCap = async (total: number, used: number, cycleEnd: Date): Promise<void> => {
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, capping_status, capping_total_quota, capping_used_quota, capping_cycle_end, capping_updated_at)
      VALUES (${lane.senderId}, 'NONE', ${total}, ${used}, ${cycleEnd.toISOString()}, now())
      ON CONFLICT (sender_identity_id) DO UPDATE SET capping_status = 'NONE', capping_total_quota = ${total}, capping_used_quota = ${used},
        capping_cycle_end = ${cycleEnd.toISOString()}, capping_updated_at = now()`);
  };

  it('AC-3.3 with a known quota, new chats beyond total - used are counted after the cycle end, with basis quota', async () => {
    const cycleEnd = new Date(Date.now() + 5 * 3_600_000);
    await setCap(10, 7, cycleEnd);
    const id = await launch(await people(8));
    const r = await request(app).get(`/api/v1/campaigns/${id}/eta`).set(...auth());
    expect(r.body.data).toMatchObject({ basis: 'quota', goNow: 3, afterReset: 5 });
    expect(new Date(r.body.data.resetAt as string).getTime()).toBe(cycleEnd.getTime());
    expect(new Date(r.body.data.finishAt as string).getTime()).toBeGreaterThan(cycleEnd.getTime());
    expect(r.body.data.delayedBy).toContainEqual({ reason: 'new_chat_cap', seconds: expect.any(Number) });
  });

  it('AC-3.3 with no quota known the basis is time_only and everything goes now', async () => {
    const id = await launch(await people(8));
    const r = await request(app).get(`/api/v1/campaigns/${id}/eta`).set(...auth());
    expect(r.body.data).toMatchObject({ basis: 'time_only', goNow: 8, afterReset: 0, resetAt: null });
  });

  it('AC-3.3 people who have written to the number are not new chats, so they do not use the quota', async () => {
    await setCap(10, 9, new Date(Date.now() + 5 * 3_600_000));
    const known: string[] = [];
    for (let i = 0; i < 3; i++) known.push((await lane.contact({ inbound: 'old' })).contactId);
    const id = await launch([...known, ...(await people(3))]);
    const r = await request(app).get(`/api/v1/campaigns/${id}/eta`).set(...auth());
    expect(r.body.data).toMatchObject({ goNow: 4, afterReset: 2 });
  });
});

describe('AC-3.4 500 recipients, no holds', () => {
  it('AC-3.4 the ETA equals the sum of the stored gaps (plus typing where it is longer), to the second', async () => {
    const campaignId = (await lane.one<{ id: string }>(sql`
      INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
      VALUES (${lane.orgId}, 'five hundred', 'running', 'Hi there', ${lane.senderId}, now()) RETURNING id`)).id;
    await lane.db.execute(sql`
      WITH c AS (
        INSERT INTO contact (org_id, display_name, source)
        SELECT ${lane.orgId}, 'P' || g, 'test' FROM generate_series(1, 500) g RETURNING id, display_name
      ), i AS (
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        SELECT ${lane.orgId}, id, 'phone', '+9197' || lpad(substr(display_name, 2), 8, '0'), true FROM c RETURNING contact_id
      )
      INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, planned_gap_ms)
      SELECT ${lane.orgId}, ${campaignId}, id, 1000 + (row_number() OVER ())::int * 97 % 49001 FROM c`);

    const gaps = await recipientGaps(campaignId);
    expect(gaps).toHaveLength(500);
    const now = new Date();
    const eta = (await campaignEta(lane.db, lane.orgId, campaignId, now))!;
    // The first message of a run has no gap, only its typing; every later one waits the longer of its gap and its typing.
    const typing = typingMs('Hi there'.length);
    const expected = gaps.slice(1).reduce((n, g) => n + Math.max(g, typing), typing);
    expect(eta.finishAt!.getTime() - now.getTime()).toBe(expected);
    expect(Math.round((eta.finishAt!.getTime() - now.getTime()) / 1000)).toBe(Math.round(expected / 1000));
    expect(eta).toMatchObject({ goNow: 500, afterReset: 0, resetAt: null, basis: 'time_only', delayedBy: [] });
  });
});

describe('AC-3.5 what moves the ETA is named', () => {
  it('AC-3.5 a reply waiting in the lane goes first and moves the finish; delayedBy says reply_priority and by how many seconds', async () => {
    const id = await launch(await people(5));
    const now = new Date();
    const plain = (await campaignEta(lane.db, lane.orgId, id, now))!;
    const asker = await lane.contact({ inbound: true });
    await lane.queue(asker.conversationId, 'a reply is waiting', { sentBy: 'agent', gapMs: 12_000 });
    const withReply = (await campaignEta(lane.db, lane.orgId, id, now))!;

    expect(withReply.finishAt!.getTime()).toBeGreaterThan(plain.finishAt!.getTime());
    const d = withReply.delayedBy.find((x) => x.reason === 'reply_priority');
    expect(d).toBeDefined();
    expect(d!.seconds).toBeGreaterThan(0);
  });

  it('AC-3.5 a timelock holds the new chats until it ends, and the ETA says timelock and for how long', async () => {
    const id = await launch(await people(4));
    const until = new Date(Date.now() + 2 * 3_600_000);
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, timelock_active, timelock_until) VALUES (${lane.senderId}, true, ${until.toISOString()})
      ON CONFLICT (sender_identity_id) DO UPDATE SET timelock_active = true, timelock_until = ${until.toISOString()}`);
    const now = new Date();
    const eta = (await campaignEta(lane.db, lane.orgId, id, now))!;
    expect(eta).toMatchObject({ goNow: 0, afterReset: 4 });
    expect(eta.resetAt!.getTime()).toBe(until.getTime());
    const d = eta.delayedBy.find((x) => x.reason === 'timelock')!;
    expect(Math.abs(d.seconds - 7200)).toBeLessThanOrEqual(2);
    // And the lane really does hold them until then.
    await dispatchCampaigns(lane.ctx());
    await kickLane(lane.ctx(), lane.senderId);
    expect(lane.provider.sent).toHaveLength(0);
  });
});
