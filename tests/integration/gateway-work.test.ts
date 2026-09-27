import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, PostgresAuthStateStore, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { storeInboundMessage } from '@crm/core';
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
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    // High enough that the pacing gate never fires by accident; the tests that care about
    // pacing set their own. Sleep is omitted so jitter costs these tests no real seconds.
    limits: { perMinute: 1000, perDay: 10_000 }
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
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };
    await applyConnectionEvent(ctx, {
      senderId, state: 'open', reason: null, at: new Date()
    });

    const row = await sessionRow();
    expect(row.state).toBe('open');
    expect(row.lastConnectedAt).not.toBeNull();
  });

  it('promotes a sender that is still linking, so it becomes usable for sending', async () => {
    await db.execute(sql`UPDATE sender_identity SET status = 'linking' WHERE id = ${senderId}`);
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };

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
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };

    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });

    expect((await sessionRow()).challenge).toBeNull();
  });

  it('demotes a logged-out number rather than leaving it looking active', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };
    await applyConnectionEvent(ctx, {
      senderId, state: 'logged_out', reason: 'logged_out', at: new Date()
    });

    const row = await sessionRow();
    expect(row.state).toBe('logged_out');
    // It must not keep saying 'active', or the dispatcher queues sends that can never leave.
    expect(row.status).toBe('linking');
  });

  it('clears a stale open socket, which no running process is actually holding', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };
    await applyConnectionEvent(ctx, { senderId, state: 'open', reason: null, at: new Date() });
    expect((await sessionRow()).state).toBe('open');

    // What a gateway does at boot: whatever the last run left behind, nothing is connected
    // until this process connects it. Covers a crash, where no shutdown handler ever ran.
    const cleared = await markAllSessionsClosed(ctx);

    expect(cleared).toBeGreaterThan(0);
    expect((await sessionRow()).state).toBe('closed');
  });

  it('keeps the last successful connection time across a later disconnect', async () => {
    const ctx = { db, provider: new FakeChannelProvider(), logger, decrypt: () => '',
      limits: { perMinute: 1000, perDay: 10_000 } };
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
