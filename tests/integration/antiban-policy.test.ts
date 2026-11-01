import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { storeInboundMessage, CAMPAIGN_QUEUE_AHEAD, type AntiBanPolicy } from '@crm/core';
import {
  handleSend, dispatchCampaigns, kickLane, sweepPendingWork, restoreSessions, type WorkContext
} from '../../apps/gateway/src/work.js';

/**
 * The anti-ban policy seam in the send path, end to end (F6 S9): every message that leaves the gateway asks the policy, whoever
 * queued it; any policy fits (a fixed one here); it can wait, hold or let a message go; a campaign queues a small batch at a time.
 * The v2 policy itself is covered in `antiban-v2-*.test.ts`. And what the migration that removed the old engine does to the rows it
 * left behind.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const PHONE = '+919876511111';

let db: Database;
let orgId: string;
let senderId: string;
let conversationId: string;
let contactId: string;
let provider: FakeChannelProvider;
let slept: number[];

/** A gateway context whose sleep only records, so the gap between sends costs no real time. */
function ctx(over: Partial<WorkContext> = {}): WorkContext {
  return {
    db, provider, logger, kms, tenantRole: 'crm_app',
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); },
    ...over
  };
}

async function queue(body: string, sentBy: string, conversation = conversationId): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
    VALUES (${orgId}, ${conversation}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, ${sentBy})
    RETURNING id`);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  return ((await db.execute(query)) as unknown as T[])[0]!;
}

const statusOf = (id: string) => one<{ status: string; hold: string | null }>(
  sql`SELECT status, hold_reason AS hold FROM message WHERE id = ${id}`);

/** A policy that decides the same way every time, and counts how often it was asked. */
function fixed(decision: Awaited<ReturnType<AntiBanPolicy['beforeSend']>>): AntiBanPolicy & { readonly asked: number } {
  let asked = 0;
  return {
    get asked() { return asked; },
    beforeSend: () => { asked += 1; return Promise.resolve(decision); },
    campaignBatch: () => CAMPAIGN_QUEUE_AHEAD
  };
}

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });
afterEach(async () => { await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`); });

beforeEach(async () => {
  slept = [];
  orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'ab',${'ab-' + orgId.slice(0, 8)})`);
  // Quiet hours depend on the time of day the suite runs at; they have their own tests.
  await db.execute(sql`INSERT INTO antiban_setting (org_id, quiet_hours_enabled) VALUES (${orgId}, false)`);
  senderId = (await one<{ id: string }>(sql`
    INSERT INTO sender_identity(org_id,provider,label,phone_e164,status)
    VALUES (${orgId},'fake','ab','+919000000321','active') RETURNING id`)).id;
  const r = await storeInboundMessage(db, kms, {
    orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`,
    fromPhoneE164: PHONE, fromProviderAddress: '919876511111@s.whatsapp.net',
    body: 'hi', contentType: 'text', receivedAt: new Date()
  });
  conversationId = r.conversationId;
  contactId = (await one<{ id: string }>(sql`SELECT contact_id AS id FROM conversation WHERE id = ${conversationId}`)).id;
  provider = new FakeChannelProvider();
  await provider.connect({ id: senderId, phoneE164: '+919000000321' });
});

describe('every send goes through the policy', () => {
  it('AC-9.1 asks the policy about a reply, an AI reply and a campaign message alike, whoever queued them', async () => {
    const ids = [
      await queue('manual reply', 'agent'),
      await queue('the assistant answering', 'ai'),
      await queue('campaign opener', 'system'),
      await queue('and an api message', 'api')
    ];
    const asked: string[] = [];
    const policy: AntiBanPolicy = {
      beforeSend: (c) => { asked.push(c.message.id); return Promise.resolve({ action: 'send' }); },
      campaignBatch: () => 20
    };
    await kickLane(ctx({ antiBan: policy }), senderId);

    expect(provider.sent).toHaveLength(4);
    for (const id of ids) expect(asked).toContain(id);
    for (const id of ids) expect((await statusOf(id)).status).toBe('sent');
  });

  it('does not make a number wait for a gap another number already served', async () => {
    const other = (await one<{ id: string }>(sql`
      INSERT INTO sender_identity(org_id,provider,label,phone_e164,status)
      VALUES (${orgId},'fake','other','+919000000322','active') RETURNING id`)).id;
    await provider.connect({ id: other, phoneE164: '+919000000322' });
    const otherConv = (await one<{ id: string }>(sql`
      INSERT INTO conversation (org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${other}) RETURNING id`)).id;

    await handleSend(ctx(), await queue('from the first number', 'agent'));
    await handleSend(ctx(), await queue('from the second number', 'agent', otherConv));

    expect(provider.sent).toHaveLength(2);
    expect(slept.filter((ms) => ms > 20_000)).toEqual([]);      // no gap: only typing beats
  });

  it('AC-9.1 a fixed wait is honoured, once, before the message goes', async () => {
    const id = await queue('after a wait', 'agent');
    await handleSend(ctx({ antiBan: fixed({ action: 'wait', ms: 1234 }) }), id);
    expect(slept).toContain(1234);
    expect((await statusOf(id)).status).toBe('sent');
  });

  it('AC-9.1 leaves a held message queued with the reason, then sends it once the policy lets it', async () => {
    const id = await queue('held', 'agent');
    const hold = fixed({ action: 'hold', reason: 'quiet_hours', until: null });
    await handleSend(ctx({ antiBan: hold }), id);

    expect(provider.sent).toHaveLength(0);
    expect(await statusOf(id)).toEqual({ status: 'queued', hold: 'quiet_hours' });

    await handleSend(ctx({ antiBan: fixed({ action: 'send' }) }), id);
    expect(provider.sent).toHaveLength(1);
    expect(await statusOf(id)).toEqual({ status: 'sent', hold: null });
  });
});

