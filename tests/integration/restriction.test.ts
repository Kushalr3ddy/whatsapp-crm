import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import {
  classifyRestriction, nextRestrictionState, checkRestriction, markMessageFailedByProviderId,
  issueApiKey, HOLD_MS, type RestrictionStats
} from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { applyConnectionEvent, type WorkContext } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Silent-restriction tracking (docs/27-restriction-tracking.md): WhatsApp does not announce a
 * restriction, so it is inferred from delivery evidence. The thresholds are pure and tested without
 * a database; the rest proves the evidence is counted correctly and acted on in both directions.
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

const HEALTHY: RestrictionStats = {
  recentSent: 30, recentStuck: 2, baselineSent: 200, baselineStuck: 10,
  knownSent: 20, knownStuck: 1, strangerSent: 10, strangerStuck: 1,
  p50Ms: 60_000, baselineP50Ms: 45_000, deliveredSample: 28,
  hoursSinceInbound: 3, outbound24h: 60
};

describe('classifyRestriction (pure)', () => {
  it('calls a normal day ok, including when a few recipients are simply offline', () => {
    expect(classifyRestriction(HEALTHY).proposed).toBe('ok');
    // A third of phones off is not a restriction: the stuck ratio never reaches half.
    expect(classifyRestriction({ ...HEALTHY, recentStuck: 10, knownStuck: 6, strangerStuck: 4 }).proposed).toBe('ok');
  });

  it('needs two independent signals for suspected — one alone has innocent explanations', () => {
    // 16 of 30 stuck, split so neither cohort signal fires: the known contacts are 40% stuck.
    const spikeOnly = { ...HEALTHY, recentStuck: 16, knownStuck: 8, strangerStuck: 8, deliveredSample: 12 };
    expect(classifyRestriction(spikeOnly).signals.map((s) => s.id)).toEqual(['stuck_spike']);
    expect(classifyRestriction(spikeOnly).proposed).toBe('ok');

    const slowToo = { ...spikeOnly, p50Ms: 40 * 60_000, deliveredSample: 12 };
    const v = classifyRestriction(slowToo);
    expect(v.signals.map((s) => s.id)).toEqual(['stuck_spike', 'slow_delivery']);
    expect(v.proposed).toBe('suspected');
  });

  it('is likely when people who normally reply are stuck too', () => {
    const v = classifyRestriction({ ...HEALTHY, recentStuck: 22, knownStuck: 12, strangerStuck: 10 });
    expect(v.signals.map((s) => s.id)).toContain('known_contacts_stuck');
    expect(v.proposed).toBe('likely');
  });

  it('recognises the reachout-timelock shape: only strangers are stuck', () => {
    const v = classifyRestriction({
      ...HEALTHY, recentSent: 30, recentStuck: 15, knownSent: 10, knownStuck: 1, strangerSent: 20, strangerStuck: 14
    });
    expect(v.signals.map((s) => s.id)).toEqual(['stuck_spike', 'strangers_only_stuck']);
    expect(v.proposed).toBe('suspected');
  });

  it('does nothing without enough sends to judge', () => {
    expect(classifyRestriction({ ...HEALTHY, recentSent: 5, recentStuck: 5, knownSent: 3, knownStuck: 3 }).proposed).toBe('ok');
  });
});

describe('nextRestrictionState (hysteresis)', () => {
  it('rises at once but falls only after holding, one step at a time', () => {
    expect(nextRestrictionState('ok', 'likely', 0)).toBe('likely');
    expect(nextRestrictionState('likely', 'ok', HOLD_MS.likely - 1)).toBe('likely');
    expect(nextRestrictionState('likely', 'ok', HOLD_MS.likely)).toBe('suspected');
    expect(nextRestrictionState('suspected', 'ok', HOLD_MS.suspected - 1)).toBe('suspected');
    expect(nextRestrictionState('suspected', 'ok', HOLD_MS.suspected)).toBe('ok');
    expect(nextRestrictionState('suspected', 'likely', 0)).toBe('likely');
  });
});

