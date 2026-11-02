import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NormalisedNoticeEvent } from '@crm/channels';
import type { FakeChannelProvider } from '@crm/channel-fake';
import { applyConnectionEvent, applyNoticeEvent, kickLane } from '../../apps/gateway/src/work.js';
import { makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S2: what WhatsApp tells a number about its own limits. The fake provider emits the same port events the Baileys adapter does; the
 * gateway stores the latest of each on the number and every raw one as a notice, and the lane acts on them.
 */
let lane: Lane;
beforeEach(async () => { lane = await makeLane(); });
afterEach(async () => { await lane.close(); });

/** Takes the next notice the provider emitted, the way the gateway's loop does. */
async function nextNotice(provider: FakeChannelProvider): Promise<NormalisedNoticeEvent> {
  const it = provider.notices()[Symbol.asyncIterator]();
  const { value } = await it.next();
  return value as NormalisedNoticeEvent;
}

/** Emits a notice on the provider and runs it through the gateway. */
async function receive(emit: () => void): Promise<void> {
  emit();
  await applyNoticeEvent(lane.ctx(), await nextNotice(lane.provider));
}

const campaign = async (): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now()) RETURNING id`)).id;
const t = (n: number): Date => new Date(Date.now() - 600_000 + n * 1000);
const hourFromNow = (): Date => new Date(lane.clock.now().getTime() + 3_600_000);

describe('AC-2.5 the number stores what WhatsApp said', () => {
  it('AC-2.5 stores the latest timelock and cap on the number, and every raw one as a notice', async () => {
    const until = hourFromNow();
    const cycleEnd = new Date(lane.clock.now().getTime() + 86_400_000);
    await receive(() => lane.provider.emitTimelock(lane.senderId, { active: true, until, enforcementType: 'WEB_COMPANION_ONLY' }));
    await receive(() => lane.provider.emitCapping(lane.senderId, { status: 'FIRST_WARNING', totalQuota: 100, usedQuota: 60, cycleEnd }));
    await receive(() => lane.provider.emitCapping(lane.senderId, { status: 'SECOND_WARNING', totalQuota: 100, usedQuota: 90, cycleEnd }));

    const s = await lane.one<Record<string, unknown>>(sql`
      SELECT timelock_active AS "active", timelock_until AS "until", timelock_type AS "type", capping_status AS "status",
             capping_total_quota AS "total", capping_used_quota AS "used", capping_cycle_end AS "cycleEnd"
      FROM channel_session WHERE sender_identity_id = ${lane.senderId}`);
    expect(s).toMatchObject({ active: true, type: 'WEB_COMPANION_ONLY', status: 'SECOND_WARNING', total: 100, used: 90 });
    expect(new Date(s.until as string).getTime()).toBe(until.getTime());
    expect(new Date(s.cycleEnd as string).getTime()).toBe(cycleEnd.getTime());

    const notices = (await lane.db.execute(sql`
      SELECT kind, payload, received_at AS "at" FROM whatsapp_notice WHERE sender_identity_id = ${lane.senderId} ORDER BY received_at, kind`
    )) as unknown as Array<{ kind: string; payload: Record<string, unknown> }>;
    expect(notices.map((n) => n.kind).sort()).toEqual(['capping', 'capping', 'timelock']);
    expect(notices.filter((n) => n.kind === 'capping').map((n) => n.payload.status).sort()).toEqual(['FIRST_WARNING', 'SECOND_WARNING']);
  });

  it('AC-2.5 linked_since is the first open after the last link: set once, left alone by a reconnect, cleared by an unlink', async () => {
    const at1 = new Date('2026-11-01T10:00:00.000Z');
    const at2 = new Date('2026-11-01T11:00:00.000Z');
    const read = async () => (await lane.one<{ since: string | null }>(sql`
      SELECT linked_since AS since FROM channel_session WHERE sender_identity_id = ${lane.senderId}`)).since;

    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: at1 });
    expect(new Date((await read())!).getTime()).toBe(at1.getTime());
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'closed', reason: 'connection_closed', at: at2 });
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: at2 });
    expect(new Date((await read())!).getTime()).toBe(at1.getTime());

    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'logged_out', reason: 'logged_out', at: at2 });
    expect(await read()).toBeNull();
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: new Date('2026-11-02T00:00:00.000Z') });
    expect(new Date((await read())!).getTime()).toBe(new Date('2026-11-02T00:00:00.000Z').getTime());
  });
});

describe('AC-2.1 and AC-2.2 the timelock', () => {
  it('AC-2.1 holds new chats until the lock ends, with the end time; known contacts still get messages', async () => {
    const until = hourFromNow();
    const camp = await campaign();
    const stranger = await lane.contact();
    const known = await lane.contact({ inbound: 'old' });
    const held = await lane.queue(stranger.conversationId, 'to a new chat', { sentBy: 'system', campaignId: camp, createdAt: t(1), gapMs: 1000 });
    const through = await lane.queue(known.conversationId, 'to a known contact', { createdAt: t(2), gapMs: 1000 });

    await receive(() => lane.provider.emitTimelock(lane.senderId, { active: true, until }));
    await kickLane(lane.ctx(), lane.senderId);

    expect(await lane.row(held)).toMatchObject({ status: 'queued', hold: 'timelock' });
    expect(new Date((await lane.row(held)).holdUntil!).getTime()).toBe(until.getTime());
    expect((await lane.row(through)).status).toBe('sent');
  });

  it('AC-2.2 the held messages go, in lane order, when the time passes', async () => {
    const until = hourFromNow();
    const camp = await campaign();
    for (const [i, name] of ['A', 'B', 'C'].entries()) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, name, { sentBy: 'system', campaignId: camp, createdAt: t(i), gapMs: 1000 });
    }
    await receive(() => lane.provider.emitTimelock(lane.senderId, { active: true, until }));

    const order = await lane.drain();
    expect(order).toEqual(['A', 'B', 'C']);
    expect(lane.provider.sent[0]!.at.getTime()).toBeGreaterThanOrEqual(until.getTime());
  });

  it('AC-2.2 the held messages go as soon as an inactive update arrives, without waiting for the time', async () => {
    const camp = await campaign();
    const p = await lane.contact();
    const id = await lane.queue(p.conversationId, 'waiting for the lock', { sentBy: 'system', campaignId: camp, gapMs: 1000 });
    await receive(() => lane.provider.emitTimelock(lane.senderId, { active: true, until: hourFromNow() }));
    await kickLane(lane.ctx(), lane.senderId);
    expect((await lane.row(id)).status).toBe('queued');

    await receive(() => lane.provider.emitTimelock(lane.senderId, { active: false }));
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
    expect(lane.clock.now().getTime()).toBeLessThan(hourFromNow().getTime() - 3_000_000);   // nowhere near the lock's end
  });
});

describe('AC-2.3 the cap warnings slow new chats', () => {
  /** Sends three messages with a 10 s stored gap, to new chats or to known contacts, and returns the gaps between them. */
  async function gapsAfter(status: 'FIRST_WARNING' | 'SECOND_WARNING', toNewChats: boolean): Promise<number[]> {
    await receive(() => lane.provider.emitCapping(lane.senderId, {
      status, totalQuota: 1000, usedQuota: 10, cycleEnd: new Date(lane.clock.now().getTime() + 86_400_000)
    }));
    for (let i = 0; i < 3; i++) {
      const p = toNewChats ? await lane.contact() : await lane.contact({ inbound: 'old' });
      await lane.queue(p.conversationId, `m${String(i)}`, { createdAt: t(i), gapMs: 10_000 });
    }
    await lane.drain();
    const at = lane.provider.sent.map((m) => m.at.getTime());
    return at.slice(1).map((v, i) => v - at[i]!);
  }

  it('AC-2.3 FIRST_WARNING doubles the gap before new chats', async () => {
    expect(await gapsAfter('FIRST_WARNING', true)).toEqual([20_000, 20_000]);
  });

  it('AC-2.3 SECOND_WARNING triples it', async () => {
    expect(await gapsAfter('SECOND_WARNING', true)).toEqual([30_000, 30_000]);
  });

  it('AC-2.3 known contacts are unchanged', async () => {
    expect(await gapsAfter('SECOND_WARNING', false)).toEqual([10_000, 10_000]);
  });
});

describe('AC-2.4 CAPPED', () => {
  it('AC-2.4 holds new chats until the cycle ends (new_chat_cap); known contacts go', async () => {
    const cycleEnd = new Date(lane.clock.now().getTime() + 7_200_000);
    await receive(() => lane.provider.emitCapping(lane.senderId, { status: 'CAPPED', totalQuota: 50, usedQuota: 50, cycleEnd }));
    const camp = await campaign();
    const stranger = await lane.contact();
    const known = await lane.contact({ inbound: 'old' });
    const held = await lane.queue(stranger.conversationId, 'new chat', { sentBy: 'system', campaignId: camp, createdAt: t(1), gapMs: 1000 });
    const ok = await lane.queue(known.conversationId, 'known', { createdAt: t(2), gapMs: 1000 });

    await kickLane(lane.ctx(), lane.senderId);
    expect(await lane.row(held)).toMatchObject({ status: 'queued', hold: 'new_chat_cap' });
    expect(new Date((await lane.row(held)).holdUntil!).getTime()).toBe(cycleEnd.getTime());
    expect((await lane.row(ok)).status).toBe('sent');

    await lane.drain();
    expect((await lane.row(held)).status).toBe('sent');
    expect(lane.provider.sent[1]!.at.getTime()).toBeGreaterThanOrEqual(cycleEnd.getTime());
  });

  it('AC-2.4 counts the new chats started since WhatsApp last reported, so the quota is not overshot between updates', async () => {
    const cycleEnd = new Date(lane.clock.now().getTime() + 7_200_000);
    await receive(() => lane.provider.emitCapping(lane.senderId, { status: 'NONE', totalQuota: 10, usedQuota: 8, cycleEnd }));
    const camp = await campaign();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await lane.contact();
      ids.push(await lane.queue(p.conversationId, `n${String(i)}`, { sentBy: 'system', campaignId: camp, createdAt: t(i), gapMs: 1000 }));
    }
    await kickLane(lane.ctx(), lane.senderId);
    await lane.drain({}, 60);
    // Two were left in the quota; the other two wait for the next cycle.
    expect((await Promise.all(ids.map(lane.row))).map((r) => r.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
    expect(lane.provider.sent.slice(0, 2).every((m) => m.at.getTime() < cycleEnd.getTime())).toBe(true);
    expect(lane.provider.sent.slice(2).every((m) => m.at.getTime() >= cycleEnd.getTime())).toBe(true);
  });
});

describe('AC-2.6 a 463 refusal', () => {
  it('AC-2.6 fails that message (whatsapp_refused_463) and holds new sends to that contact (refused_463), not to others', async () => {
    const bad = await lane.contact({ inbound: 'old' });
    const other = await lane.contact({ inbound: 'old' });
    lane.provider.refuse463.add(bad.phone);
    const refused = await lane.queue(bad.conversationId, 'refused', { createdAt: t(1), gapMs: 1000 });
    await lane.drain();
    expect(await lane.row(refused)).toMatchObject({ status: 'failed', code: 'whatsapp_refused_463' });
    expect((await lane.one<{ at: string | null }>(sql`SELECT refused_463_at AS at FROM conversation WHERE id = ${bad.conversationId}`)).at).not.toBeNull();

    const later = await lane.queue(bad.conversationId, 'a new send to the same contact', { gapMs: 1000 });
    const fine = await lane.queue(other.conversationId, 'to someone else', { gapMs: 1000 });
    await lane.drain();
    expect(await lane.row(later)).toMatchObject({ status: 'queued', hold: 'refused_463', holdUntil: null });
    expect((await lane.row(fine)).status).toBe('sent');
    expect(lane.sentBodies()).toEqual(['to someone else']);
  });

  it('AC-2.6 a person lifting the hold lets the contact be messaged again', async () => {
    const p = await lane.contact({ inbound: 'old' });
    await lane.db.execute(sql`UPDATE conversation SET refused_463_at = now() WHERE id = ${p.conversationId}`);
    const id = await lane.queue(p.conversationId, 'after the retry', { gapMs: 1000 });
    await lane.drain();
    expect((await lane.row(id)).status).toBe('queued');
    await lane.db.execute(sql`UPDATE conversation SET refused_463_at = NULL WHERE id = ${p.conversationId}`);
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
  });
});

describe('AC-2.7 the device was removed on the phone', () => {
  it('AC-2.7 keeps today\'s behaviour: campaigns paused as unlinked and everything held', async () => {
    const camp = await campaign();
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'queued before the unlink', { sentBy: 'system', campaignId: camp });

    await applyConnectionEvent(lane.ctx(), {
      senderId: lane.senderId, state: 'logged_out', reason: 'logged_out', code: 401, detail: 'device_removed', at: new Date()
    });
    const paused = await lane.one<{ status: string; reason: string | null }>(sql`SELECT status, pause_reason AS reason FROM campaign WHERE id = ${camp}`);
    expect(paused).toEqual({ status: 'paused', reason: 'unlinked' });

    await kickLane(lane.ctx(), lane.senderId);
    expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'sender_not_connected' });
    expect(lane.provider.sent).toHaveLength(0);
  });
});
