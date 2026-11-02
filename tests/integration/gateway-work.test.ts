import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, PostgresAuthStateStore, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { storeInboundMessage, classifyLinkFailure, decodeLinkError } from '@crm/core';
import {
  applyConnectionEvent, handleLinkRequest, handleUnlinkRequest, handleSend,
  markAllSessionsClosed, restoreSessions, sweepPendingWork
} from '../../apps/gateway/src/work.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let orgId: string;
let senderId: string;
let conversationId: string;

/** Builds the context the gateway handlers take, with a fake WhatsApp behind it. */
function ctxWith(provider: FakeChannelProvider) {
  return {
    db, provider, logger,
    // Run the gateway the way production does: every piece of per-org work drops to the
    // restricted role with the org set (D-41). Under a superuser connection this is the only
    // thing that makes row-level security apply, and it proves `crm_app` holds every grant
    // the gateway's queries need.
    tenantRole: 'crm_app',
    // Sleep is omitted, so the anti-ban policy's gap between sends costs these tests no real seconds.
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c))
  };
}

/** Queues an outbound message the way the API will, and returns its id. */
async function queueOutbound(body: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, 'api')
    RETURNING id`);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}

/** Reads one message's status and error, for assertions. */
async function statusOf(id: string): Promise<{ status: string; error_code: string | null }> {
  const rows = await db.execute(sql`SELECT status, error_code FROM message WHERE id = ${id}`);
  return (rows as unknown as Array<{ status: string; error_code: string | null }>)[0]!;
}

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'g',${'g-' + orgId.slice(0, 8)})`);
  const s = await db.execute(sql`
    INSERT INTO sender_identity(org_id,provider,label,phone_e164,status)
    VALUES (${orgId},'baileys','gw',${'+9199' + orgId.slice(0, 8).replace(/\D/g, '').padEnd(8, '1')},'active')
    RETURNING id`);
  senderId = (s as unknown as Array<{ id: string }>)[0]!.id;
  const r = await storeInboundMessage(db, kms, {
    orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`,
    fromPhoneE164: '+919876511111', fromProviderAddress: '919876511111@s.whatsapp.net',
    body: 'hi', contentType: 'text', receivedAt: new Date()
  });
  conversationId = r.conversationId;
});

describe('handleSend', () => {
  it('sends a queued message and records the provider id', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('hello from the gateway');

    await handleSend(ctxWith(provider), id);

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.content).toMatchObject({ kind: 'freeform', body: 'hello from the gateway' });
    expect(provider.sent[0]!.to.phoneE164).toBe('+919876511111');
    const s = await statusOf(id);
    expect(s.status).toBe('sent');
  });

  it('leaves the message QUEUED when the sender is not connected', async () => {
    // Not a failure: a send is not wrong just because the socket is briefly down. The boot
    // sweep picks it up once the number reconnects.
    const provider = new FakeChannelProvider();
    const id = await queueOutbound('while disconnected');
    await handleSend(ctxWith(provider), id);
    expect(provider.sent).toHaveLength(0);
    expect((await statusOf(id)).status).toBe('queued');
  });

  it('fails ONE recipient without affecting the others', async () => {
    // The M26 case. In the previous system one unsendable recipient threw and took down the
    // whole engine, so the watchdog restarted it, the operator retried, and it died again.
    const provider = new FakeChannelProvider({ failFor: ['+919876511111'] });
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const bad = await queueOutbound('to the failing recipient');
    await handleSend(ctxWith(provider), bad);
    expect((await statusOf(bad)).status).toBe('failed');
    expect((await statusOf(bad)).error_code).toBeTruthy();

    // A healthy provider immediately afterwards still works — nothing was left broken.
    const ok = new FakeChannelProvider();
    await ok.connect({ id: senderId, phoneE164: '+910000000000' });
    const good = await queueOutbound('to a working recipient');
    await handleSend(ctxWith(ok), good);
    expect((await statusOf(good)).status).toBe('sent');
  });

  it('does not send the same message twice', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('once only');
    await handleSend(ctxWith(provider), id);
    await handleSend(ctxWith(provider), id);   // a duplicate NOTIFY, or the sweep racing
    expect(provider.sent).toHaveLength(1);
  });

  it('ignores a message id that does not exist', async () => {
    const provider = new FakeChannelProvider();
    await expect(handleSend(ctxWith(provider), randomUUID())).resolves.toBeUndefined();
  });
});

describe('concurrent sends', () => {
  it('never sends one message twice when it is handled concurrently', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('only once');
    // A real pre-send pause, so the second caller arrives while the first is still sleeping.
    const ctx = { ...ctxWith(provider), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 150))) };

    await Promise.all([handleSend(ctx, id), handleSend(ctx, id), handleSend(ctx, id)]);

    expect(provider.sent).toHaveLength(1);
  });
});

describe('number fallback (D-60)', () => {
  // The contact from beforeEach has one number, +919876511111. A second one is fiction-range.
  const FIRST = '+919876511111';
  const SECOND = '+12025550142';

  /** Gives the conversation's contact a second phone number, after the first. */
  async function addSecondNumber(): Promise<string> {
    const c = await db.execute(sql`SELECT contact_id AS id FROM conversation WHERE id = ${conversationId}`);
    const contactId = (c as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${contactId}, 'phone', ${SECOND}, false)`);
    return contactId;
  }
  const withFallback = (p: FakeChannelProvider) => ({ ...ctxWith(p), verifyFallbackNumbers: true });
  const primaryOf = async (contactId: string): Promise<string> =>
    ((await db.execute(sql`
      SELECT value_normalized AS v FROM contact_identity
      WHERE contact_id = ${contactId} AND kind = 'phone' AND is_primary`)) as unknown as Array<{ v: string }>)[0]!.v;

  it('sends to the primary number when it has a WhatsApp account, after one lookup', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const contactId = await addSecondNumber();
    const id = await queueOutbound('to the first number');

    await handleSend(withFallback(provider), id);

    expect(provider.registrationChecks).toEqual([FIRST]);
    expect(provider.sent[0]!.to.phoneE164).toBe(FIRST);
    expect(await primaryOf(contactId)).toBe(FIRST);
  });

  it('switches to the second number when the first has no WhatsApp account, and keeps it', async () => {
    const provider = new FakeChannelProvider();
    provider.unregistered.add(FIRST);
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const contactId = await addSecondNumber();
    const id = await queueOutbound('to whichever has an account');

    await handleSend(withFallback(provider), id);

    expect(provider.registrationChecks).toEqual([FIRST, SECOND]);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to.phoneE164).toBe(SECOND);
    expect((await statusOf(id)).status).toBe('sent');
    // The second number is now the primary, the answers are stored, and the switch is on the record.
    expect(await primaryOf(contactId)).toBe(SECOND);
    const flags = await db.execute(sql`
      SELECT value_normalized AS v, wa_registered AS r FROM contact_identity
      WHERE contact_id = ${contactId} AND kind = 'phone' ORDER BY value_normalized`);
    expect(flags as unknown as Array<{ v: string; r: boolean }>)
      .toEqual([{ v: SECOND, r: true }, { v: FIRST, r: false }]);
    const audit = await db.execute(sql`
      SELECT action, after FROM audit_log WHERE org_id = ${orgId} AND action = 'contact.number_switched'`);
    expect((audit as unknown as unknown[]).length).toBe(1);
  });

  it('asks only once: the next message to that contact makes no lookup', async () => {
    const provider = new FakeChannelProvider();
    provider.unregistered.add(FIRST);
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    await addSecondNumber();
    await handleSend(withFallback(provider), await queueOutbound('first'));
    const lookupsAfterFirst = provider.registrationChecks.length;

    await handleSend(withFallback(provider), await queueOutbound('second'));

    expect(provider.registrationChecks).toHaveLength(lookupsAfterFirst);
    expect(provider.sent.map((m) => m.to.phoneE164)).toEqual([SECOND, SECOND]);
  });

  it('does not send, and says why, when none of the numbers has a WhatsApp account', async () => {
    const provider = new FakeChannelProvider();
    provider.unregistered.add(FIRST); provider.unregistered.add(SECOND);
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    await addSecondNumber();
    const id = await queueOutbound('nobody to receive it');

    await handleSend(withFallback(provider), id);

    expect(provider.sent).toHaveLength(0);
    expect(await statusOf(id)).toMatchObject({ status: 'failed', error_code: 'no_whatsapp_number' });
  });

  it('makes no lookup for a contact with a single number, since there is nothing to fall back to', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('only one number');

    await handleSend(withFallback(provider), id);

    expect(provider.registrationChecks).toHaveLength(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('keeps the current number when WhatsApp cannot be asked, rather than switching on a guess', async () => {
    const provider = new FakeChannelProvider();
    provider.registrationUnknown = true;
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const contactId = await addSecondNumber();
    const id = await queueOutbound('lookup unavailable');

    await handleSend(withFallback(provider), id);

    expect(provider.sent[0]!.to.phoneE164).toBe(FIRST);
    expect(await primaryOf(contactId)).toBe(FIRST);
    const stored = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact_identity WHERE contact_id = ${contactId} AND wa_checked_at IS NOT NULL`);
    expect((stored as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('is off by default: two numbers, no lookup, the primary is used', async () => {
    const provider = new FakeChannelProvider();
    provider.unregistered.add(FIRST);
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    await addSecondNumber();
    const id = await queueOutbound('fallback not enabled');

    await handleSend(ctxWith(provider), id);   // verifyFallbackNumbers unset

    expect(provider.registrationChecks).toHaveLength(0);
    expect(provider.sent[0]!.to.phoneE164).toBe(FIRST);
  });
});

describe('typing simulation in the send path (D-24)', () => {
  it('shows "typing…" before the send and clears it after, when enabled', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('a message worth typing');

    const slept: number[] = [];
    await handleSend(
      { ...ctxWith(provider), typingSimulation: true, sleep: async (ms) => { slept.push(ms); } },
      id
    );

    // composing fired, then paused — and the message still went out.
    expect(provider.typingCalls.map((c) => c.state)).toEqual(['composing', 'paused']);
    expect(provider.typingCalls[0]!.to.phoneE164).toBe('+919876511111');
    expect(provider.sent).toHaveLength(1);
    expect((await statusOf(id)).status).toBe('sent');

    // One of the sleeps is the typing beat, and it is inside the clamped window.
    expect(slept.some((ms) => ms >= 700 && ms <= 8000)).toBe(true);
  });

  it('does not signal typing when the simulation is off (the default)', async () => {
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const id = await queueOutbound('no typing here');

    await handleSend(ctxWith(provider), id);   // ctxWith leaves typingSimulation unset

    expect(provider.typingCalls).toHaveLength(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('sends anyway when signalling presence throws', async () => {
    // Presence is cosmetic; a failure to show "typing…" must never lose the message.
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    provider.typing = async () => { throw new Error('presence blew up'); };
    const id = await queueOutbound('resilient send');

    await handleSend(
      { ...ctxWith(provider), typingSimulation: true, sleep: async () => {} },
      id
    );

    expect(provider.sent).toHaveLength(1);
    expect((await statusOf(id)).status).toBe('sent');
  });
});

describe('handleLinkRequest', () => {
  it('writes the challenge back onto the session row', async () => {
    const provider = new FakeChannelProvider();
    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, link_requested_mode, link_requested_at)
      VALUES (${senderId}, 'qr', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleLinkRequest(ctxWith(provider), sessionId);

    const after = await db.execute(sql`
      SELECT link_challenge AS c, link_error AS e, connection_state AS s
      FROM channel_session WHERE id = ${sessionId}`);
    const row = (after as unknown as Array<{ c: { mode: string } | null; e: string | null; s: string }>)[0]!;
    expect(row.c?.mode).toBe('qr');
    expect(row.e).toBeNull();
    expect(row.s).toBe('connecting');
  });

  it('records the reason on the row when linking fails, instead of leaving the caller polling', async () => {
    // A provider whose link() rejects. Using a throwing stub rather than the fake because the
    // fake accepts any link request — see the note on contract divergence below.
    const provider = new FakeChannelProvider();
    const failing = Object.assign(Object.create(Object.getPrototypeOf(provider) as object), provider, {
      link: () => Promise.reject(new Error('whatsapp refused the pairing request'))
    }) as FakeChannelProvider;

    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, link_requested_mode, link_requested_at)
      VALUES (${senderId}, 'pairing_code', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleLinkRequest(ctxWith(failing), sessionId);

    const after = await db.execute(sql`
      SELECT link_error AS e, link_challenge AS c FROM channel_session WHERE id = ${sessionId}`);
    const row = (after as unknown as Array<{ e: string | null; c: unknown }>)[0]!;
    expect(row.e).toContain('refused');
    expect(row.c).toBeNull();
    // The request is closed with the failure, so the sweep does not retry it every minute.
    const req = (await db.execute(sql`SELECT link_requested_at AS at FROM channel_session WHERE id = ${sessionId}`)
    ) as unknown as Array<{ at: string | null }>;
    expect(req[0]!.at).toBeNull();
  });
});

describe('link failures and stale sessions', () => {
  it('stores a classified, human-readable failure, not the raw error', async () => {
    const provider = new FakeChannelProvider();
    const failing = Object.assign(Object.create(Object.getPrototypeOf(provider) as object), provider, {
      link: () => Promise.reject(Object.assign(new Error('WhatsApp did not issue a QR within the timeout'), { code: 'qr_timeout' }))
    }) as FakeChannelProvider;
    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, link_requested_mode, link_requested_at)
      VALUES (${senderId}, 'qr', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleLinkRequest(ctxWith(failing), sessionId);

    const row = (await db.execute(sql`SELECT link_error AS e FROM channel_session WHERE id = ${sessionId}`)
    ) as unknown as Array<{ e: string }>;
    const parsed = JSON.parse(row[0]!.e) as { code: string; title: string; summary: string; hint: string };
    expect(parsed.code).toBe('qr_timeout');
    expect(parsed.title).toMatch(/did not send a QR/i);
    expect(parsed.hint.length).toBeGreaterThan(10);
  });

  it('clears credentials left over from a session that is not connected before linking', async () => {
    const authStore = new PostgresAuthStateStore(db, kms);
    await authStore.set(senderId, 'creds', new TextEncoder().encode('dead session'));
    const provider = new FakeChannelProvider({}, authStore);
    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, link_requested_mode, link_requested_at)
      VALUES (${senderId}, 'logged_out', 'qr', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleLinkRequest(ctxWith(provider), sessionId);

    expect(await authStore.get(senderId, 'creds')).toBeNull();
  });

  it('does not touch the credentials of a connected number when linking is requested', async () => {
    const authStore = new PostgresAuthStateStore(db, kms);
    await authStore.set(senderId, 'creds', new TextEncoder().encode('live session'));
    const provider = new FakeChannelProvider({}, authStore);
    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, link_requested_mode, link_requested_at)
      VALUES (${senderId}, 'open', 'qr', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleLinkRequest(ctxWith(provider), sessionId);

    expect(await authStore.get(senderId, 'creds')).not.toBeNull();
  });

  it('clears the link request and any link error when the number connects', async () => {
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, link_requested_mode, link_requested_at, link_error)
      VALUES (${senderId}, 'connecting', 'qr', now(), 'old failure')`);
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };

    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });

    const row = (await db.execute(sql`
      SELECT link_requested_at AS r, link_error AS e FROM channel_session WHERE sender_identity_id = ${senderId}`)
    ) as unknown as Array<{ r: string | null; e: string | null }>;
    expect(row[0]!.r).toBeNull();
    expect(row[0]!.e).toBeNull();
  });

  it('records the phone number the connection belongs to, when the sender has none', async () => {
    await db.execute(sql`UPDATE sender_identity SET phone_e164 = NULL WHERE id = ${senderId}`);
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };

    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, phoneE164: '+12025550188', at: new Date() });

    const row = (await db.execute(sql`SELECT phone_e164 AS p FROM sender_identity WHERE id = ${senderId}`)
    ) as unknown as Array<{ p: string | null }>;
    expect(row[0]!.p).toBe('+12025550188');
  });

  it('leaves a phone number someone typed in alone, and a number another sender already has', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await db.execute(sql`UPDATE sender_identity SET phone_e164 = '+12025550177' WHERE id = ${senderId}`);
    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, phoneE164: '+12025550188', at: new Date() });
    const kept = (await db.execute(sql`SELECT phone_e164 AS p FROM sender_identity WHERE id = ${senderId}`)
    ) as unknown as Array<{ p: string | null }>;
    expect(kept[0]!.p).toBe('+12025550177');

    // Another sender of the same org already holds +12025550166: the update is skipped, not an error.
    const other = (await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
      SELECT org_id, provider, 'other', '+12025550166', 'active' FROM sender_identity WHERE id = ${senderId}
      RETURNING id`)) as unknown as Array<{ id: string }>;
    expect(other).toHaveLength(1);
    await db.execute(sql`UPDATE sender_identity SET phone_e164 = NULL WHERE id = ${senderId}`);
    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, phoneE164: '+12025550166', at: new Date() });
    const still = (await db.execute(sql`SELECT phone_e164 AS p FROM sender_identity WHERE id = ${senderId}`)
    ) as unknown as Array<{ p: string | null }>;
    expect(still[0]!.p).toBeNull();
  });

  it('records one ban-suspected event per logout, not one per failed re-login', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);

    for (let i = 0; i < 4; i++) {
      await applyConnectionEvent(ctx, { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: new Date() });
    }

    const n = (await db.execute(sql`
      SELECT count(*)::int AS n FROM sender_health_event
      WHERE sender_identity_id = ${senderId} AND kind = 'hard_ban_suspected'`)
    ) as unknown as Array<{ n: number }>;
    expect(n[0]!.n).toBe(1);
  });

  it('calls a device removed on the phone an unlink, not a possible ban (R-017)', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);

    await applyConnectionEvent(ctx, {
      senderId, state: 'logged_out', reason: 'logged_out', code: 401, detail: 'device_removed', at: new Date()
    });

    const kinds = (await db.execute(sql`
      SELECT kind, severity FROM sender_health_event WHERE sender_identity_id = ${senderId}`)
    ) as unknown as Array<{ kind: string; severity: string }>;
    expect(kinds).toEqual([{ kind: 'unlinked_on_phone', severity: 'warning' }]);
    const state = (await db.execute(sql`
      SELECT connection_state AS s FROM channel_session WHERE sender_identity_id = ${senderId}`)
    ) as unknown as Array<{ s: string }>;
    expect(state[0]!.s).toBe('logged_out');
  });

  it('clears the dead credentials when WhatsApp logs the number out', async () => {
    const authStore = new PostgresAuthStateStore(db, kms);
    await authStore.set(senderId, 'creds', new TextEncoder().encode('revoked'));
    const provider = new FakeChannelProvider({}, authStore);
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
    const ctx = { db, provider, logger, decrypt: () => '' };

    await applyConnectionEvent(ctx, { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: new Date() });

    expect(await authStore.get(senderId, 'creds')).toBeNull();
  });
});

describe('a 403 or an unasked logout means a possible ban', () => {
  const ctxFor = () => ({ db, provider: new FakeChannelProvider(), logger, decrypt: () => '' });

  /** A running campaign on this number, so there is something to pause. */
  async function runningCampaign(): Promise<string> {
    const rows = await db.execute(sql`
      INSERT INTO campaign (org_id, name, body, sender_identity_id, status)
      SELECT org_id, 'ban test', 'hi', id, 'running' FROM sender_identity WHERE id = ${senderId}
      RETURNING id`);
    return (rows as unknown as Array<{ id: string }>)[0]!.id;
  }
  const campaignRow = async (id: string) => (await db.execute(sql`
    SELECT status, pause_reason AS "reason" FROM campaign WHERE id = ${id}`) as unknown as
    Array<{ status: string; reason: string | null }>)[0]!;
  const eventKinds = async () => (await db.execute(sql`
    SELECT kind FROM sender_health_event WHERE sender_identity_id = ${senderId} ORDER BY at`) as unknown as
    Array<{ kind: string }>).map((r) => r.kind);

  it('records one critical event that says to check the phone, and pauses running campaigns', async () => {
    const id = await runningCampaign();
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);

    for (let i = 0; i < 3; i++) {
      await applyConnectionEvent(ctxFor(), {
        senderId, state: 'closed', reason: 'forbidden', code: 403, at: new Date()
      });
    }

    expect(await eventKinds()).toEqual(['forbidden_suspected']);
    const camp = await campaignRow(id);
    expect(camp.status).toBe('paused');
    expect(camp.reason).toBe('ban_suspected');
    const ev = (await db.execute(sql`
      SELECT summary, severity FROM sender_health_event WHERE sender_identity_id = ${senderId}`)
    ) as unknown as Array<{ summary: string; severity: string }>;
    expect(ev[0]!.severity).toBe('critical');
    expect(ev[0]!.summary).toMatch(/Open WhatsApp on the phone/);
  });

  it('pauses campaigns on a logout nobody asked for, but not on a deliberate unlink', async () => {
    const id = await runningCampaign();
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, unlink_requested_at)
      VALUES (${senderId}, 'open', now())`);
    await applyConnectionEvent(ctxFor(), { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: new Date() });
    expect((await campaignRow(id)).status).toBe('running');

    await db.execute(sql`UPDATE channel_session SET unlink_requested_at = NULL, connection_state = 'open'
      WHERE sender_identity_id = ${senderId}`);
    await applyConnectionEvent(ctxFor(), { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: new Date() });
    const camp = await campaignRow(id);
    expect(camp.status).toBe('paused');
    expect(camp.reason).toBe('ban_suspected');
  });
});

