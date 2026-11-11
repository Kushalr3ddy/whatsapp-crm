import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey, type AntiBanPolicy } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { storeInboundMessage } from '@crm/core';
import {
  applyConnectionEvent, applyStatusEvent, handleUnlinkRequest, markAllSessionsClosed, restoreSessions, sweepPendingWork, type WorkContext
} from '../../apps/gateway/src/work.js';

/**
 * Failure modes: what happens to work in flight when something goes wrong, and what a person can do that goes wrong.
 *
 * Every test here states what the person expects, not what the code happens to do: nobody is messaged twice, nobody in a campaign is
 * silently lost, and after the number comes back the work carries on. A test that fails here is a finding, not a broken test.
 * Scenario ids: FM-n is a failure (network, process, database), UM-n is something a user does.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const dialect = new PgDialect();
const SENDER_PHONE = '+919000000001';

let db: Database;
let media: TempStorage;
let app: ReturnType<typeof buildApp>;
let orgId: string;
let senderId: string;
let key: string;
let people: Array<{ id: string; phone: string }>;

/** Lets every campaign message wait at once and never delays a send, so a test is about failures, not pacing. */
const instant: AntiBanPolicy = {
  beforeSend: () => Promise.resolve({ action: 'send' as const }),
  campaignBatch: ({ waiting }) => Math.max(0, 100 - waiting)
};

/** Lets at most `n` campaign messages wait at once; 0 stops new ones being queued. */
const batchOf = (n: number): AntiBanPolicy => ({
  beforeSend: () => Promise.resolve({ action: 'send' as const }),
  campaignBatch: ({ waiting }) => Math.max(0, n - waiting)
});

/** A database that refuses every statement while `state.down`, as it does during a restart, or as a killed process writes nothing. */
function flakyDb(state: { down: boolean; refused: number }): Database {
  const refuse = (what: string): Promise<never> => {
    state.refused += 1;
    return Promise.reject(new Error(`database unavailable: ${what}`));
  };
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return (q: SQL) => state.down ? refuse(dialect.sqlToQuery(q).sql.slice(0, 40)) : target.execute(q);
      }
      // The gateway pins every statement to an org inside a transaction (`tenantDatabase`), so that door must close too.
      if (prop === 'transaction') {
        return (work: Parameters<Database['transaction']>[0]) => state.down ? refuse('transaction') : target.transaction(work);
      }
      return Reflect.get(target, prop, receiver) as unknown;
    }
  }) as Database;
}

/** Sends exactly two campaign messages and queues no more, so a test can break things with the campaign part-way. */
async function sendTwo(provider: FakeChannelProvider): Promise<void> {
  await sweepPendingWork(gateway(provider, { antiBan: batchOf(2) }));   // queues two
  await sweepPendingWork(gateway(provider, { antiBan: batchOf(0) }));   // sends them, queues nothing more
  expect(provider.sent.length).toBe(2);
}

const gateway = (provider: FakeChannelProvider, over: Partial<WorkContext> = {}): WorkContext => ({
  db, provider, logger, kms, antiBan: instant,
  decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
  ...over
});

/** Runs the gateway's sweep a few times, the way the running gateway does every few seconds. */
async function drain(ctx: WorkContext, rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await sweepPendingWork(ctx);
}

/** How many times each phone was sent something. */
function sendsPerPhone(provider: FakeChannelProvider): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of provider.sent) m.set(s.to.phoneE164, (m.get(s.to.phoneE164) ?? 0) + 1);
  return m;
}

const auth = () => ['Authorization', `Bearer ${key}`] as const;

async function newCampaign(ids = people.map((p) => p.id), body = 'hello there'): Promise<string> {
  const r = await request(app).post('/api/v1/campaigns').set(...auth())
    .send({ name: 'outreach', body, senderIdentityId: senderId, explicitContactIds: ids });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
}

async function start(id: string) {
  return request(app).post(`/api/v1/campaigns/${id}/start`).set(...auth()).send({});
}