describe('what the policy cannot relax', () => {
  it('AC-9.2 a do-not-contact contact is refused without the policy being asked', async () => {
    await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contactId}`);
    const id = await queue('to someone who asked us to stop', 'agent');
    const policy = fixed({ action: 'send' });
    await handleSend(ctx({ antiBan: policy }), id);

    expect(provider.sent).toHaveLength(0);
    expect(await one(sql`SELECT status, error_code AS code FROM message WHERE id = ${id}`))
      .toEqual({ status: 'failed', code: 'do_not_contact' });
    expect(policy.asked).toBe(0);
  });

  it('AC-9.2 a number that is not connected holds the message whatever the policy would say', async () => {
    const id = await queue('nobody home', 'agent');
    const policy = fixed({ action: 'send' });
    await handleSend(ctx({ antiBan: policy, provider: new FakeChannelProvider() }), id);

    expect(await statusOf(id)).toEqual({ status: 'queued', hold: 'sender_not_connected' });
    expect(policy.asked).toBe(0);
  });

  it('AC-1.4 shows "typing…" before each send when the typing simulation is on, and the policy still applies', async () => {
    await handleSend(ctx(), await queue('first', 'agent'));
    await handleSend(ctx({ typingSimulation: true }), await queue('second', 'agent'));

    expect(provider.typingCalls.map((c) => c.state)).toEqual(['composing', 'paused']);
    expect(provider.sent).toHaveLength(2);
    // The typing beat for a short text is the 2 s floor.
    expect(slept).toContain(2_000);
  });
});

describe('a campaign of 50 recipients', () => {
  it('AC-9.1 queues at most the policy batch at a time, and every send goes through the lane', async () => {
    const campaignId = (await one<{ id: string }>(sql`
      INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
      VALUES (${orgId}, 'fifty', 'running', 'hello {{name}}', ${senderId}, now()) RETURNING id`)).id;
    for (let i = 0; i < 50; i++) {
      const c = (await one<{ id: string }>(sql`
        INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${`Fifty ${String(i)}`}, 'test') RETURNING id`)).id;
      await db.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${orgId}, ${c}, 'phone', ${`+9198700${String(i).padStart(5, '0')}`}, true)`);
      await db.execute(sql`
        INSERT INTO campaign_recipient (org_id, campaign_id, contact_id) VALUES (${orgId}, ${campaignId}, ${c})`);
    }
    const waiting = async () => (await one<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM message WHERE org_id = ${orgId} AND status = 'queued'`)).n;
    const policy = { ...fixed({ action: 'send' }), campaignBatch: ({ waiting: w }: { waiting: number }) => Math.max(0, CAMPAIGN_QUEUE_AHEAD - w) };

    const batches: number[] = [];
    for (let round = 0; round < 10; round++) {
      const queued = await dispatchCampaigns(ctx({ antiBan: policy }));
      if (queued === 0) break;
      batches.push(queued);
      expect(await waiting()).toBeLessThanOrEqual(CAMPAIGN_QUEUE_AHEAD);
      // A sweep before anything has gone out adds nothing: the batch is still waiting.
      expect(await dispatchCampaigns(ctx({ antiBan: policy }))).toBe(0);
      await kickLane(ctx({ antiBan: policy }), senderId);
      expect(await waiting()).toBe(0);
    }

    expect(batches).toEqual([20, 20, 10]);
    expect(provider.sent).toHaveLength(50);
  }, 60_000);
});

describe('the migration that removed the old engine', () => {
  /** The migration's data steps, run against whatever the test put in the tables (they do not touch the dropped columns). */
  async function runDataSteps(): Promise<void> {
    const file = readFileSync(new URL('../../packages/db/migrations/0039_antiban_purge.sql', import.meta.url), 'utf8');
    const steps = file.split('--> statement-breakpoint')
      .map((part) => part.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('--')).join('\n').trim())
      .filter((statement) => /^(UPDATE|DELETE) /.test(statement));
    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const statement of steps) await db.execute(sql.raw(statement));
  }

  it('turns a degraded or quarantined number back into an active one, which then sends', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'quarantined' WHERE id = ${senderId}`);
    const degraded = (await one<{ id: string }>(sql`
      INSERT INTO sender_identity(org_id,provider,label,phone_e164,status)
      VALUES (${orgId},'fake','was degraded','+919000000323','degraded') RETURNING id`)).id;

    await runDataSteps();

    expect((await one<{ status: string }>(sql`SELECT status FROM sender_identity WHERE id = ${senderId}`)).status).toBe('active');
    expect((await one<{ status: string }>(sql`SELECT status FROM sender_identity WHERE id = ${degraded}`)).status).toBe('active');
    // A restart reconnects it like any active number, and a message queued for it goes out.
    const restored = new FakeChannelProvider();
    expect(await restoreSessions(ctx({ provider: restored }), ['fake'])).toBeGreaterThanOrEqual(2);
    const id = await queue('after the migration', 'agent');
    await handleSend(ctx({ provider: restored }), id);
    expect(restored.sent).toHaveLength(1);
    expect((await statusOf(id)).status).toBe('sent');
  });

  it('releases a message the old gates were holding, so the next sweep sends it', async () => {
    const reasons = ['quarantined', 'paced:per_minute', 'recovery_pause:timelock_463', 'recipient_hours'];
    const held: string[] = [];
    for (const reason of reasons) {
      const id = await queue(`held by ${reason}`, 'agent');
      await db.execute(sql`UPDATE message SET hold_reason = ${reason} WHERE id = ${id}`);
      held.push(id);
    }
    const stillDown = await queue('waiting for the socket', 'agent');
    await db.execute(sql`UPDATE message SET hold_reason = 'sender_not_connected' WHERE id = ${stillDown}`);

    await runDataSteps();

    for (const id of held) expect((await statusOf(id)).hold).toBeNull();
    expect((await statusOf(stillDown)).hold).toBe('sender_not_connected');

    await sweepPendingWork(ctx());
    for (const id of held) expect((await statusOf(id)).status).toBe('sent');
  });

  it('leaves a campaign the detector paused paused, without the reason, and keeps the ban and unlink reasons', async () => {
    const make = async (reason: string, status = 'paused') => (await one<{ id: string }>(sql`
      INSERT INTO campaign (org_id, name, status, body, sender_identity_id, pause_reason)
      VALUES (${orgId}, ${reason}, ${status}, 'x', ${senderId}, ${reason}) RETURNING id`)).id;
    const likely = await make('restriction_likely');
    const suspected = await make('restriction_suspected');
    const ban = await make('ban_suspected');
    const unlinked = await make('unlinked');

    await runDataSteps();

    const read = (id: string) => one<{ status: string; reason: string | null }>(
      sql`SELECT status, pause_reason AS reason FROM campaign WHERE id = ${id}`);
    expect(await read(likely)).toEqual({ status: 'paused', reason: null });
    expect(await read(suspected)).toEqual({ status: 'paused', reason: null });
    expect(await read(ban)).toEqual({ status: 'paused', reason: 'ban_suspected' });
    expect(await read(unlinked)).toEqual({ status: 'paused', reason: 'unlinked' });
  });

  it('keeps the timeline entries the connection handling still writes, and drops the rest', async () => {
    for (const kind of ['restriction_likely', 'restriction_cleared', 'recovery_started', 'forbidden_suspected', 'hard_ban_suspected', 'unlinked_on_phone']) {
      await db.execute(sql`
        INSERT INTO sender_health_event (org_id, sender_identity_id, kind, severity, summary)
        VALUES (${orgId}, ${senderId}, ${kind}, 'warning', 'x')`);
    }

    await runDataSteps();

    const kinds = ((await db.execute(sql`SELECT kind FROM sender_health_event WHERE org_id = ${orgId} ORDER BY kind`)
    ) as unknown as Array<{ kind: string }>).map((r) => r.kind);
    expect(kinds).toEqual(['forbidden_suspected', 'hard_ban_suspected', 'unlinked_on_phone']);
  });

  it('left no column of the old engine behind', async () => {
    const columns = ((await db.execute(sql`
      SELECT column_name AS c FROM information_schema.columns
      WHERE table_name IN ('sender_identity', 'channel_session')`)) as unknown as Array<{ c: string }>).map((r) => r.c);
    for (const gone of ['health', 'warmup_started_at', 'last_inbound_at', 'risk_score', 'daily_cap_override', 'recovery_incident',
      'recovery_started_at', 'recovery_until', 'enforcement', 'advisory_reason', 'advisory_set_by', 'advisory_set_at',
      'advisory_bypass_count', 'advisory_last_bypass', 'restriction_state', 'restriction_since', 'disconnect_code', 'reconnect_attempts']) {
      expect(columns, gone).not.toContain(gone);
    }
    // What the kept features read is still there.
    for (const kept of ['status', 'connection_state', 'decrypt_burst_at', 'own_decrypt_burst_at', 'disconnect_reason']) {
      expect(columns, kept).toContain(kept);
    }
  });
});
