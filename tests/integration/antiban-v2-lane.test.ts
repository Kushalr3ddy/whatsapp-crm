import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { requestRead, storeInboundMessage, type AntiBanPolicy } from '@crm/core';
import { FakeChannelProvider } from '@crm/channel-fake';
import { handleReadRequest, handleSend, kickLane, sweepPendingWork } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { kms, makeLane, url, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S1 (the send lane), S8 (holds never lose a message) and S9 (the policy is a driver), against the fake provider and a clock the
 * test moves by hand. Every test is named after the acceptance case it covers.
 */
let lane: Lane;
let media: TempStorage;

beforeAll(() => { media = tempStorage('antiban-lane'); });
afterAll(() => { media.cleanup(); });
beforeEach(async () => { lane = await makeLane(); });
afterEach(async () => { await lane.close(); });

const campaign = async (): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now()) RETURNING id`)).id;

/** Creation times a second apart, so "oldest first" is unambiguous. */
const t = (n: number): Date => new Date(Date.now() - 600_000 + n * 1000);

describe('AC-1.1 one number sends one message at a time', () => {
  it('AC-1.1 two messages from one number never leave at the same time, whatever queued them or woke the lane', async () => {
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => lane.contact({ inbound: 'old' })));
    const ids: string[] = [];
    for (const [i, p] of people.entries()) ids.push(await lane.queue(p.conversationId, `m${String(i)}`, { createdAt: t(i) }));

    // Instrument the provider: how many sends are in flight at once.
    let active = 0;
    let most = 0;
    const real = lane.provider.send.bind(lane.provider);
    lane.provider.send = async (...args: Parameters<FakeChannelProvider['send']>) => {
      active += 1; most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 15));
      try { return await real(...args); } finally { active -= 1; }
    };
    const c = lane.ctx();
    // The NOTIFY path, the sweep and a scheduled wake all arrive at once.
    await Promise.all([handleSend(c, ids[0]!), handleSend(c, ids[3]!), kickLane(c, lane.senderId), sweepPendingWork(c)]);
    await lane.drain();

    expect(most).toBe(1);
    expect(lane.provider.sent).toHaveLength(5);
  });
});

describe('AC-1.2 the order of the lane', () => {
  it('AC-1.2 a reply queued after 10 campaign messages goes before all of them', async () => {
    const camp = await campaign();
    for (let i = 0; i < 10; i++) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, `campaign ${String(i)}`, { sentBy: 'system', campaignId: camp, createdAt: t(i), gapMs: 1000 });
    }
    const asker = await lane.contact({ inbound: true });
    await lane.queue(asker.conversationId, 'the reply', { createdAt: t(20), gapMs: 1000 });

    const order = await lane.drain();
    expect(order[0]).toBe('the reply');
    expect(order.slice(1)).toEqual(Array.from({ length: 10 }, (_, i) => `campaign ${String(i)}`));
  });

  it('AC-1.2 the order is reply, then what an agent typed, then the AI, then campaign; oldest first within each', async () => {
    const camp = await campaign();
    const fresh = await lane.contact();
    const old = await lane.contact({ inbound: 'old' });
    const recent = await lane.contact({ inbound: true });
    // Queued in the worst order for the lane: campaign first, reply last.
    await lane.queue(fresh.conversationId, 'campaign', { sentBy: 'system', campaignId: camp, createdAt: t(1), gapMs: 1000 });
    await lane.queue(old.conversationId, 'ai', { sentBy: 'agent', createdAt: t(2), gapMs: 1000 });
    await lane.queue(old.conversationId, 'manual late', { sentBy: 'api', createdAt: t(4), gapMs: 1000 });
    await lane.queue(old.conversationId, 'manual early', { sentBy: 'api', createdAt: t(3), gapMs: 1000 });
    await lane.queue(recent.conversationId, 'reply', { sentBy: 'agent', createdAt: t(5), gapMs: 1000 });

    expect(await lane.drain()).toEqual(['reply', 'manual early', 'manual late', 'ai', 'campaign']);
  });
});

describe('AC-1.3 the gap between sends', () => {
  it('AC-1.3 the first message of a run goes at once (only its typing), each next one waits the gap stored for it', async () => {
    const gaps = [10_000, 20_000, 30_000, 40_000];
    for (const [i, gap] of gaps.entries()) {
      const p = await lane.contact({ inbound: 'old' });
      await lane.queue(p.conversationId, `m${String(i)}`, { createdAt: t(i), gapMs: gap });
    }
    const start = lane.clock.now().getTime();
    await lane.drain();

    const at = lane.provider.sent.map((m) => m.at.getTime() - start);
    // "hi"-sized texts type for the 2 s floor; the first message has no gap.
    expect(at[0]).toBe(2_000);
    expect(at.slice(1).map((v, i) => v - at[i]!)).toEqual([20_000, 30_000, 40_000]);
  });

  it('AC-1.3 a gap that has not been drawn yet is drawn once, between 1 and 50 s, and stored', async () => {
    const first = await lane.contact({ inbound: 'old' });
    const second = await lane.contact({ inbound: 'old' });
    await lane.queue(first.conversationId, 'a', { createdAt: t(1) });
    const b = await lane.queue(second.conversationId, 'b', { createdAt: t(2) });
    await lane.drain();
    const gap = (await lane.row(b)).gap!;
    expect(gap).toBeGreaterThanOrEqual(1_000);
    expect(gap).toBeLessThanOrEqual(50_000);
    expect(lane.provider.sent[1]!.at.getTime() - lane.provider.sent[0]!.at.getTime()).toBe(Math.max(gap, 2_000));
  });

  it('AC-1.3 after 90 s of silence the next message starts a new run and goes without a gap', async () => {
    const p = await lane.contact({ inbound: 'old' });
    await lane.queue(p.conversationId, 'one', { createdAt: t(1), gapMs: 50_000 });
    await lane.drain();
    lane.clock.advance(120_000);
    const q = await lane.contact({ inbound: 'old' });
    await lane.queue(q.conversationId, 'two', { createdAt: t(2), gapMs: 50_000 });
    const before = lane.clock.now().getTime();
    await lane.drain();
    expect(lane.provider.sent[1]!.at.getTime() - before).toBe(2_000);
  });
});

describe('AC-1.3 waiting is scheduled, not slept', () => {
  it('AC-1.3 a wait longer than the typing is left alone and the lane asks to be woken, instead of holding the sweep open', async () => {
    const a = await lane.contact({ inbound: 'old' });
    const b = await lane.contact({ inbound: 'old' });
    await lane.queue(a.conversationId, 'a', { createdAt: t(1), gapMs: 5_000 });
    await lane.queue(b.conversationId, 'b', { createdAt: t(2), gapMs: 45_000 });

    const c = lane.ctx();
    const result = await kickLane(c, lane.senderId);
    expect(lane.sentBodies()).toEqual(['a']);              // b is not due
    expect(result.nextWakeAt).not.toBeNull();
    expect(lane.slept.reduce((n, ms) => n + ms, 0)).toBeLessThan(26_000);   // only a's typing (2 s): no 45 s sleep
    // The lane asked the context to wake it, once, at the moment b has to start typing.
    expect(lane.scheduled).toHaveLength(1);
    expect(lane.scheduled[0]!.ms).toBe(45_000 - 2_000);
  });
});

describe('AC-1.4 typing', () => {
  it('AC-1.4 shows composing for chars x 60 ms, refreshes it every 5 s, then paused, then sends', async () => {
    const p = await lane.contact({ inbound: 'old' });
    await lane.queue(p.conversationId, 'x'.repeat(200), { gapMs: 1000 });         // 200 chars: 12 s
    const start = lane.clock.now().getTime();
    await lane.drain();

    const calls = lane.provider.typingCalls.map((c) => [c.state, c.at.getTime() - start]);
    expect(calls).toEqual([['composing', 0], ['composing', 5_000], ['composing', 10_000], ['paused', 12_000]]);
    expect(lane.provider.sent[0]!.at.getTime() - start).toBe(12_000);
  });

  it('AC-1.4 typing is inside the wait: with a 40 s gap the send is exactly 40 s after the last one, not 40 s plus the typing', async () => {
    const a = await lane.contact({ inbound: 'old' });
    const b = await lane.contact({ inbound: 'old' });
    await lane.queue(a.conversationId, 'first', { createdAt: t(1), gapMs: 1000 });
    await lane.queue(b.conversationId, 'x'.repeat(100), { createdAt: t(2), gapMs: 40_000 });   // 6 s of typing
    const start = lane.clock.now().getTime();
    await lane.drain();

    const [first, second] = lane.provider.sent;
    expect(second!.at.getTime() - first!.at.getTime()).toBe(40_000);
    // Typing started 6 s before the send, i.e. at the end of the wait.
    const composing = lane.provider.typingCalls.filter((c) => c.state === 'composing' && c.at.getTime() > first!.at.getTime());
    expect(composing[0]!.at.getTime() - start).toBe(first!.at.getTime() - start + 34_000);
  });

  it('AC-1.4 when the typing is longer than the gap, the typing sets the wait', async () => {
    const a = await lane.contact({ inbound: 'old' });
    const b = await lane.contact({ inbound: 'old' });
    await lane.queue(a.conversationId, 'first', { createdAt: t(1), gapMs: 1000 });
    await lane.queue(b.conversationId, 'x'.repeat(100), { createdAt: t(2), gapMs: 3_000 });   // 6 s of typing
    await lane.drain();
    expect(lane.provider.sent[1]!.at.getTime() - lane.provider.sent[0]!.at.getTime()).toBe(6_000);
  });

  it('AC-1.4 a failure to show typing never fails the send', async () => {
    lane.provider.typing = () => Promise.reject(new Error('presence refused'));
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'still goes');
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
  });
});

describe('AC-1.5 text and a photo are one message', () => {
  it('AC-1.5 goes as one message: the photo with the text as its caption', async () => {
    const store = media.storage;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await store.put(`antiban-lane/${lane.orgId}.jpg`, bytes, { contentType: 'image/jpeg' });
    const mediaId = (await lane.one<{ id: string }>(sql`
      INSERT INTO media_asset (org_id, storage_key, storage_driver, content_type, size_bytes, sha256, filename)
      VALUES (${lane.orgId}, ${`antiban-lane/${lane.orgId}.jpg`}, 'filesystem', 'image/jpeg', ${bytes.byteLength}, ${randomUUID()}, 'p.jpg')
      RETURNING id`)).id;
    const p = await lane.contact({ inbound: 'old' });
    await lane.queue(p.conversationId, 'our new range, have a look', { mediaId });
    await lane.drain({ storage: store });

    expect(lane.provider.sent).toHaveLength(1);
    const content = lane.provider.sent[0]!.content;
    expect(content.kind === 'freeform' && content.body).toBe('our new range, have a look');
    expect(content.kind === 'freeform' && content.media?.contentType).toBe('image/jpeg');
  });
});

describe('AC-1.6 presence', () => {
  it('AC-1.6 goes available before the first send of a run and unavailable after 90 s with nothing sent; one run, one available', async () => {
    for (let i = 0; i < 3; i++) {
      const p = await lane.contact({ inbound: 'old' });
      await lane.queue(p.conversationId, `m${String(i)}`, { createdAt: t(i), gapMs: 10_000 });
    }
    await lane.drain();

    expect(lane.provider.presenceCalls.map((c) => c.state)).toEqual(['available', 'unavailable']);
    const [online, offline] = lane.provider.presenceCalls;
    expect(online!.at.getTime()).toBeLessThanOrEqual(lane.provider.sent[0]!.at.getTime());
    expect(offline!.at.getTime() - lane.provider.sent[2]!.at.getTime()).toBe(90_000);
  });

  it('AC-1.6 a second run after a long silence goes online again, and the number is never left online', async () => {
    const a = await lane.contact({ inbound: 'old' });
    await lane.queue(a.conversationId, 'run one', { gapMs: 1000 });
    await lane.drain();
    lane.clock.advance(600_000);
    const b = await lane.contact({ inbound: 'old' });
    await lane.queue(b.conversationId, 'run two', { gapMs: 1000 });
    await lane.drain();

    expect(lane.provider.presenceCalls.map((c) => c.state)).toEqual(['available', 'unavailable', 'available', 'unavailable']);
  });
});

describe('AC-1.7 read receipts', () => {
  const inbound = async (conversationId: string, contactPhone: string) => {
    void conversationId;
    return storeInboundMessage(lane.db, kms, {
      orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`,
      fromPhoneE164: contactPhone, fromProviderAddress: `${contactPhone.replace(/\D/g, '')}@s.whatsapp.net`,
      body: 'are you there?', contentType: 'text', receivedAt: new Date()
    });
  };

  it('AC-1.7 an inbound message is never marked read when it arrives', async () => {
    const p = await lane.contact();
    await inbound(p.conversationId, p.phone);
    await lane.drain();
    await sweepPendingWork(lane.ctx());
    expect(lane.provider.markReadCalls).toEqual([]);
    expect((await lane.one<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM message WHERE direction = 'inbound' AND read_marked_at IS NOT NULL AND org_id = ${lane.orgId}`)).n).toBe(0);
  });

  it('AC-1.7 it is marked read when an agent opens the chat, once', async () => {
    const p = await lane.contact();
    const stored = await inbound(p.conversationId, p.phone);
    const wamid = (await lane.one<{ id: string }>(sql`SELECT provider_message_id AS id FROM message WHERE id = ${stored.messageId!}`)).id;

    await requestRead(lane.db, lane.orgId, stored.conversationId);
    expect(await handleReadRequest(lane.ctx(), stored.conversationId)).toBe(1);
    expect(lane.provider.markReadCalls).toHaveLength(1);
    expect(lane.provider.markReadCalls[0]).toMatchObject({ providerMessageIds: [wamid], from: { phoneE164: p.phone } });

    // Asked again, nothing more is sent: it was already marked.
    await requestRead(lane.db, lane.orgId, stored.conversationId);
    expect(await handleReadRequest(lane.ctx(), stored.conversationId)).toBe(0);
    expect(lane.provider.markReadCalls).toHaveLength(1);
  });

  it('AC-1.7 the sweep finds a chat an agent opened while the gateway was down', async () => {
    const p = await lane.contact();
    const stored = await inbound(p.conversationId, p.phone);
    await requestRead(lane.db, lane.orgId, stored.conversationId);
    await sweepPendingWork(lane.ctx());
    expect(lane.provider.markReadCalls).toHaveLength(1);
  });

  it('AC-1.7 a reply marks the messages it answers read 3 to 20 s before it starts typing', async () => {
    const p = await lane.contact();
    const stored = await inbound(p.conversationId, p.phone);
    const wamid = (await lane.one<{ id: string }>(sql`SELECT provider_message_id AS id FROM message WHERE id = ${stored.messageId!}`)).id;
    await lane.queue(stored.conversationId, 'yes, I am here', { sentBy: 'agent', gapMs: 1000 });
    await lane.drain();

    expect(lane.provider.markReadCalls).toHaveLength(1);
    expect(lane.provider.markReadCalls[0]!.providerMessageIds).toEqual([wamid]);
    const lead = lane.provider.typingCalls[0]!.at.getTime() - lane.provider.markReadCalls[0]!.at.getTime();
    expect(lead).toBeGreaterThanOrEqual(3_000);
    expect(lead).toBeLessThanOrEqual(20_000);
  });
});

describe('AC-1.8 every decision is logged with its inputs', () => {
  it('AC-1.8 logs send, wait and hold at info, with the inputs the policy used', async () => {
    const known = await lane.contact({ inbound: 'old' });
    const fresh = await lane.contact();
    const camp = await campaign();
    await lane.queue(known.conversationId, 'first', { createdAt: t(1), gapMs: 30_000 });
    await lane.queue(known.conversationId, 'second', { createdAt: t(2), gapMs: 30_000 });
    const held = await lane.queue(fresh.conversationId, 'to a stranger', { sentBy: 'system', campaignId: camp, createdAt: t(3), gapMs: 1000 });
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, timelock_active, timelock_until)
      VALUES (${lane.senderId}, true, ${new Date(Date.now() + 3_600_000).toISOString()})
      ON CONFLICT (sender_identity_id) DO UPDATE SET timelock_active = true, timelock_until = EXCLUDED.timelock_until`);
    await lane.drain();

    const decisions = lane.logs.filter((l) => l.msg === 'anti-ban decision');
    expect(decisions.every((d) => d.level === 30)).toBe(true);
    const kinds = new Set(decisions.map((d) => d.decision));
    for (const k of ['send', 'wait', 'hold', 'type']) expect(kinds, k).toContain(k);
    const hold = decisions.find((d) => d.decision === 'hold')!;
    expect(hold).toMatchObject({ messageId: held, reason: 'timelock', priority: 'campaign', newChat: true, timelock: true });
    expect(hold.until).toBeTypeOf('string');
    const wait = decisions.find((d) => d.decision === 'wait')!;
    expect(wait).toMatchObject({ plannedGapMs: 30_000, priority: 'manual', newChat: false });
    expect(wait.waitMs).toBeTypeOf('number');
    expect(wait).toHaveProperty('lastSentAt');
  });
});