async function campaignStatus(id: string): Promise<{ status: string; pause_reason: string | null }> {
  return (await db.execute(sql`SELECT status, pause_reason FROM campaign WHERE id = ${id}`) as unknown as Array<{ status: string; pause_reason: string | null }>)[0]!;
}

/** Recipients by status, e.g. { pending: 2, queued: 3 }. */
async function recipients(id: string): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM campaign_recipient WHERE campaign_id = ${id} GROUP BY status`) as unknown as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

async function messages(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM message WHERE org_id = ${orgId} AND direction = 'outbound' GROUP BY status`) as unknown as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** The connection event the real adapter emits, pushed through the gateway's handler. */
const event = (ctx: WorkContext, state: 'open' | 'closed' | 'logged_out', extra: { reason?: string | null; code?: number; detail?: string } = {}) =>
  applyConnectionEvent(ctx, {
    senderId, state, at: new Date(),
    reason: (extra.reason ?? (state === 'open' ? null : state === 'logged_out' ? 'logged_out' : 'connection_closed')) as never,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {})
  });

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  media = tempStorage('crm-failure-modes');
  app = buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM org WHERE slug = 'failure-modes'`);
  await db.$client.end();
  media.cleanup();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`INSERT INTO org(name,slug) VALUES ('f','failure-modes') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`INSERT INTO antiban_setting (org_id, quiet_hours_enabled) VALUES (${orgId}, false)`);
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 'main', ${SENDER_PHONE}, 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
  people = [];
  for (let i = 0; i < 6; i++) {
    const phone = `+9198765100${String(i).padStart(2, '0')}`;
    const id = (await db.execute(sql`
      INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${`Person ${String(i)}`}, 'test') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary) VALUES (${orgId}, ${id}, 'phone', ${phone}, true)`);
    people.push({ id, phone });
  }
  key = (await issueApiKey(db, { orgId, name: 'fm', scopes: ['messages:send', 'conversations:read', 'contacts:write', 'senders:write', 'senders:read'] })).secret;
});

/** A connected fake number. */
async function connected(): Promise<FakeChannelProvider> {
  const p = new FakeChannelProvider();
  await p.connect({ id: senderId, phoneE164: SENDER_PHONE });
  return p;
}

/** Everyone in the campaign got exactly one message. */
function expectEveryoneOnce(provider: FakeChannelProvider, phones = people.map((p) => p.phone)): void {
  const per = sendsPerPhone(provider);
  expect(Object.fromEntries([...per].filter(([, n]) => n !== 1)), 'someone was messaged more than once').toEqual({});
  expect(phones.filter((p) => !per.has(p)), 'someone in the campaign was never messaged').toEqual([]);
}