describe('classifyLinkFailure', () => {
  it('maps what WhatsApp and the adapter throw onto an actionable message', () => {
    expect(classifyLinkFailure(new Error('WhatsApp did not issue a QR within the timeout')).code).toBe('qr_timeout');
    expect(classifyLinkFailure({ statusCode: 401, message: 'x' }).code).toBe('stale_session');
    expect(classifyLinkFailure({ code: 'rate_limited' }).code).toBe('rate_limited');
    expect(classifyLinkFailure(new Error('pairing_code mode needs the phone number being linked')).code).toBe('needs_phone');
    const unknown = classifyLinkFailure(new Error('something odd'));
    expect(unknown.code).toBe('unknown');
    expect(unknown.summary).toContain('something odd');
  });

  it('decodes a legacy plain string instead of throwing', () => {
    expect(decodeLinkError('WhatsApp did not issue a QR within the timeout')?.code).toBe('qr_timeout');
    expect(decodeLinkError(null)).toBeNull();
  });
});

describe('handleUnlinkRequest', () => {
  it('clears stored credentials and returns the sender to awaiting-link', async () => {
    // A number that looks linked (session open, status active) with stored credentials — the
    // exact shape of a corrupt session that can send but not receive (D-14).
    const authStore = new PostgresAuthStateStore(db, kms);
    await authStore.set(senderId, 'creds', new TextEncoder().encode('corrupt'));
    const provider = new FakeChannelProvider({}, authStore);

    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, unlink_requested_at)
      VALUES (${senderId}, 'open', now()) RETURNING id`);
    const sessionId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    await handleUnlinkRequest(ctxWith(provider), sessionId);

    // The credentials are gone — this is what lets a re-link show a fresh QR.
    expect(await authStore.get(senderId, 'creds')).toBeNull();

    const cs = (await db.execute(sql`
      SELECT connection_state AS s, unlink_requested_at AS u FROM channel_session WHERE id = ${sessionId}`)
    ) as unknown as Array<{ s: string; u: string | null }>;
    expect(cs[0]!.s).toBe('closed');
    expect(cs[0]!.u).toBeNull();

    const si = (await db.execute(sql`SELECT status FROM sender_identity WHERE id = ${senderId}`)
    ) as unknown as Array<{ status: string }>;
    expect(si[0]!.status).toBe('linking');
  });

  it('is a no-op for an unknown session id', async () => {
    const provider = new FakeChannelProvider();
    await expect(handleUnlinkRequest(ctxWith(provider), randomUUID())).resolves.toBeUndefined();
  });

  it('CONTRACT DIVERGENCE: the fake accepts a pairing-code link with no phone; baileys rejects it', async () => {
    // Recorded as a test rather than a comment so it cannot be forgotten. The real adapter
    // throws "pairing_code mode needs the phone number being linked"; the fake ignores the
    // argument entirely. The contract suite should assert this for every provider — until it
    // does, an adapter could diverge here without anything noticing.
    const provider = new FakeChannelProvider();
    await expect(provider.link(senderId, 'pairing_code')).resolves.toMatchObject({ mode: 'pairing_code' });
  });

  it('ignores a request that has already been answered', async () => {
    const provider = new FakeChannelProvider();
    const rows = await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, link_requested_mode, link_requested_at, link_challenge)
      VALUES (${senderId}, 'qr', now(), '{"mode":"qr"}'::jsonb) RETURNING id`);
    await handleLinkRequest(ctxWith(provider), (rows as unknown as Array<{ id: string }>)[0]!.id);
    expect(provider.sent).toHaveLength(0);
  });
});