describe('AC-1.9 a failed send', () => {
  it('AC-1.9 is marked failed with the reason code send_error and the provider message, and is never retried', async () => {
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'will fail');
    let attempts = 0;
    lane.provider.send = () => { attempts += 1; return Promise.reject(new Error('socket exploded')); };

    await lane.drain();
    expect(await lane.row(id)).toMatchObject({ status: 'failed', code: 'send_error', detail: 'socket exploded' });
    await sweepPendingWork(lane.ctx());
    await lane.drain();
    expect(attempts).toBe(1);
    expect((await lane.row(id)).status).toBe('failed');
  });

  it('AC-1.9 one failed message does not stop the ones behind it', async () => {
    const bad = await lane.contact({ inbound: 'old' });
    const good = await lane.contact({ inbound: 'old' });
    lane.provider.refuse463.add(bad.phone);
    const failing = await lane.queue(bad.conversationId, 'bad', { createdAt: t(1), gapMs: 1000 });
    await lane.queue(good.conversationId, 'good', { createdAt: t(2), gapMs: 1000 });
    await lane.drain();
    expect((await lane.row(failing)).status).toBe('failed');
    expect(lane.sentBodies()).toEqual(['good']);
  });
});

describe('S8 holds never lose a message', () => {
  const lock = async (until: Date | null, active = true): Promise<void> => {
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, timelock_active, timelock_until)
      VALUES (${lane.senderId}, ${active}, ${until?.toISOString() ?? null})
      ON CONFLICT (sender_identity_id) DO UPDATE SET timelock_active = EXCLUDED.timelock_active, timelock_until = EXCLUDED.timelock_until`);
  };

  it('AC-8.1 every hold has a reason code and the time it is expected to lift, or null when it waits for something', async () => {
    const until = new Date(lane.clock.now().getTime() + 3_600_000);
    await lock(until);
    const stranger = await lane.contact();
    const held = await lane.queue(stranger.conversationId, 'held for the timelock', { gapMs: 1000 });
    const refused = await lane.contact({ inbound: 'old' });
    await lane.db.execute(sql`UPDATE conversation SET refused_463_at = now() WHERE id = ${refused.conversationId}`);
    const waiting = await lane.queue(refused.conversationId, 'held for 463', { gapMs: 1000 });

    await kickLane(lane.ctx(), lane.senderId);
    const a = await lane.row(held);
    expect(a.status).toBe('queued');
    expect(a.hold).toBe('timelock');
    expect(new Date(a.holdUntil!).getTime()).toBe(until.getTime());
    const b = await lane.row(waiting);
    expect(b.hold).toBe('refused_463');
    expect(b.holdUntil).toBeNull();
  });

  it('AC-8.2 when a hold lifts, the messages go in their original lane order, with the ones that were not held already gone', async () => {
    const until = new Date(lane.clock.now().getTime() + 3_600_000);
    await lock(until);
    const camp = await campaign();
    const known = await lane.contact({ inbound: 'old' });
    for (const [i, name] of ['A', 'B', 'C'].entries()) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, name, { sentBy: 'system', campaignId: camp, createdAt: t(i), gapMs: 1000 });
    }
    await lane.queue(known.conversationId, 'known contact', { sentBy: 'api', createdAt: t(5), gapMs: 1000 });

    const order = await lane.drain();
    // The known contact is not held by a timelock and goes first; A, B, C wait, then go oldest first once it ends.
    expect(order).toEqual(['known contact', 'A', 'B', 'C']);
    expect(lane.provider.sent[1]!.at.getTime()).toBeGreaterThanOrEqual(until.getTime());
  });

  it('AC-8.3 a gateway restart keeps every queued and held message and its reason, and they go when the hold lifts', async () => {
    const until = new Date(lane.clock.now().getTime() + 3_600_000);
    await lock(until);
    const ids: string[] = [];
    for (const [i, name] of ['A', 'B'].entries()) {
      const p = await lane.contact();
      ids.push(await lane.queue(p.conversationId, name, { createdAt: t(i), gapMs: 1000 }));
    }
    await kickLane(lane.ctx(), lane.senderId);

    // "Restart": a new database connection and a new context, nothing carried over in memory but the rows.
    const reborn = createDatabase(url, { max: 4 });
    try {
      for (const id of ids) {
        const row = (await reborn.execute(sql`SELECT status, hold_reason AS hold, hold_until AS until FROM message WHERE id = ${id}`)) as unknown as
          Array<{ status: string; hold: string; until: string }>;
        expect(row[0]).toMatchObject({ status: 'queued', hold: 'timelock' });
        expect(new Date(row[0]!.until).getTime()).toBe(until.getTime());
      }
      lane.clock.set(new Date(until.getTime() + 1000));
      await sweepPendingWork({ ...lane.ctx(), db: reborn });
      await lane.drain({ db: reborn });
      expect(lane.sentBodies()).toEqual(['A', 'B']);
    } finally {
      await reborn.$client.end();
    }
  });

  it('AC-8.3 a number that is not connected holds its messages with a reason and loses none', async () => {
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'nobody home');
    await kickLane(lane.ctx({ provider: new FakeChannelProvider() }), lane.senderId);
    expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'sender_not_connected' });
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
  });
});

describe('S9 the policy is a driver', () => {
  /** A policy that decides the same way every time, and counts how often it was asked. */
  function fixed(decision: Awaited<ReturnType<AntiBanPolicy['beforeSend']>>): AntiBanPolicy & { readonly asked: number } {
    let asked = 0;
    return {
      get asked() { return asked; },
      beforeSend: () => { asked += 1; return Promise.resolve(decision); },
      campaignBatch: () => 20
    };
  }

  it('AC-9.1 the gateway takes any policy: a fixed hold leaves the message queued with that reason, a fixed send lets it go', async () => {
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'driven');
    const until = new Date(lane.clock.now().getTime() + 60_000);
    await kickLane(lane.ctx({ antiBan: fixed({ action: 'hold', reason: 'quiet_hours', until }) }), lane.senderId);
    expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'quiet_hours' });

    await lane.drain({ antiBan: fixed({ action: 'send' }) });
    expect((await lane.row(id)).status).toBe('sent');
  });

  it('AC-9.1 a fixed wait is honoured by scheduling the lane, not by sleeping the whole wait', async () => {
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'driven wait');
    const policy = fixed({ action: 'wait', ms: 40_000 });
    const result = await kickLane(lane.ctx({ antiBan: policy }), lane.senderId);
    expect((await lane.row(id)).status).toBe('queued');
    expect(lane.scheduled[0]!.ms).toBe(38_000);
    expect(result.nextWakeAt!.getTime() - lane.clock.now().getTime()).toBe(38_000);
  });

  it('AC-9.2 a do-not-contact contact is refused without the policy being asked', async () => {
    const p = await lane.contact({ inbound: 'old' });
    await lane.db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${p.contactId}`);
    const id = await lane.queue(p.conversationId, 'to someone who asked us to stop');
    const policy = fixed({ action: 'send' });
    await kickLane(lane.ctx({ antiBan: policy }), lane.senderId);
    expect(lane.provider.sent).toHaveLength(0);
    expect(await lane.row(id)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
    expect(policy.asked).toBe(0);
  });

  it('AC-9.2 a number that is not connected holds the message whatever the policy would say', async () => {
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'nobody home');
    const policy = fixed({ action: 'send' });
    await kickLane(lane.ctx({ antiBan: policy, provider: new FakeChannelProvider() }), lane.senderId);
    expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'sender_not_connected' });
    expect(policy.asked).toBe(0);
  });

  it('AC-9.2 a message to the number itself is refused before the policy', async () => {
    const own = await lane.contact({ phone: lane.phone });
    const id = await lane.queue(own.conversationId, 'to myself');
    const policy = fixed({ action: 'send' });
    await kickLane(lane.ctx({ antiBan: policy }), lane.senderId);
    expect(await lane.row(id)).toMatchObject({ status: 'failed', code: 'own_number' });
    expect(policy.asked).toBe(0);
  });
});