describe('failures while a campaign is sending', () => {
  it('FM-1 the connection drops and comes back: everyone still gets the message once', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    await start(await newCampaign());
    await sweepPendingWork(ctx);                       // queues and sends some
    await provider.disconnect(senderId);
    await event(ctx, 'closed');
    await drain(ctx, 2);                               // the number is down: nothing should be lost meanwhile
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    await drain(ctx);
    expectEveryoneOnce(provider);
  });

  it('[R-018] FM-2 the connection drops in the middle of one send: that person is not lost', async () => {
    const provider = await connected();
    const realSend = provider.send.bind(provider);
    let calls = 0;
    // The third send finds the socket gone, the way a real drop lands between the lane's health check and the send.
    provider.send = async (s, to, c) => {
      calls += 1;
      if (calls === 3) { await provider.disconnect(senderId); }
      return realSend(s, to, c);
    };
    const ctx = gateway(provider);
    await start(await newCampaign());
    await drain(ctx, 2);
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    await drain(ctx);
    const failed = await db.execute(sql`
      SELECT error_code AS code, error_detail AS detail FROM message WHERE org_id = ${orgId} AND status = 'failed'`);
    expect(failed, 'messages marked failed by the drop').toEqual([]);
    expectEveryoneOnce(provider);
  });

  it('[R-019] FM-3 the gateway is killed mid-campaign and started again: it carries on, nobody gets it twice, and the one in flight is reported', async () => {
    const before = await connected();
    const id = await newCampaign();
    await start(id);
    await sweepPendingWork(gateway(before, { antiBan: batchOf(0) }));     // nothing queued yet: a quiet first sweep
    await sweepPendingWork(gateway(before, { antiBan: batchOf(100) }));   // queues the audience
    const state = { down: false, refused: 0 };
    const realSend = before.send.bind(before);
    let n = 0;
    // After two sends the process dies in the middle of the third: nobody knows whether WhatsApp got it, and nothing more is written.
    before.send = async (s, to, c) => { if (++n > 2) { state.down = true; throw new Error('process killed'); } return realSend(s, to, c); };
    await sweepPendingWork(gateway(before, { db: flakyDb(state) })).catch(() => undefined);
    expect(before.sent.length).toBe(2);
    expect(state.refused, 'the kill never reached the gateway').toBeGreaterThan(0);

    const after = await connected();
    (after.sent as unknown[]).push(...before.sent);  // one record of everything that reached WhatsApp
    await drain(gateway(after));
    // The one in flight is not sent again. Once it has been in flight too long, it is reported for a person to check.
    await db.execute(sql`UPDATE message SET send_started_at = now() - interval '11 minutes' WHERE org_id = ${orgId} AND send_started_at IS NOT NULL AND status = 'queued'`);
    await drain(gateway(after), 1);
    const rows = await db.execute(sql`
      SELECT m.status, m.error_code AS code FROM campaign_recipient cr JOIN message m ON m.id = cr.message_id WHERE cr.campaign_id = ${id}`) as unknown as Array<{ status: string; code: string | null }>;
    expect(rows.filter((r) => r.status === 'sent').length).toBe(people.length - 1);
    expect(rows.filter((r) => r.code === 'send_unconfirmed').length).toBe(1);
    const per = sendsPerPhone(after);
    expect([...per.values()].every((v) => v === 1), 'someone was messaged twice').toBe(true);
    expect(per.size).toBe(people.length - 1);
  });

  it('[R-019] FM-4 the database goes away right after WhatsApp accepted a message: it is not sent again', async () => {
    const provider = await connected();
    const state = { down: false, refused: 0 };
    const flaky = flakyDb(state);
    const realSend = provider.send.bind(provider);
    let calls = 0;
    provider.send = async (s, to, c) => {
      const r = await realSend(s, to, c);
      if (++calls === 1) state.down = true;            // WhatsApp has it; the database goes before we can write that down
      return r;
    };
    const id = await newCampaign(people.slice(0, 2).map((p) => p.id));
    await start(id);
    await sweepPendingWork(gateway(provider));         // queues the two, sends nothing yet
    await sweepPendingWork(gateway(provider, { db: flaky })).catch(() => undefined);
    expect(state.refused, 'the outage never reached the gateway').toBeGreaterThan(0);
    state.down = false;                                // the database is back
    await drain(gateway(provider));
    expectEveryoneOnce(provider, people.slice(0, 2).map((p) => p.phone));
  }, 20_000);

  it('FM-5 two people press Start at the same moment: it starts once, with one copy of the audience', async () => {
    const id = await newCampaign();
    const [a, b] = await Promise.all([start(id), start(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const total = Object.values(await recipients(id)).reduce((x, y) => x + y, 0);
    expect(total).toBe(people.length);
  });

  it('FM-6 WhatsApp removes the device on the phone mid-campaign: it pauses, and after linking again and Resume it finishes once each', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    await sendTwo(provider);
    await provider.logout(senderId);
    await event(ctx, 'logged_out', { code: 401, detail: 'device_removed' });
    expect(await campaignStatus(id)).toMatchObject({ status: 'paused', pause_reason: 'unlinked' });

    // The person links the same number again from the Numbers page.
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    // The chats from before the unlink are still on this number.
    const convs = (await db.execute(sql`SELECT count(*)::int AS n FROM conversation WHERE sender_identity_id = ${senderId}`) as unknown as Array<{ n: number }>)[0]!.n;
    expect(convs).toBeGreaterThan(0);
    expect((await start(id)).status).toBe(200);
    await drain(ctx);
    expectEveryoneOnce(provider);
  });

  it('FM-7 WhatsApp logs the number out with no reason (possible ban) mid-campaign: the campaign stops and says why', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    await provider.logout(senderId);
    await event(ctx, 'logged_out', { code: 401 });
    expect(await campaignStatus(id)).toMatchObject({ status: 'paused', pause_reason: 'ban_suspected' });
    await drain(ctx);
    expect(provider.sent.length).toBe(0);
  });
});