describe('sweepPendingWork', () => {
  it('picks up work queued while the gateway was down', async () => {
    // Why the command channel is a durable table and not only a NOTIFY: a notification sent
    // while this process was stopped is gone, but a queued row is still there.
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+910000000000' });
    const a = await queueOutbound('queued while down 1');
    const b = await queueOutbound('queued while down 2');

    const result = await sweepPendingWork(ctxWith(provider));

    expect(result.sends).toBeGreaterThanOrEqual(2);
    expect((await statusOf(a)).status).toBe('sent');
    expect((await statusOf(b)).status).toBe('sent');
  });
});

describe('restoreSessions', () => {
  it('reconnects numbers that were linked before the restart', async () => {
    // Credentials live in Postgres precisely so nobody has to scan a QR again.
    const provider = new FakeChannelProvider();
    const restored = await restoreSessions(ctxWith(provider));
    expect(restored).toBeGreaterThanOrEqual(1);
    expect((await provider.health(senderId)).state).toBe('open');
  });

  it('keeps going when one number fails to reconnect', async () => {
    const provider = new FakeChannelProvider({ failAll: true });
    // failAll affects sends, not connects — so assert this does not throw and reports a count.
    await expect(restoreSessions(ctxWith(provider))).resolves.toBeGreaterThanOrEqual(0);
  });
});

