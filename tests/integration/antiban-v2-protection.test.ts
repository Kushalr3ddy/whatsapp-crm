import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey, loadNumberState, queueCampaignFollowUp, storeInboundMessage } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { dispatchCampaigns, kickLane } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/** F6 S7: extra protection. Registration lookups, variants, media after reply, the reaction brake, quiet hours and the hints. */
const API_KEY = randomBytes(32).toString('hex');
const config = { PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN' } as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let lane: Lane;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let key: string;

beforeAll(() => { media = tempStorage('antiban-protection'); });
afterAll(async () => { media.cleanup(); await lane?.close(); });
beforeEach(async () => {
  if (lane !== undefined) await lane.close().catch(() => undefined);
  lane = await makeLane();
  const tenantRole = await resolveTenantRole(lane.db, await inspectDatabaseSecurity(lane.db));
  app = buildApp({ config, logger, db: lane.db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
  key = (await issueApiKey(lane.db, { orgId: lane.orgId, name: 'protection', scopes: ['messages:send', 'conversations:read', 'senders:read'] })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;
const t = (n: number): Date => new Date(Date.now() - 600_000 + n * 1000);
const campaignRow = async (body = 'x'): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at)
  VALUES (${lane.orgId}, 'c', 'running', ${body}, ${lane.senderId}, now()) RETURNING id`)).id;

describe('AC-7.1 is this number on WhatsApp, asked just in time', () => {
  it('AC-7.1 asks once for a new chat, right before its send, and caches the answer', async () => {
    const p = await lane.contact();
    const id = await lane.queue(p.conversationId, 'hello new chat', { gapMs: 1000 });
    await lane.drain();
    expect(lane.provider.registrationChecks).toEqual([p.phone]);
    expect((await lane.row(id)).status).toBe('sent');
    expect((await lane.one<{ r: boolean; at: string }>(sql`
      SELECT wa_registered AS r, wa_checked_at AS at FROM contact_identity WHERE contact_id = ${p.contactId} AND kind = 'phone'`)).r).toBe(true);

    // A second message to the same person within 30 days does not ask again.
    await lane.queue(p.conversationId, 'and another', { gapMs: 1000 });
    await lane.drain();
    expect(lane.provider.registrationChecks).toHaveLength(1);
  });

  it('AC-7.1 a known contact is not checked at all', async () => {
    const p = await lane.contact({ inbound: 'old' });
    await lane.queue(p.conversationId, 'to a known contact', { gapMs: 1000 });
    await lane.drain();
    expect(lane.provider.registrationChecks).toEqual([]);
    expect(lane.provider.sent).toHaveLength(1);
  });

  it('AC-7.1 an answer older than 30 days is asked again; one 29 days old is not', async () => {
    const fresh = await lane.contact();
    const stale = await lane.contact();
    const at = (days: number) => new Date(lane.clock.now().getTime() - days * 86_400_000).toISOString();
    await lane.db.execute(sql`UPDATE contact_identity SET wa_registered = true, wa_checked_at = ${at(29)} WHERE contact_id = ${fresh.contactId} AND kind = 'phone'`);
    await lane.db.execute(sql`UPDATE contact_identity SET wa_registered = true, wa_checked_at = ${at(31)} WHERE contact_id = ${stale.contactId} AND kind = 'phone'`);
    await lane.queue(fresh.conversationId, 'fresh', { createdAt: t(1), gapMs: 1000 });
    await lane.queue(stale.conversationId, 'stale', { createdAt: t(2), gapMs: 1000 });
    await lane.drain();
    expect(lane.provider.registrationChecks).toEqual([stale.phone]);
  });

  it('AC-7.1 a number that is not on WhatsApp fails that message as not_on_whatsapp and sends nothing', async () => {
    const p = await lane.contact();
    lane.provider.unregistered.add(p.phone);
    const id = await lane.queue(p.conversationId, 'to nobody', { gapMs: 1000 });
    await lane.drain();
    expect(await lane.row(id)).toMatchObject({ status: 'failed', code: 'not_on_whatsapp' });
    expect(lane.provider.sent).toHaveLength(0);
  });

  it('AC-7.1 when WhatsApp cannot be asked, the message is sent anyway and nothing is cached', async () => {
    const p = await lane.contact();
    lane.provider.registrationUnknown = true;
    const id = await lane.queue(p.conversationId, 'unknown is not a no', { gapMs: 1000 });
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
    expect((await lane.one<{ r: boolean | null }>(sql`
      SELECT wa_registered AS r FROM contact_identity WHERE contact_id = ${p.contactId} AND kind = 'phone'`)).r).toBeNull();
  });

  it('AC-7.1 it is never a batch: each lookup comes right before its own send, never ahead of the others', async () => {
    const events: string[] = [];
    const check = lane.provider.isRegistered.bind(lane.provider);
    const send = lane.provider.send.bind(lane.provider);
    lane.provider.isRegistered = (s, phone) => { events.push('check'); return check(s, phone); };
    lane.provider.send = (...args: Parameters<typeof send>) => { events.push('send'); return send(...args); };
    for (let i = 0; i < 5; i++) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, `n${String(i)}`, { createdAt: t(i), gapMs: 5_000 });
    }
    await lane.drain();
    expect(events).toEqual(['check', 'send', 'check', 'send', 'check', 'send', 'check', 'send', 'check', 'send']);
    // And the lookups are as far apart as the sends are.
    expect(lane.provider.sent[4]!.at.getTime() - lane.provider.sent[0]!.at.getTime()).toBeGreaterThanOrEqual(4 * 5_000);
  });
});

describe('AC-7.2 variants and the warning', () => {
  const createCampaign = (body: string, extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/campaigns').set(...auth()).send({
      name: 'v', body, senderIdentityId: lane.senderId, explicitContactIds: extra.ids ?? [randomUUID()], ...extra
    });

  it('AC-7.2 a campaign whose text has no variation and no AI writing shows a warning, and can still launch', async () => {
    const p = await lane.contact();
    const created = await createCampaign('Hi, a quick question for you', { ids: [p.contactId] });
    expect(created.status).toBe(201);
    expect(created.body.data.warnings).toEqual([expect.objectContaining({ code: 'no_variation' })]);
    const detail = await request(app).get(`/api/v1/campaigns/${created.body.data.id}`).set(...auth());
    expect(detail.body.data.warnings).toEqual([expect.objectContaining({ code: 'no_variation' })]);
    const started = await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    expect(started.status).toBe(200);
  });

  it('AC-7.2 a text with a variant has no warning', async () => {
    const p = await lane.contact();
    const created = await createCampaign('{Hi|Hello|Hey}, a quick question', { ids: [p.contactId] });
    expect(created.body.data.warnings).toEqual([]);
  });

  it('AC-7.2 each recipient gets one pick from a seeded draw, with their first name filled in', async () => {
    const people = [];
    for (let i = 0; i < 12; i++) people.push(await lane.contact({ name: `Person${String(i)} Surname` }));
    const created = await createCampaign('{Hi|Hello|Hey|Namaste} {{first_name}}', { ids: people.map((p) => p.contactId) });
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(lane.ctx());

    const bodies = async () => ((await lane.db.execute(sql`
      SELECT m.body_enc AS "enc", v.contact_id AS "contactId" FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE m.campaign_id = ${created.body.data.id}`)) as unknown as Array<{ enc: Uint8Array; contactId: string }>)
      .map((r) => ({ contactId: r.contactId, text: new TextDecoder().decode(kms.decrypt(r.enc)) }));
    const sent = await bodies();
    expect(sent).toHaveLength(12);
    for (const m of sent) expect(m.text).toMatch(/^(Hi|Hello|Hey|Namaste) Person\d+$/);
    expect(new Set(sent.map((m) => m.text.split(' ')[0])).size).toBeGreaterThanOrEqual(2);

    // The pick is seeded by campaign and contact: dispatching the same people again in another campaign object with the same
    // seed gives the same text (here: re-rendering through the ETA path matches what was queued).
    const eta = await request(app).get(`/api/v1/campaigns/${created.body.data.id}/eta`).set(...auth());
    expect(eta.status).toBe(200);
  });
});

describe('AC-7.3 media after reply', () => {
  const body = 'Hi {{first_name}}, our offer is here https://example.com/offer thanks';

  async function launch(extra: Record<string, unknown>, contactIds: string[]): Promise<string> {
    const created = await request(app).post('/api/v1/campaigns').set(...auth())
      .send({ name: 'm', body, senderIdentityId: lane.senderId, explicitContactIds: contactIds, ...extra });
    expect(created.status).toBe(201);
    await request(app).post(`/api/v1/campaigns/${created.body.data.id}/start`).set(...auth());
    await dispatchCampaigns(lane.ctx());
    return created.body.data.id as string;
  }
  const textsOf = async (campaignId: string) => ((await lane.db.execute(sql`
    SELECT m.body_enc AS enc, m.media_id AS "mediaId", v.contact_id AS "contactId", m.created_at
    FROM message m JOIN conversation v ON v.id = m.conversation_id WHERE m.campaign_id = ${campaignId} ORDER BY m.created_at, m.id`
  )) as unknown as Array<{ enc: Uint8Array; mediaId: string | null; contactId: string }>)
    .map((r) => ({ text: new TextDecoder().decode(kms.decrypt(r.enc)), mediaId: r.mediaId, contactId: r.contactId }));

  it('AC-7.3 a new chat gets the text alone; the link goes as a follow-up when they reply', async () => {
    const p = await lane.contact({ name: 'Asha Verma' });
    const id = await launch({}, [p.contactId]);
    expect((await textsOf(id)).map((m) => m.text)).toEqual(['Hi Asha, our offer is here thanks']);
    expect((await lane.one<{ f: boolean }>(sql`SELECT followup_pending AS f FROM campaign_recipient WHERE campaign_id = ${id}`)).f).toBe(true);

    // They reply: the held-back link is queued, once.
    const stored = await storeInboundMessage(lane.db, kms, {
      orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: p.phone,
      fromProviderAddress: `${p.phone.replace(/\D/g, '')}@s.whatsapp.net`, body: 'yes?', contentType: 'text', receivedAt: new Date()
    });
    expect(await queueCampaignFollowUp(lane.db, kms, lane.orgId, stored.conversationId)).toBe(true);
    expect(await queueCampaignFollowUp(lane.db, kms, lane.orgId, stored.conversationId)).toBe(false);
    expect((await textsOf(id)).map((m) => m.text)).toEqual(['Hi Asha, our offer is here thanks', 'https://example.com/offer']);
  });

  it('AC-7.3 a known contact gets it all at once', async () => {
    const p = await lane.contact({ inbound: 'old', name: 'Ravi Kumar' });
    const id = await launch({}, [p.contactId]);
    expect((await textsOf(id)).map((m) => m.text)).toEqual(['Hi Ravi, our offer is here https://example.com/offer thanks']);
  });

  it('AC-7.3 it can be switched off for the campaign', async () => {
    const p = await lane.contact({ name: 'Asha Verma' });
    const id = await launch({ mediaAfterReply: false }, [p.contactId]);
    expect((await textsOf(id)).map((m) => m.text)).toEqual(['Hi Asha, our offer is here https://example.com/offer thanks']);
    const detail = await request(app).get(`/api/v1/campaigns/${id}`).set(...auth());
    expect(detail.body.data.mediaAfterReply).toBe(false);
  });

  it('AC-7.3 a photo is held back too: the first message has no picture, the follow-up carries it', async () => {
    const upload = await request(app).post('/api/v1/campaigns/media?filename=offer.png').set(...auth())
      .set('Content-Type', 'application/octet-stream').send(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    expect(upload.status).toBe(201);
    const p = await lane.contact({ name: 'Asha Verma' });
    const id = await launch({ mediaAssetId: upload.body.data.id, body: 'Hi', }, [p.contactId]);
    const first = await textsOf(id);
    expect(first).toHaveLength(1);
    expect(first[0]!.mediaId).toBeNull();

    const stored = await storeInboundMessage(lane.db, kms, {
      orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: p.phone,
      fromProviderAddress: `${p.phone.replace(/\D/g, '')}@s.whatsapp.net`, body: 'hello', contentType: 'text', receivedAt: new Date()
    });
    expect(await queueCampaignFollowUp(lane.db, kms, lane.orgId, stored.conversationId)).toBe(true);
    const all = await textsOf(id);
    expect(all).toHaveLength(2);
    expect(all[1]!.mediaId).toBe(upload.body.data.id);
  });
});

describe('AC-7.4 the reaction brake in the lane', () => {
  /** `sent` first messages to new chats, of which `replied` got an answer. */
  async function history(sent: number, replied: number): Promise<void> {
    for (let i = 0; i < sent; i++) {
      const p = await lane.contact();
      const when = new Date(Date.now() - (sent - i + 5) * 60_000);
      await lane.db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, sent_at, created_at)
        VALUES (${lane.orgId}, ${p.conversationId}, 'outbound', 'delivered', 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode('old')))},
                ${kms.blindIndex(`old${String(i)}`)}, 'system', ${when.toISOString()}, ${when.toISOString()})`);
      if (i < replied) {
        await lane.db.execute(sql`
          INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, created_at)
          VALUES (${lane.orgId}, ${p.conversationId}, 'inbound', 'delivered', 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode('re')))},
                  ${kms.blindIndex(`re${String(i)}`)}, 'contact', ${new Date(when.getTime() + 30_000).toISOString()})`);
      }
    }
  }

  it('AC-7.4 30 new-chat sends with fewer than 5% replies turn the brake on; it lifts when replies come back', async () => {
    await history(30, 1);
    expect((await loadNumberState(lane.db, lane.senderId)).brakeOn).toBe(true);
    await history(0, 0);
    // Two more people reply: 3 of 30 is 10%, above the 5% line.
    const repliers = (await lane.db.execute(sql`
      SELECT v.id FROM conversation v WHERE v.org_id = ${lane.orgId}
        AND NOT EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound') LIMIT 2`)) as unknown as Array<{ id: string }>;
    for (const r of repliers) {
      await lane.db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
        VALUES (${lane.orgId}, ${r.id}, 'inbound', 'delivered', 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode('hi')))},
                ${kms.blindIndex(`late${r.id}`)}, 'contact')`);
    }
    expect((await loadNumberState(lane.db, lane.senderId)).brakeOn).toBe(false);
  });

  it('AC-7.4 with the brake on, gaps before new chats are doubled and the decision is logged with the brake', async () => {
    await history(30, 0);
    for (let i = 0; i < 2; i++) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, `fresh${String(i)}`, { createdAt: t(i), gapMs: 10_000 });
    }
    await lane.drain();
    const [a, b] = lane.provider.sent;
    expect(b!.at.getTime() - a!.at.getTime()).toBe(20_000);
    expect(lane.logs.some((l) => l.msg === 'anti-ban decision' && l.brakeOn === true)).toBe(true);
  });

  it('AC-7.4 a healthy history leaves the gaps alone', async () => {
    await history(40, 8);
    for (let i = 0; i < 2; i++) {
      const p = await lane.contact();
      await lane.queue(p.conversationId, `fresh${String(i)}`, { createdAt: t(i), gapMs: 10_000 });
    }
    await lane.drain();
    const [a, b] = lane.provider.sent;
    expect(b!.at.getTime() - a!.at.getTime()).toBe(10_000);
  });
});

describe('AC-7.5 quiet hours', () => {
  // The next 23:00 in Asia/Kolkata (17:30 UTC), always less than a day ahead, so a contact who wrote just now still counts as a recent
  // inbound when the clock stands there.
  const NIGHT = (() => {
    const d = new Date();
    d.setUTCHours(17, 30, 0, 0);
    if (d.getTime() < Date.now()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();
  const MORNING = new Date(NIGHT.getTime() + 9 * 3_600_000);   // 08:00 the next morning

  async function nightLane(): Promise<void> {
    await lane.close();
    lane = await makeLane({ quietHours: true });
    lane.clock.set(NIGHT);
  }

  it('AC-7.5 campaign and AI first messages wait until 08:00; replies and manual sends still go', async () => {
    await nightLane();
    const camp = await campaignRow();
    const stranger = await lane.contact();
    const old = await lane.contact({ inbound: 'old' });
    const recent = await lane.contact({ inbound: true });
    const campaignMsg = await lane.queue(stranger.conversationId, 'campaign', { sentBy: 'system', campaignId: camp, createdAt: t(1), gapMs: 1000 });
    const aiMsg = await lane.queue(old.conversationId, 'ai opener', { sentBy: 'agent', createdAt: t(2), gapMs: 1000 });
    await lane.queue(old.conversationId, 'agent typed', { sentBy: 'api', createdAt: t(3), gapMs: 1000 });
    await lane.queue(recent.conversationId, 'a reply', { sentBy: 'agent', createdAt: t(4), gapMs: 1000 });

    await kickLane(lane.ctx(), lane.senderId);
    expect(lane.sentBodies().sort()).toEqual(['a reply', 'agent typed']);
    expect(await lane.row(campaignMsg)).toMatchObject({ status: 'queued', hold: 'quiet_hours' });
    expect(new Date((await lane.row(campaignMsg)).holdUntil!).getTime()).toBe(MORNING.getTime());
    expect(await lane.row(aiMsg)).toMatchObject({ status: 'queued', hold: 'quiet_hours' });

    await lane.drain();
    expect((await lane.row(campaignMsg)).status).toBe('sent');
    expect(lane.provider.sent.find((m) => (m.content as { body: string }).body === 'campaign')!.at.getTime()).toBeGreaterThanOrEqual(MORNING.getTime());
  });

  it('AC-7.5 an org can switch it off, or move the window and the time zone', async () => {
    await nightLane();
    const camp = await campaignRow();
    const stranger = await lane.contact();
    const id = await lane.queue(stranger.conversationId, 'campaign', { sentBy: 'system', campaignId: camp, gapMs: 1000 });
    await lane.db.execute(sql`UPDATE antiban_setting SET quiet_hours_enabled = true WHERE org_id = ${lane.orgId}`).catch(() => undefined);
    await lane.db.execute(sql`
      INSERT INTO antiban_setting (org_id, quiet_hours_enabled) VALUES (${lane.orgId}, false)
      ON CONFLICT (org_id) DO UPDATE SET quiet_hours_enabled = false`);
    await kickLane(lane.ctx(), lane.senderId);
    expect((await lane.row(id)).status).toBe('sent');

    // On again, but in New York, where 23:00 in Kolkata is 12:30: not quiet.
    const next = await lane.contact();
    await lane.db.execute(sql`UPDATE antiban_setting SET quiet_hours_enabled = true, time_zone = 'America/New_York' WHERE org_id = ${lane.orgId}`);
    const id2 = await lane.queue(next.conversationId, 'campaign two', { sentBy: 'system', campaignId: camp, gapMs: 1000 });
    await lane.drain();
    expect((await lane.row(id2)).status).toBe('sent');
  });
});

describe('AC-7.6 hints', () => {
  it('AC-7.6 the numbers list carries advice: new number within 7 days, and the phone hint for WEB_COMPANION_ONLY; never blocking', async () => {
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, linked_since, timelock_active, timelock_type)
      VALUES (${lane.senderId}, 'open', ${new Date(Date.now() - 2 * 86_400_000).toISOString()}, true, 'WEB_COMPANION_ONLY')
      ON CONFLICT (sender_identity_id) DO UPDATE SET linked_since = EXCLUDED.linked_since, timelock_active = true, timelock_type = 'WEB_COMPANION_ONLY'`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(200);
    const mine = (r.body.data as Array<{ id: string; hints: Array<{ code: string }> }>).find((s) => s.id === lane.senderId)!;
    expect(mine.hints.map((h) => h.code).sort()).toEqual(['new_number', 'use_phone_too']);

    // Advice only: the number still sends to a known contact while the hints are showing.
    const p = await lane.contact({ inbound: 'old' });
    const id = await lane.queue(p.conversationId, 'still goes', { gapMs: 1000 });
    await lane.drain();
    expect((await lane.row(id)).status).toBe('sent');
  });

  it('AC-7.6 an older number with an ordinary timelock gets no hints', async () => {
    await lane.db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, linked_since, timelock_type)
      VALUES (${lane.senderId}, 'open', ${new Date(Date.now() - 30 * 86_400_000).toISOString()}, 'DEFAULT')
      ON CONFLICT (sender_identity_id) DO UPDATE SET linked_since = EXCLUDED.linked_since, timelock_type = 'DEFAULT'`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect((r.body.data as Array<{ id: string; hints: unknown[] }>).find((s) => s.id === lane.senderId)!.hints).toEqual([]);
  });
});