describe('things a person does', () => {
  it('UM-1 starts a campaign on a number that is not linked yet: once it is linked, everyone gets it once', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'linking' WHERE id = ${senderId}`);
    await db.execute(sql`UPDATE channel_session SET connection_state = 'closed' WHERE sender_identity_id = ${senderId}`);
    const provider = new FakeChannelProvider();
    const ctx = gateway(provider);
    const id = await newCampaign();
    const started = await start(id);
    // Either refused with a reason, or accepted and carried out once the number is linked. Never accepted and then lost.
    if (started.status !== 200) {
      expect(started.status).toBeGreaterThanOrEqual(400);
      expect(started.status).toBeLessThan(500);
      return;
    }
    await drain(ctx, 2);
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    await drain(ctx);
    expectEveryoneOnce(provider);
  });

  it('[R-020] UM-2 presses Cancel: nothing more is sent after it', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    // The gateway has queued the campaign's messages but not sent them yet (the number was briefly down).
    await provider.disconnect(senderId);
    await sweepPendingWork(ctx);
    expect((await messages()).queued ?? 0).toBeGreaterThan(0);
    const cancelled = await request(app).post(`/api/v1/campaigns/${id}/cancel`).set(...auth()).send({});
    expect(cancelled.status).toBeLessThan(300);
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await drain(ctx);
    expect(provider.sent.length, 'messages went out after Cancel').toBe(0);
  });

  it('UM-3 unlinks the number in the app while a campaign runs, links it again: the campaign finishes, once each', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    const session = (await db.execute(sql`
      UPDATE channel_session SET unlink_requested_at = now() WHERE sender_identity_id = ${senderId} RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await handleUnlinkRequest(ctx, session);
    await event(ctx, 'logged_out');
    await drain(ctx, 2);
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    const s = await campaignStatus(id);
    if (s.status === 'paused') expect((await start(id)).status).toBe(200);
    await drain(ctx);
    expectEveryoneOnce(provider);
  });

  it('UM-4 removes a number and adds the same number again: it is accepted, or refused with a reason (not a crash)', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'removed' WHERE id = ${senderId}`);
    const again = await request(app).post('/api/v1/senders').set(...auth())
      .send({ label: 'main again', provider: 'fake', phoneE164: SENDER_PHONE });
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(500);
  });

  it('[R-021] UM-5 a campaign whose message is only spaces is refused', async () => {
    const r = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'blank', body: '   \n  ', senderIdentityId: senderId, explicitContactIds: people.map((p) => p.id) });
    expect(r.status).toBe(422);
  });

  it('UM-6 marks someone do-not-contact after the campaign started: they are not messaged', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    const r = await request(app).put(`/api/v1/contacts/${people[0]!.id}/do-not-contact`).set(...auth()).send({ value: true });
    expect(r.status).toBeLessThan(300);
    await drain(ctx);
    expect(sendsPerPhone(provider).get(people[0]!.phone) ?? 0).toBe(0);
  });

  it('UM-8 deletes the tag a draft campaign targets, then presses Start: a clear refusal, not a crash', async () => {
    const tagId = (await db.execute(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'leads') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    for (const p of people) await db.execute(sql`INSERT INTO contact_tag (org_id, contact_id, tag_id) VALUES (${orgId}, ${p.id}, ${tagId})`);
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'tagged', body: 'hi', senderIdentityId: senderId, fromTagId: tagId });
    expect(created.status).toBe(201);
    await db.execute(sql`DELETE FROM tag WHERE id = ${tagId}`);
    const started = await start(created.body.data.id as string);
    expect(started.status, JSON.stringify(started.body)).toBeLessThan(500);
  });

  it('UM-9 pauses, edits the wording, resumes: the rest get the new wording, nobody gets both', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign(undefined, 'first wording');
    await start(id);
    await sendTwo(provider);
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth()).send({});
    const edited = await request(app).patch(`/api/v1/campaigns/${id}`).set(...auth()).send({ body: 'second wording' });
    expect(edited.status).toBeLessThan(300);
    expect((await start(id)).status).toBe(200);
    await drain(ctx);
    expectEveryoneOnce(provider);
    const bodies = provider.sent.map((m) => (m.content as { body?: string }).body);
    expect(bodies.slice(2).every((b) => b === 'second wording'), 'the rest did not get the new wording').toBe(true);
  });
});

describe('more failures around the number and the gateway', () => {
  it('FM-8 a reply typed while the number is offline waits, then goes once when it is back', async () => {
    const provider = new FakeChannelProvider();
    const ctx = gateway(provider);
    const r = await request(app).post('/api/v1/messages').set(...auth()).send({ to: people[0]!.phone, body: 'reply', senderId });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    await drain(ctx, 2);
    const held = (await db.execute(sql`SELECT status, hold_reason AS hold FROM message WHERE org_id = ${orgId}`) as unknown as Array<{ status: string; hold: string | null }>)[0]!;
    expect(held).toMatchObject({ status: 'queued', hold: 'sender_not_connected' });
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await event(ctx, 'open');
    await drain(ctx);
    expectEveryoneOnce(provider, [people[0]!.phone]);
  });

  it('FM-9 WhatsApp delivering the same incoming message twice stores it once', async () => {
    const input = {
      orgId, senderIdentityId: senderId, providerMessageId: 'wamid.dup-1', fromPhoneE164: people[0]!.phone,
      fromProviderAddress: `${people[0]!.phone.replace('+', '')}@s.whatsapp.net`, body: 'hi', contentType: 'text', receivedAt: new Date()
    };
    await storeInboundMessage(db, kms, input);
    await storeInboundMessage(db, kms, input);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM message WHERE org_id = ${orgId} AND direction = 'inbound'`) as unknown as Array<{ n: number }>)[0]!.n;
    expect(n).toBe(1);
  });

  it('FM-10 a delivery tick for a message we never sent is ignored, not a crash', async () => {
    const provider = await connected();
    await expect(applyStatusEvent(gateway(provider), { senderId, providerMessageId: 'not-ours', status: 'delivered', errorCode: null, at: new Date() }))
      .resolves.toBeUndefined();
  });

  it('FM-11 WhatsApp reporting a sent message as failed marks it failed, and the rest carry on', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    await start(await newCampaign());
    await drain(ctx);
    const first = provider.sent[0]!;
    await applyStatusEvent(ctx, { senderId, providerMessageId: first.providerMessageId, status: 'failed', errorCode: null, at: new Date() });
    const row = (await db.execute(sql`SELECT status, error_code AS code FROM message WHERE provider_message_id = ${first.providerMessageId}`) as unknown as Array<{ status: string; code: string }>)[0]!;
    expect(row).toMatchObject({ status: 'failed', code: 'delivery_error' });
    expect(provider.sent.length).toBe(people.length);
  });

  it('FM-12 a gateway restart marks numbers closed, reconnects the linked ones, and their queued work goes', async () => {
    const provider = new FakeChannelProvider();
    const ctx = gateway(provider);
    await start(await newCampaign());
    await sweepPendingWork(ctx);                       // queued, number not connected in this new process yet
    await markAllSessionsClosed(ctx);
    expect(await restoreSessions(ctx, ['fake'])).toBe(1);
    await event(ctx, 'open');
    await drain(ctx);
    expectEveryoneOnce(provider);
  });

  it('FM-13 an unlink asked for while the gateway was down still happens when it starts', async () => {
    const provider = await connected();
    await db.execute(sql`UPDATE channel_session SET unlink_requested_at = now() WHERE sender_identity_id = ${senderId}`);
    await sweepPendingWork(gateway(provider));
    const row = (await db.execute(sql`SELECT unlink_requested_at AS at, connection_state AS state FROM channel_session WHERE sender_identity_id = ${senderId}`) as unknown as Array<{ at: string | null; state: string }>)[0]!;
    expect(row).toMatchObject({ at: null, state: 'closed' });
  });

  it('FM-14 banned mid-campaign (403): the campaign stops, says why, and nothing more is sent', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    await provider.disconnect(senderId);
    await event(ctx, 'closed', { reason: 'forbidden', code: 403 });
    expect(await campaignStatus(id)).toMatchObject({ status: 'paused', pause_reason: 'ban_suspected' });
    await provider.connect({ id: senderId, phoneE164: SENDER_PHONE });
    await drain(ctx);
    expect(provider.sent.length).toBe(0);
  });

  it.fails('[R-025] FM-15 opened somewhere else (440): the number says so, instead of quietly looking offline', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    await provider.disconnect(senderId);
    await event(ctx, 'closed', { reason: 'connection_replaced', code: 440, detail: 'replaced' });
    const events = await db.execute(sql`SELECT kind FROM sender_health_event WHERE sender_identity_id = ${senderId}`) as unknown as Array<{ kind: string }>;
    expect(events.length, 'no health event: the Numbers page only shows "not connected"').toBeGreaterThan(0);
  });

  it('[R-026] FM-16 a linked number that is down and not coming back by itself is tried again by the gateway', async () => {
    // The WhatsApp adapter gives up after five failed reconnects (about 30 s without internet). After that only a gateway restart
    // brought the number back. The sweep must notice a linked number that has been down a while and try again, slowly.
    const provider = new FakeChannelProvider();
    const calls: string[] = [];
    const connect = provider.connect.bind(provider);
    provider.connect = async (s) => { calls.push(s.id); await connect(s); };
    const ctx = gateway(provider);
    await db.execute(sql`
      UPDATE channel_session SET connection_state = 'closed', disconnect_reason = 'connection_closed', updated_at = now() - interval '10 minutes'
      WHERE sender_identity_id = ${senderId}`);
    await drain(ctx, 2);
    expect(calls, 'the gateway never tried to bring the number back').toContain(senderId);
  });

  it('FM-17 a campaign finishes: once everyone has been sent to it reads completed, not running forever', async () => {
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    await start(id);
    await drain(ctx, 8);
    expect((await campaignStatus(id)).status).toBe('completed');
  });
});