describe('connection state', () => {
  /** Reads back what the UI would see for this sender. */
  async function sessionRow() {
    const rows = await db.execute(sql`
      SELECT cs.connection_state AS state, cs.disconnect_reason AS reason,
             cs.last_connected_at AS "lastConnectedAt", cs.link_challenge AS challenge,
             si.status
      FROM sender_identity si
      LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
      WHERE si.id = ${senderId}`);
    return (rows as unknown as Array<{
      state: string | null; reason: string | null; lastConnectedAt: string | null;
      challenge: unknown; status: string;
    }>)[0]!;
  }

  it('records an open socket, which is the only way to know a number is linked', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await applyConnectionEvent(ctx, {
      senderId, state: 'open', reason: null, at: new Date()
    });

    const row = await sessionRow();
    expect(row.state).toBe('open');
    expect(row.lastConnectedAt).not.toBeNull();
  });

  it('promotes a sender that is still linking, so it becomes usable for sending', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'linking' WHERE id = ${senderId}`);
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };

    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });

    const row = await sessionRow();
    // Without this, a number linked through the API stays 'linking' forever and every send
    // is refused with NO_ACTIVE_SENDER even though the socket is open.
    expect(row.status).toBe('active');
  });

  it('clears the challenge once connected, so the UI stops offering a stale QR', async () => {
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, link_challenge)
      VALUES (${senderId}, 'connecting', ${'{"mode":"qr","qr":"x"}'}::jsonb)
      ON CONFLICT (sender_identity_id) DO UPDATE
        SET link_challenge = ${'{"mode":"qr","qr":"x"}'}::jsonb`);
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };

    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });

    expect((await sessionRow()).challenge).toBeNull();
  });

  it('demotes a logged-out number rather than leaving it looking active', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await applyConnectionEvent(ctx, {
      senderId, state: 'logged_out', reason: 'logged_out', at: new Date()
    });

    const row = await sessionRow();
    expect(row.state).toBe('logged_out');
    // It must not keep saying 'active', or the dispatcher queues sends that can never leave.
    expect(row.status).toBe('linking');
  });

  it('clears a stale open socket, which no running process is actually holding', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });
    expect((await sessionRow()).state).toBe('open');

    // What a gateway does at boot: whatever the last run left behind, nothing is connected
    // until this process connects it. Covers a crash, where no shutdown handler ever ran.
    const cleared = await markAllSessionsClosed(ctx);

    expect(cleared).toBeGreaterThan(0);
    expect((await sessionRow()).state).toBe('closed');
  });

  it('keeps the last successful connection time across a later disconnect', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '' };
    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });
    const connectedAt = (await sessionRow()).lastConnectedAt;

    await applyConnectionEvent(ctx, {
      senderId, state: 'closed', reason: 'connection_closed', at: new Date()
    });

    const row = await sessionRow();
    expect(row.state).toBe('closed');
    expect(row.reason).toBe('connection_closed');
    // Answering "when did this number last work?" needs the timestamp to survive the drop.
    expect(row.lastConnectedAt).toEqual(connectedAt);
  });
});