describe('against the database', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;
  let media: TempStorage;
  let orgId: string;
  let senderId: string;
  let key: string;
  const NOW = new Date('2026-11-02T12:00:00Z');
  const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
  const HOUR = 3_600_000;

  beforeAll(async () => {
    db = createDatabase(url, { max: 6 });
    media = tempStorage('crm-restriction');
    const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
    app = buildApp({
      config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage
    });
  });
  afterAll(async () => { await db.$client.end(); media.cleanup(); });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM org`);
    orgId = (await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('r','restriction') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    senderId = (await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at)
      VALUES (${orgId}, 'fake', 's', '+919000000001', 'active', ${ago(30 * 86_400_000)})
      RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state)
      VALUES (${senderId}, 'open')`);
    key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['senders:read', 'conversations:read'] })).secret;
  });

  /** Seeds `n` sends `ageMs` ago to people who have (known) or have not replied. */
  async function seed(n: number, ageMs: number, opts: { stuck: boolean; known: boolean }): Promise<void> {
    for (let i = 0; i < n; i++) {
      const c = (await db.execute(sql`
        INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'p', 'test') RETURNING id`
      ) as unknown as Array<{ id: string }>)[0]!.id;
      const v = (await db.execute(sql`
        INSERT INTO conversation (org_id, contact_id, sender_identity_id)
        VALUES (${orgId}, ${c}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
      if (opts.known) {
        await db.execute(sql`INSERT INTO message (org_id, conversation_id, direction, status, content_type, provider_message_id, created_at)
          VALUES (${orgId}, ${v}, 'inbound', 'delivered', 'text', ${`in-${randomUUID()}`}, ${ago(5 * 86_400_000)})`);
      }
      const sentAt = ago(ageMs + i * 1000);
      await db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, provider_message_id,
                             sent_at, delivered_at, created_at)
        VALUES (${orgId}, ${v}, 'outbound', ${opts.stuck ? 'sent' : 'delivered'}, 'text', ${`out-${randomUUID()}`},
                ${sentAt}, ${opts.stuck ? null : ago(ageMs + i * 1000 - 60_000)}, ${sentAt})`);
    }
  }
  const state = async () => (await db.execute(sql`
    SELECT restriction_state AS s FROM sender_identity WHERE id = ${senderId}`) as unknown as Array<{ s: string }>)[0]!.s;
  const kinds = async () => (await db.execute(sql`
    SELECT kind FROM sender_health_event WHERE sender_identity_id = ${senderId} ORDER BY at, id`
  ) as unknown as Array<{ kind: string }>).map((r) => r.kind);

  it('stays ok on healthy delivery', async () => {
    await seed(25, HOUR, { stuck: false, known: true });
    await seed(2, HOUR, { stuck: true, known: true });
    const r = await checkRestriction(db, senderId, NOW);
    expect(r).toMatchObject({ from: 'ok', to: 'ok', changed: false });
    expect(await kinds()).toEqual([]);
  });

  it('goes likely when people who normally reply are stuck: event, soft-ban recovery, campaign paused', async () => {
    await seed(40, 8 * HOUR, { stuck: false, known: true });     // a healthy baseline
    await seed(24, 2 * HOUR, { stuck: true, known: true });      // then everyone goes quiet
    const campaign = (await db.execute(sql`
      INSERT INTO campaign (org_id, name, body, sender_identity_id, status)
      VALUES (${orgId}, 'c', 'hi', ${senderId}, 'running') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;

    const r = await checkRestriction(db, senderId, NOW);
    expect(r).toMatchObject({ from: 'ok', to: 'likely', changed: true });
    expect(await state()).toBe('likely');
    expect(await kinds()).toEqual(['restriction_likely']);

    const c = (await db.execute(sql`SELECT status, pause_reason AS why FROM campaign WHERE id = ${campaign}`) as
      unknown as Array<{ status: string; why: string }>)[0]!;
    expect(c).toEqual({ status: 'paused', why: 'restriction_likely' });
    const s = (await db.execute(sql`SELECT recovery_incident AS i FROM sender_identity WHERE id = ${senderId}`) as
      unknown as Array<{ i: string | null }>)[0]!;
    expect(s.i).toBe('soft_ban');

    // Re-checking the same evidence neither flaps nor writes a second event.
    expect((await checkRestriction(db, senderId, new Date(NOW.getTime() + 60_000)))!.changed).toBe(false);
    expect(await kinds()).toEqual(['restriction_likely']);
  });

  it('clears — one step at a time, only after holding — when delivery recovers', async () => {
    await seed(40, 8 * HOUR, { stuck: false, known: true });
    await seed(24, 2 * HOUR, { stuck: true, known: true });
    await checkRestriction(db, senderId, NOW);
    expect(await state()).toBe('likely');

    // Much later the old sends are outside the window: nothing recent, so the evidence says ok.
    const later = new Date(NOW.getTime() + 12 * HOUR);
    expect((await checkRestriction(db, senderId, later))!.to).toBe('suspected');
    const after = new Date(later.getTime() + 2 * HOUR);
    expect((await checkRestriction(db, senderId, after))!.to).toBe('ok');
    expect(await kinds()).toEqual(['restriction_likely', 'restriction_easing', 'restriction_cleared']);
  });

  it('exposes the state and the timeline to the API', async () => {
    await seed(40, 8 * HOUR, { stuck: false, known: true });
    await seed(24, 2 * HOUR, { stuck: true, known: true });
    await checkRestriction(db, senderId, NOW);

    const list = await request(app).get('/api/v1/senders').set('Authorization', `Bearer ${key}`);
    expect(list.body.data[0]).toMatchObject({ restrictionState: 'likely' });
    const ev = await request(app).get(`/api/v1/senders/${senderId}/health-events`).set('Authorization', `Bearer ${key}`);
    expect(ev.status).toBe(200);
    expect(ev.body.data[0]).toMatchObject({ kind: 'restriction_likely', severity: 'critical' });
    expect(ev.body.data[0].summary).toContain('restricted');
  });

  describe('connection events', () => {
    const ctx = (): WorkContext => ({
      db, provider: new FakeChannelProvider(), logger, kms,
      decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
      limits: { perMinute: 8, perDay: 1500 }
    });
    const session = async () => (await db.execute(sql`
      SELECT disconnect_code AS code, reconnect_attempts AS attempts FROM channel_session
      WHERE sender_identity_id = ${senderId}`) as unknown as Array<{ code: number | null; attempts: number }>)[0]!;

    it('records the close code and counts closes in a row, and an open clears them', async () => {
      await applyConnectionEvent(ctx(), { senderId, state: 'closed', reason: 'connection_closed', code: 428, at: NOW });
      await applyConnectionEvent(ctx(), { senderId, state: 'closed', reason: 'connection_closed', code: 428, at: NOW });
      expect(await session()).toEqual({ code: 428, attempts: 2 });
      await applyConnectionEvent(ctx(), { senderId, state: 'open', reason: null, at: NOW });
      expect(await session()).toEqual({ code: null, attempts: 0 });
    });

    it('flags a logout nobody asked for as a possible ban, but not a deliberate unlink', async () => {
      await db.execute(sql`UPDATE channel_session SET unlink_requested_at = now() WHERE sender_identity_id = ${senderId}`);
      await applyConnectionEvent(ctx(), { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: NOW });
      expect(await kinds()).toEqual([]);

      await db.execute(sql`UPDATE channel_session SET unlink_requested_at = NULL WHERE sender_identity_id = ${senderId}`);
      await applyConnectionEvent(ctx(), { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: NOW });
      expect(await kinds()).toEqual(['hard_ban_suspected']);
    });
  });

  it('records a server delivery error as a failed send, without undoing a success', async () => {
    const c = (await db.execute(sql`INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, 'p', 't') RETURNING id`) as
      unknown as Array<{ id: string }>)[0]!.id;
    const v = (await db.execute(sql`INSERT INTO conversation (org_id, contact_id, sender_identity_id)
      VALUES (${orgId}, ${c}, ${senderId}) RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const mk = async (status: string, pid: string) => db.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, provider_message_id)
      VALUES (${orgId}, ${v}, 'outbound', ${status}, 'text', ${pid})`);
    await mk('sent', 'p-sent'); await mk('delivered', 'p-done');
    await markMessageFailedByProviderId(db, orgId, 'p-sent', 'delivery_error');
    await markMessageFailedByProviderId(db, orgId, 'p-done', 'delivery_error');
    const rows = await db.execute(sql`SELECT provider_message_id AS p, status, error_code AS e FROM message ORDER BY provider_message_id`);
    expect(rows).toEqual([
      { p: 'p-done', status: 'delivered', e: null },
      { p: 'p-sent', status: 'failed', e: 'delivery_error' }
    ]);
  });
});