describe('more things a person does', () => {
  it('UM-10 a campaign where everyone is do-not-contact finishes with nobody messaged, instead of hanging', async () => {
    for (const p of people) await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${p.id}`);
    const provider = await connected();
    const ctx = gateway(provider);
    const id = await newCampaign();
    const started = await start(id);
    expect(started.status).toBeLessThan(500);
    await drain(ctx);
    expect(provider.sent.length).toBe(0);
    expect((await campaignStatus(id)).status).not.toBe('running');
  });

  it('UM-11 a campaign over a tag with nobody in it is refused or finishes at once, never left running', async () => {
    const tagId = (await db.execute(sql`INSERT INTO tag (org_id, name) VALUES (${orgId}, 'empty') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const created = await request(app).post('/api/v1/campaigns').set(...auth()).send({ name: 'nobody', body: 'hi', senderIdentityId: senderId, fromTagId: tagId });
    if (created.status !== 201) { expect(created.status).toBeLessThan(500); return; }
    const started = await start(created.body.data.id as string);
    expect(started.status).toBeLessThan(500);
    const provider = await connected();
    await drain(gateway(provider));
    expect((await campaignStatus(created.body.data.id as string)).status).not.toBe('running');
  });

  it('UM-12 presses Resume on a cancelled campaign: refused, and nothing is sent', async () => {
    const provider = await connected();
    const id = await newCampaign();
    await start(id);
    await request(app).post(`/api/v1/campaigns/${id}/cancel`).set(...auth()).send({});
    expect((await start(id)).status).toBe(409);
    await drain(gateway(provider));
    expect(provider.sent.length).toBe(0);
  });

  it('[R-022] UM-13 presses Pause on a draft: a clear answer, not a crash', async () => {
    const id = await newCampaign();
    const r = await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth()).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NOT_RUNNING');
    expect((await campaignStatus(id)).status).toBe('draft');
  });

  it('[R-022] UM-24 a campaign left paused before it ever started (older data) still reaches its audience on Resume', async () => {
    const provider = await connected();
    const id = await newCampaign();
    await db.execute(sql`UPDATE campaign SET status = 'paused' WHERE id = ${id}`);
    expect((await start(id)).status).toBe(200);
    await drain(gateway(provider));
    expectEveryoneOnce(provider);
  });

  it('[R-022] UM-23 pauses a draft by mistake, then presses Resume: the audience still gets the message', async () => {
    const provider = await connected();
    const id = await newCampaign();
    await request(app).post(`/api/v1/campaigns/${id}/pause`).set(...auth()).send({});
    expect((await start(id)).status).toBe(200);
    await drain(gateway(provider));
    expectEveryoneOnce(provider);
  });

  it('UM-14 sends a message to a number that is too short: refused, nothing queued', async () => {
    const r = await request(app).post('/api/v1/messages').set(...auth()).send({ to: '12345', body: 'hi', senderId });
    expect(r.status).toBe(422);
    expect(Object.keys(await messages())).toEqual([]);
  });

  it('[R-023] UM-15 sends a message that is only spaces from the inbox: refused', async () => {
    const r = await request(app).post('/api/v1/messages').set(...auth()).send({ to: people[0]!.phone, body: '   ', senderId });
    expect(r.status).toBe(422);
  });

  it('UM-16 sends a message longer than the limit: refused with a reason, not cut off silently', async () => {
    const r = await request(app).post('/api/v1/messages').set(...auth()).send({ to: people[0]!.phone, body: 'x'.repeat(70_000), senderId });
    expect(r.status).toBe(422);
  });

  it('UM-17 presses Unlink on a number that was never linked: a clear 404', async () => {
    await db.execute(sql`DELETE FROM channel_session WHERE sender_identity_id = ${senderId}`);
    const r = await request(app).post(`/api/v1/senders/${senderId}/unlink`).set(...auth()).send({});
    expect(r.status).toBe(404);
  });

  it('UM-18 presses Link on a number that does not exist (or belongs to another org): 404', async () => {
    const r = await request(app).post('/api/v1/senders/00000000-0000-4000-8000-000000000000/link').set(...auth()).send({ mode: 'qr' });
    expect(r.status).toBe(404);
  });

  it('UM-19 asks for a pairing code without typing the phone: told what is missing', async () => {
    const r = await request(app).post(`/api/v1/senders/${senderId}/link`).set(...auth()).send({ mode: 'pairing_code' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('PHONE_REQUIRED');
  });

  it('UM-20 presses Link three times in a row: one pending link, not three', async () => {
    for (let i = 0; i < 3; i++) await request(app).post(`/api/v1/senders/${senderId}/link`).set(...auth()).send({ mode: 'qr' });
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM channel_session WHERE sender_identity_id = ${senderId}`) as unknown as Array<{ n: number }>)[0]!.n;
    expect(n).toBe(1);
  });

  it('[R-024] UM-21 starts a campaign on a number that was removed: refused, not queued into nowhere', async () => {
    const id = await newCampaign();
    await db.execute(sql`UPDATE sender_identity SET status = 'removed' WHERE id = ${senderId}`);
    const r = await start(id);
    expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
  });

  it('UM-22 the same contact picked twice in one campaign gets one message', async () => {
    const provider = await connected();
    const id = await newCampaign([people[0]!.id, people[0]!.id, people[1]!.id]);
    await start(id);
    await drain(gateway(provider));
    expectEveryoneOnce(provider, [people[0]!.phone, people[1]!.phone]);
  });
});
