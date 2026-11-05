import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { loadNumberState, registerRetryRequest, resumeNumber } from '@crm/core';
import { applyStatusEvent, sweepDeliveries } from '../../apps/gateway/src/work.js';
import { makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S4: what a message that never gets its second tick means. The sweep judges every outbound message still at one tick 30 minutes
 * after sending, probing the contact's profile photo and about (at most once a day) and comparing with what was visible at the last
 * delivery. Nothing is ever resent.
 */
let lane: Lane;
beforeEach(async () => { lane = await makeLane(); });
afterEach(async () => { await lane.close(); });

const MIN = 60_000;
const HOUR = 60 * MIN;

const snapshot = (conversationId: string, photo: boolean, about: boolean) => lane.db.execute(sql`
  UPDATE conversation SET profile_snapshot = ${JSON.stringify({ photo, about, at: new Date(lane.clock.now().getTime() - 2 * HOUR).toISOString() })}::jsonb
  WHERE id = ${conversationId}`);
const conv = (id: string) => lane.one<{ blockedAt: string | null; probeAt: string | null; snapshot: { photo: boolean; about: boolean } | null }>(sql`
  SELECT likely_blocked_at AS "blockedAt", profile_probe_at AS "probeAt", profile_snapshot AS snapshot FROM conversation WHERE id = ${id}`);
const verdict = async (id: string) => (await lane.one<{ v: string | null; at: string | null }>(sql`
  SELECT tick_verdict AS v, tick_checked_at AS at FROM message WHERE id = ${id}`));
const sweep = () => sweepDeliveries(lane.ctx());
const campaign = async (): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now()) RETURNING id`)).id;
const session = () => lane.one<{ at: string | null; resumed: string | null }>(sql`
  SELECT many_undelivered_at AS at, many_undelivered_resumed_at AS resumed FROM channel_session WHERE sender_identity_id = ${lane.senderId}`);
const healthEvents = async (kind: string) => (await lane.db.execute(sql`
  SELECT kind, severity, summary FROM sender_health_event WHERE sender_identity_id = ${lane.senderId} AND kind = ${kind}`)) as unknown as Array<{ summary: string }>;

beforeEach(async () => {
  await lane.db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${lane.senderId}, 'open')`);
});

describe('AC-4.1 a decrypt retry belongs to S5', () => {
  it('AC-4.1 a message the contact asked for again is not probed or judged here', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profiles.set(c.phone, { photo: false, about: false });
    const m = await lane.sent(c.conversationId);
    await registerRetryRequest(lane.db, lane.senderId, m.providerId, lane.clock.now());

    await sweep();

    expect(lane.provider.profileChecks).toEqual([]);
    expect((await conv(c.conversationId)).blockedAt).toBeNull();
    expect((await verdict(m.id)).v).toBe('decrypt_retry');
  });
});

describe('AC-4.2 the probe', () => {
  it('AC-4.2 waits until the message has been at one tick for 30 minutes', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await lane.sent(c.conversationId, { agoMs: 29 * MIN });
    await sweep();
    expect(lane.provider.profileChecks).toEqual([]);
    lane.clock.advance(2 * MIN);
    await sweep();
    expect(lane.provider.profileChecks).toEqual([c.phone]);
  });

  it('AC-4.2 probes a contact at most once in 24 hours, however many messages are stuck', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await lane.sent(c.conversationId, { agoMs: 40 * MIN });
    await lane.sent(c.conversationId, { agoMs: 35 * MIN });
    await sweep();
    await sweep();
    expect(lane.provider.profileChecks).toEqual([c.phone]);

    const later = await lane.sent(c.conversationId, { agoMs: 31 * MIN });
    lane.clock.advance(HOUR);
    await sweep();
    expect(lane.provider.profileChecks).toEqual([c.phone]);          // an hour after the first probe: not again yet
    expect((await verdict(later.id)).at).toBeNull();                  // left for a later sweep, not judged on stale evidence

    lane.clock.advance(24 * HOUR);
    await sweep();
    expect(lane.provider.profileChecks).toEqual([c.phone, c.phone]);
    expect((await verdict(later.id)).v).not.toBeNull();
  });

  it('AC-4.2 takes a snapshot of the profile when a message to them is delivered, and not again within a day', async () => {
    const c = await lane.contact({ inbound: 'old' });
    lane.provider.profiles.set(c.phone, { photo: true, about: false });
    const m = await lane.sent(c.conversationId, { agoMs: 2 * MIN });
    await applyStatusEvent(lane.ctx(), { providerMessageId: m.providerId, senderId: lane.senderId, status: 'delivered', errorCode: null, at: lane.clock.now() });
    expect((await conv(c.conversationId)).snapshot).toMatchObject({ photo: true, about: false });
    expect(lane.provider.profileChecks).toEqual([c.phone]);

    const m2 = await lane.sent(c.conversationId, { agoMs: 1 * MIN });
    await applyStatusEvent(lane.ctx(), { providerMessageId: m2.providerId, senderId: lane.senderId, status: 'read', errorCode: null, at: lane.clock.now() });
    expect(lane.provider.profileChecks).toEqual([c.phone]);
  });

  it('AC-4.2 a probe that could not tell is not recorded as an answer', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profileUnknown = true;
    const m = await lane.sent(c.conversationId);
    await sweep();
    expect((await verdict(m.id)).v).toBeNull();
    expect((await conv(c.conversationId)).blockedAt).toBeNull();
  });
});

