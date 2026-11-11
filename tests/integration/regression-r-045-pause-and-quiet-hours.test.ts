import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { kickLane } from '../../apps/gateway/src/work.js';
import { makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * R-045 (2026-11-10, area: campaigns, found by: live run on four phones): Pause only flipped the campaign's status, so the messages the
 * dispatcher had already queued (the whole batch, within seconds of Start) kept going out. A paused campaign's queued messages wait now.
 *
 * R-049 (same run, area: anti-ban): a campaign's opening to someone who had written to the number in the last 24 hours was filed as a
 * "reply", and quiet hours only hold campaign and AI messages, so it went out at night. Whether a person wrote lately does not make a
 * campaign's own message a reply. What the campaign queued after they wrote (the held picture) still is one.
 */
let lane: Lane;
beforeEach(async () => { lane = await makeLane(); });
afterEach(async () => { await lane.close(); });

const campaignRow = async (status = 'running'): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', ${status}, 'x', ${lane.senderId}, now()) RETURNING id`)).id;
const setStatus = (id: string, status: string) => lane.db.execute(sql`UPDATE campaign SET status = ${status} WHERE id = ${id}`);
/** The campaign's own message to this person: the one its recipient row points at, the way the dispatcher queues it. */
async function opening(campaignId: string, c: { contactId: string; conversationId: string }, body: string, gapMs = 1000): Promise<string> {
  const id = await lane.queue(c.conversationId, body, { sentBy: 'system', campaignId, gapMs });
  await lane.db.execute(sql`
    INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status, message_id) VALUES (${lane.orgId}, ${campaignId}, ${c.contactId}, 'queued', ${id})`);
  return id;
}

describe('[R-045] pausing a campaign', () => {
  it('[R-045] messages already queued for a paused campaign are not sent, and are still queued', async () => {
    const camp = await campaignRow();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(await opening(camp, await lane.contact(), `hello ${String(i)}`));
    await setStatus(camp, 'paused');

    await lane.drain();
    expect(lane.sentBodies()).toEqual([]);
    for (const id of ids) expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'campaign_paused' });
  });

  it('[R-045] resuming releases them, each exactly once', async () => {
    const camp = await campaignRow();
    for (let i = 0; i < 3; i += 1) await opening(camp, await lane.contact(), `hello ${String(i)}`);
    await setStatus(camp, 'paused');
    await lane.drain();
    expect(lane.sentBodies()).toEqual([]);

    await setStatus(camp, 'running');
    await lane.drain();
    expect(lane.sentBodies().sort()).toEqual(['hello 0', 'hello 1', 'hello 2']);
  });

  it('[R-045] pausing one campaign does not hold a running campaign, a person\'s reply or a message that belongs to no campaign', async () => {
    const paused = await campaignRow('paused');
    const running = await campaignRow();
    const a = await lane.contact(); const b = await lane.contact(); const c = await lane.contact();
    await opening(paused, a, 'paused one');
    await opening(running, b, 'running one');
    await lane.queue(c.conversationId, 'typed by a person', { sentBy: 'api', gapMs: 1000 });
    await lane.drain();
    expect(lane.sentBodies().sort()).toEqual(['running one', 'typed by a person']);
  });

  it('[R-045] a message already handed to WhatsApp is left alone (nothing is sent twice)', async () => {
    const camp = await campaignRow();
    const p = await lane.contact();
    const id = await opening(camp, p, 'in flight');
    await lane.db.execute(sql`UPDATE message SET send_started_at = now() WHERE id = ${id}`);
    await setStatus(camp, 'paused');
    await lane.drain();
    expect(lane.sentBodies()).toEqual([]);
  });
});

describe('[R-049] quiet hours and a person who wrote lately', () => {
  // The next 23:00 in Asia/Kolkata (17:30 UTC), less than a day ahead, so someone who wrote just now still counts as a recent inbound.
  const NIGHT = (() => {
    const d = new Date();
    d.setUTCHours(17, 30, 0, 0);
    if (d.getTime() < Date.now()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();
  async function nightLane(): Promise<void> {
    await lane.close();
    lane = await makeLane({ quietHours: true });
    lane.clock.set(NIGHT);
  }

  it('[R-049] a campaign message to someone who wrote in the last 24 hours waits for the morning', async () => {
    await nightLane();
    const camp = await campaignRow();
    const wroteLately = await lane.contact({ inbound: true });
    const id = await opening(camp, wroteLately, 'campaign opening');
    await kickLane(lane.ctx(), lane.senderId);
    expect(lane.sentBodies()).toEqual([]);
    expect(await lane.row(id)).toMatchObject({ status: 'queued', hold: 'quiet_hours' });
  });

  it('[R-049] what the campaign queued after they wrote (the held picture) and a person\'s reply still go at night', async () => {
    await nightLane();
    const camp = await campaignRow();
    const wroteLately = await lane.contact({ inbound: true });
    // Not pointed at by any recipient row: this is the follow-up the gateway queues when they reply.
    await lane.queue(wroteLately.conversationId, 'the held link', { sentBy: 'system', campaignId: camp, gapMs: 1000 });
    const other = await lane.contact({ inbound: true });
    await lane.queue(other.conversationId, 'a reply', { sentBy: 'agent', gapMs: 1000 });
    await kickLane(lane.ctx(), lane.senderId);
    expect(lane.sentBodies().sort()).toEqual(['a reply', 'the held link']);
  });
});
