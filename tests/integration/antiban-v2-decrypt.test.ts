import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NormalisedRetryEvent } from '@crm/channels';
import { storeInboundMessage } from '@crm/core';
import {
  applyConnectionEvent, applyInboundEffects, applyRetryEvent, applyStatusEvent
} from '../../apps/gateway/src/work.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S5: never "Waiting for this message". A retry receipt means the contact's phone could not read what we sent. Baileys sends the
 * message again by itself; our job is to hold everything else for that contact, recreate the session if it happens twice, and stop the
 * whole number if it happens to several contacts at once.
 */
let lane: Lane;
beforeEach(async () => {
  lane = await makeLane();
  await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: new Date(lane.clock.now().getTime() - 60_000) });
});
afterEach(async () => { await lane.close(); });

const MIN = 60_000;
const campaign = async (): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now()) RETURNING id`)).id;

/** The contact's phone asks for a message again: emitted on the provider, taken off its stream and applied, the way the gateway does. */
async function retry(providerId: string, at: Date = lane.clock.now()): Promise<void> {
  lane.provider.emitRetry(lane.senderId, providerId, at);
  const it = lane.provider.retries()[Symbol.asyncIterator]();
  const { value } = await it.next();
  await applyRetryEvent(lane.ctx(), value as NormalisedRetryEvent);
}
const retryAt = async (conversationId: string) => (await lane.one<{ at: string | null }>(sql`
  SELECT decrypt_retry_at AS at FROM conversation WHERE id = ${conversationId}`)).at;
const messageRetries = async (id: string) => lane.one<{ n: number }>(sql`SELECT retry_requests AS n FROM message WHERE id = ${id}`);
const wave = async () => (await lane.one<{ at: string | null }>(sql`
  SELECT decrypt_wave_at AS at FROM channel_session WHERE sender_identity_id = ${lane.senderId}`)).at;

/** A known contact (wrote to us 3 days ago) and a message to them that went out a few minutes ago. */
async function contactWithSent() {
  const c = await lane.contact({ inbound: 'old' });
  const m = await lane.sent(c.conversationId, { agoMs: 4 * MIN });
  return { ...c, m };
}

describe('AC-5.1 a retry receipt holds that contact', () => {
  it('AC-5.1 holds every new send to that contact (decrypt_retry) and nobody else; the message is not sent again by us', async () => {
    const a = await contactWithSent();
    const b = await lane.contact({ inbound: 'old' });
    await retry(a.m.providerId);

    expect(await retryAt(a.conversationId)).not.toBeNull();
    expect((await messageRetries(a.m.id)).n).toBe(1);

    const toA = await lane.queue(a.conversationId, 'to a');
    await lane.queue(b.conversationId, 'to b');
    const order = await lane.drain();

    expect(order).toEqual(['to b']);
    expect(await lane.row(toA)).toMatchObject({ status: 'queued', hold: 'decrypt_retry', holdUntil: null });
    expect(lane.provider.sent.filter((s) => s.to.phoneE164 === a.phone)).toEqual([]);
  });

  it('AC-5.1 a retry for a message this CRM did not send is ignored', async () => {
    const a = await contactWithSent();
    await retry('wamid.not-ours');
    expect(await retryAt(a.conversationId)).toBeNull();
  });
});

describe('AC-5.2 the hold lifts', () => {
  const deliveredAt = (providerId: string, at: Date) => applyStatusEvent(lane.ctx(), {
    providerMessageId: providerId, senderId: lane.senderId, status: 'delivered', errorCode: null, at
  });

  it('AC-5.2 on a delivered receipt that comes after the retry', async () => {
    const a = await contactWithSent();
    const retryTime = new Date(lane.clock.now().getTime() - MIN);
    await retry(a.m.providerId, retryTime);
    const queued = await lane.queue(a.conversationId, 'to a');
    expect(await lane.drain()).toEqual([]);

    // The receipt runs the lane (the gateway does the same), so the held message goes then.
    await deliveredAt(a.m.providerId, new Date(retryTime.getTime() + 20_000));
    expect(await retryAt(a.conversationId)).toBeNull();
    await lane.drain();
    expect(lane.sentBodies()).toEqual(['to a']);
    expect((await lane.row(queued)).status).toBe('sent');
  });

  it('AC-5.2 on a read receipt too', async () => {
    const a = await contactWithSent();
    const retryTime = new Date(lane.clock.now().getTime() - MIN);
    await retry(a.m.providerId, retryTime);
    await applyStatusEvent(lane.ctx(), { providerMessageId: a.m.providerId, senderId: lane.senderId, status: 'read', errorCode: null, at: new Date(retryTime.getTime() + 5_000) });
    expect(await retryAt(a.conversationId)).toBeNull();
  });

  it('AC-5.2 not on a receipt that was sent before the retry', async () => {
    const a = await contactWithSent();
    const retryTime = lane.clock.now();
    await retry(a.m.providerId, retryTime);
    await deliveredAt(a.m.providerId, new Date(retryTime.getTime() - 10_000));
    expect(await retryAt(a.conversationId)).not.toBeNull();
  });

  it('AC-5.2 on a message from the contact that decrypts', async () => {
    const a = await contactWithSent();
    await retry(a.m.providerId);
    const queued = await lane.queue(a.conversationId, 'to a');
    expect(await lane.drain()).toEqual([]);

    const stored = await storeInboundMessage(lane.db, kms, {
      orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.in-${a.m.id}`, fromPhoneE164: a.phone,
      fromProviderAddress: `${a.phone.replace(/\D/g, '')}@s.whatsapp.net`, body: 'hello', contentType: 'text', receivedAt: lane.clock.now()
    });
    await applyInboundEffects(lane.ctx(), { senderId: lane.senderId, conversationId: stored.conversationId, messageId: stored.messageId, body: 'hello', contentType: 'text' });

    expect(await retryAt(a.conversationId)).toBeNull();
    await lane.drain();
    expect(lane.sentBodies()).toEqual(['to a']);
    expect((await lane.row(queued)).status).toBe('sent');
  });
});