describe('AC-4.3 both gone: likely blocked', () => {
  it('AC-4.3 photo and about visible before, both gone now → the contact is marked likely_blocked', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profiles.set(c.phone, { photo: false, about: false });
    const m = await lane.sent(c.conversationId);
    await sweep();
    expect((await conv(c.conversationId)).blockedAt).not.toBeNull();
    expect((await verdict(m.id)).v).toBe('likely_blocked');
  });

  it('AC-4.3 campaigns and the AI stop messaging them (likely_blocked); an agent can still send by hand', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profiles.set(c.phone, { photo: false, about: false });
    await lane.sent(c.conversationId);
    await sweep();

    const camp = await campaign();
    const viaCampaign = await lane.queue(c.conversationId, 'campaign text', { campaignId: camp });
    const viaAi = await lane.queue(c.conversationId, 'ai text', { sentBy: 'agent' });
    const byHand = await lane.queue(c.conversationId, 'agent text');
    const order = await lane.drain();

    expect(order).toEqual(['agent text']);
    expect(await lane.row(viaCampaign)).toMatchObject({ status: 'queued', hold: 'likely_blocked', holdUntil: null });
    expect(await lane.row(viaAi)).toMatchObject({ status: 'queued', hold: 'likely_blocked' });
    expect((await lane.row(byHand)).status).toBe('sent');
  });

  it('AC-4.3 when the contact writes to us, the mark is lifted: they plainly have not blocked us', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profiles.set(c.phone, { photo: false, about: false });
    await lane.sent(c.conversationId);
    await sweep();
    expect((await conv(c.conversationId)).blockedAt).not.toBeNull();

    const { contactWroteAgain } = await import('@crm/core');
    await contactWroteAgain(lane.db, c.conversationId);
    expect((await conv(c.conversationId)).blockedAt).toBeNull();
  });
});

describe('AC-4.4 anything else: likely offline, and nothing is resent', () => {
  it('AC-4.4 the photo or the about is still visible → likely_offline, no mark on the contact', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await snapshot(c.conversationId, true, true);
    lane.provider.profiles.set(c.phone, { photo: true, about: false });
    const m = await lane.sent(c.conversationId);
    await sweep();
    expect((await verdict(m.id)).v).toBe('likely_offline');
    expect((await conv(c.conversationId)).blockedAt).toBeNull();
  });

  it('AC-4.4 no earlier snapshot → likely_offline even when both are gone', async () => {
    const c = await lane.contact({ inbound: 'old' });
    lane.provider.profiles.set(c.phone, { photo: false, about: false });
    const m = await lane.sent(c.conversationId);
    await sweep();
    expect((await verdict(m.id)).v).toBe('likely_offline');
    expect((await conv(c.conversationId)).blockedAt).toBeNull();
  });

  it('AC-4.4 nothing is resent, ever: no new message, no provider send, the stuck one stays as it was', async () => {
    const c = await lane.contact({ inbound: 'old' });
    const m = await lane.sent(c.conversationId, { agoMs: 3 * HOUR });
    await sweep();
    lane.clock.advance(48 * HOUR);
    await sweep();
    await lane.drain();
    expect(lane.provider.sent).toEqual([]);
    expect((await lane.row(m.id)).status).toBe('sent');
    const count = await lane.one<{ n: number }>(sql`SELECT count(*)::int AS n FROM message WHERE conversation_id = ${c.conversationId} AND direction = 'outbound'`);
    expect(count.n).toBe(1);
  });
});

/** Makes `n` contacts who deliver fast (an older message of theirs was delivered in a minute), each with a latest message sent 40 minutes ago. */
async function fastContacts(n: number, opts: { stuck: number; sentBy?: string; slow?: boolean }): Promise<string[]> {
  const stuckIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await lane.contact({ inbound: 'old' });
    await lane.sent(c.conversationId, { agoMs: 5 * HOUR, deliveredAfterMs: opts.slow === true ? 3 * HOUR : 1 * MIN });
    const isStuck = i < opts.stuck;
    const m = await lane.sent(c.conversationId, {
      agoMs: 40 * MIN + i * 1000, deliveredAfterMs: isStuck ? undefined : 2 * MIN, sentBy: isStuck ? opts.sentBy : undefined
    });
    if (isStuck) stuckIds.push(m.id);
  }
  return stuckIds;
}

describe('AC-4.5 and AC-4.6 many stuck', () => {
  it('AC-4.6 8 of the last 20 sends to fast-delivering contacts still at one tick after 30 minutes → campaigns held (many_undelivered) and a health event', async () => {
    await fastContacts(20, { stuck: 8 });
    await sweep();

    expect((await session()).at).not.toBeNull();
    const events = await healthEvents('many_undelivered');
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toMatch(/8/);

    const other = await lane.contact({ inbound: 'old' });
    const camp = await campaign();
    const viaCampaign = await lane.queue(other.conversationId, 'campaign text', { campaignId: camp });
    const byHand = await lane.queue(other.conversationId, 'agent text');
    const order = await lane.drain();
    expect(order).toEqual(['agent text']);
    expect(await lane.row(viaCampaign)).toMatchObject({ status: 'queued', hold: 'many_undelivered', holdUntil: null });
    expect((await lane.row(byHand)).status).toBe('sent');
  });

  it('AC-4.6 7 stuck is not enough', async () => {
    await fastContacts(20, { stuck: 7 });
    await sweep();
    expect((await session()).at).toBeNull();
    expect(await healthEvents('many_undelivered')).toHaveLength(0);
  });

  it('AC-4.5 contacts who do not deliver fast do not count: a slow phone being behind proves nothing', async () => {
    await fastContacts(20, { stuck: 12, slow: true });
    await sweep();
    expect((await session()).at).toBeNull();
  });

  it('AC-4.6 messages sent from the phone itself are left out of the count', async () => {
    await fastContacts(20, { stuck: 12, sentBy: 'phone' });
    await sweep();
    expect((await session()).at).toBeNull();
  });

  it('AC-4.6 the hold is recorded once, not on every sweep', async () => {
    await fastContacts(20, { stuck: 9 });
    await sweep();
    await sweep();
    expect(await healthEvents('many_undelivered')).toHaveLength(1);
  });
});

describe('AC-4.7 the hold lifts', () => {
  async function held(): Promise<string[]> {
    const ids = await fastContacts(20, { stuck: 8 });
    await sweep();
    expect((await session()).at).not.toBeNull();
    return ids;
  }
  const deliver = (ids: string[]) => lane.db.execute(sql`
    UPDATE message SET status = 'delivered', delivered_at = sent_at + interval '3 minutes' WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);

  it('AC-4.7 lifts when the count falls below 4, with a health event, and not before', async () => {
    const ids = await held();
    await deliver(ids.slice(0, 4));                 // 4 still stuck: not below 4
    await sweep();
    expect((await session()).at).not.toBeNull();
    await deliver(ids.slice(4, 5));                 // 3 left
    await sweep();
    expect((await session()).at).toBeNull();
    expect(await healthEvents('many_undelivered_lifted')).toHaveLength(1);

    const other = await lane.contact({ inbound: 'old' });
    await lane.queue(other.conversationId, 'campaign text', { campaignId: await campaign() });
    expect(await lane.drain()).toEqual(['campaign text']);
  });

  it('AC-4.7 an agent resuming from the number card lifts it, and the old stuck messages do not bring it straight back', async () => {
    await held();
    expect(await resumeNumber(lane.db, lane.orgId, lane.senderId, lane.clock.now())).toBe(true);
    expect((await session()).at).toBeNull();
    expect((await session()).resumed).not.toBeNull();
    lane.clock.advance(MIN);
    await sweep();
    expect((await session()).at).toBeNull();
  });

  it('AC-4.7 resuming a number that is not held changes nothing', async () => {
    expect(await resumeNumber(lane.db, lane.orgId, lane.senderId, lane.clock.now())).toBe(false);
  });
});

describe('AC-7.4 the reaction brake reads likely_blocked', () => {
  it('AC-7.4 10% of the latest new-chat sends marked likely_blocked turns the brake on; none does not', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await lane.contact();                                   // never wrote to us: a new chat
      await lane.sent(c.conversationId, { agoMs: (60 + i) * MIN });
      ids.push(c.conversationId);
    }
    expect((await loadNumberState(lane.db, lane.senderId)).brakeOn).toBe(false);

    await lane.db.execute(sql`UPDATE conversation SET likely_blocked_at = now() WHERE id = ${ids[0]!}`);
    expect((await loadNumberState(lane.db, lane.senderId)).brakeOn).toBe(true);

    await lane.db.execute(sql`UPDATE conversation SET likely_blocked_at = NULL WHERE id = ${ids[0]!}`);
    expect((await loadNumberState(lane.db, lane.senderId)).brakeOn).toBe(false);
  });
});