describe('AC-5.3 a second retry for the same message', () => {
  it('AC-5.3 the first retry leaves the session alone; the second recreates it, the hold stays, and the composer warning is raised', async () => {
    const a = await contactWithSent();
    await retry(a.m.providerId);
    expect(lane.provider.sessionResets).toEqual([]);

    await retry(a.m.providerId, new Date(lane.clock.now().getTime() + 30_000));
    expect(lane.provider.sessionResets).toHaveLength(1);
    expect(lane.provider.sessionResets[0]).toMatchObject({ senderId: lane.senderId, to: { phoneE164: a.phone } });
    expect((await messageRetries(a.m.id)).n).toBe(2);
    expect(await retryAt(a.conversationId)).not.toBeNull();

    // The warning the composer already shows for a broken encryption session reads decrypt_burst_at (sender-status → sessionTrouble).
    const burst = await lane.one<{ recent: boolean }>(sql`
      SELECT coalesce(decrypt_burst_at > now() - interval '15 minutes', false) AS recent FROM channel_session WHERE sender_identity_id = ${lane.senderId}`);
    expect(burst.recent).toBe(true);

    await lane.queue(a.conversationId, 'to a');
    expect(await lane.drain()).toEqual([]);
  });

  it('AC-5.3 a session that cannot be reset on this provider still holds and warns', async () => {
    const a = await contactWithSent();
    (lane.provider as unknown as { resetSession?: unknown }).resetSession = undefined;
    await retry(a.m.providerId);
    await retry(a.m.providerId, new Date(lane.clock.now().getTime() + 30_000));
    expect(await retryAt(a.conversationId)).not.toBeNull();
  });
});

describe('AC-5.4 a wave of retries holds the number', () => {
  async function retriesFrom(n: number, spacingMs: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const c = await contactWithSent();
      await retry(c.m.providerId, new Date(lane.clock.now().getTime() + i * spacingMs));
    }
  }

  it('AC-5.4 retries from 3 different contacts within 10 minutes hold the whole number (decrypt_wave) and record a health event', async () => {
    await retriesFrom(3, 2 * MIN);
    expect(await wave()).not.toBeNull();
    const events = (await lane.db.execute(sql`
      SELECT severity, summary FROM sender_health_event WHERE sender_identity_id = ${lane.senderId} AND kind = 'decrypt_wave'`)) as unknown as Array<{ severity: string }>;
    expect(events).toHaveLength(1);

    const known = await lane.contact({ inbound: 'old' });
    const fresh = await lane.contact();
    const camp = await campaign();
    const ids = [await lane.queue(known.conversationId, 'to known'), await lane.queue(fresh.conversationId, 'to new', { campaignId: camp })];
    expect(await lane.drain()).toEqual([]);
    for (const id of ids) expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'decrypt_wave', holdUntil: null });
  });

  it('AC-5.4 two contacts are not a wave', async () => {
    await retriesFrom(2, 2 * MIN);
    expect(await wave()).toBeNull();
  });

  it('AC-5.4 three contacts spread over more than 10 minutes are not a wave', async () => {
    await retriesFrom(3, 6 * MIN);
    expect(await wave()).toBeNull();
  });

  it('AC-5.4 one contact asking again and again is not a wave', async () => {
    const a = await contactWithSent();
    for (let i = 0; i < 4; i++) await retry(a.m.providerId, new Date(lane.clock.now().getTime() + i * 1000));
    expect(await wave()).toBeNull();
  });

  it('AC-5.4 stays held until the number is relinked, then the held messages go', async () => {
    await retriesFrom(3, 1 * MIN);
    const known = await lane.contact({ inbound: 'old' });
    await lane.queue(known.conversationId, 'to known');
    expect(await lane.drain()).toEqual([]);

    // A reconnect is not a relink: the hold stays.
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'closed', reason: 'connection_closed', at: lane.clock.now() });
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: lane.clock.now() });
    expect(await lane.drain()).toEqual([]);

    // Logged out and linked again: a fresh session.
    lane.clock.advance(10 * MIN);
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'logged_out', reason: 'logged_out', at: lane.clock.now() });
    lane.clock.advance(MIN);
    await lane.provider.connect({ id: lane.senderId, phoneE164: lane.phone });         // the new session comes up on the provider
    await applyConnectionEvent(lane.ctx(), { senderId: lane.senderId, state: 'open', reason: null, at: lane.clock.now() });
    await lane.drain();
    expect(lane.sentBodies()).toEqual(['to known']);
  });
});

describe('AC-5.5 nothing automatic goes to a contact with a retry not yet resolved', () => {
  it('AC-5.5 a campaign message and an AI message to that contact both wait; the next contact is not affected', async () => {
    const a = await contactWithSent();
    const b = await lane.contact({ inbound: 'old' });
    await retry(a.m.providerId);
    const camp = await campaign();
    const viaCampaign = await lane.queue(a.conversationId, 'campaign', { campaignId: camp });
    const viaAi = await lane.queue(a.conversationId, 'ai', { sentBy: 'agent' });
    await lane.queue(b.conversationId, 'to b', { campaignId: camp });

    expect(await lane.drain()).toEqual(['to b']);
    expect((await lane.row(viaCampaign)).hold).toBe('decrypt_retry');
    expect((await lane.row(viaAi)).hold).toBe('decrypt_retry');
  });
});
