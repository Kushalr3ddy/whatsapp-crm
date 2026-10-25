import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { WASocket } from 'baileys';
import { createDatabase, type Database } from '@crm/db';
import { BaileysChannelProvider } from '@crm/channel-baileys';
import { FakeChannelProvider, InMemoryAuthStateStore } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { applyConnectionEvent } from '../../apps/gateway/src/work.js';

/**
 * R-014 (2026-10-25, found by: Mikhil, "sent a message but it's not going").
 *
 * The first QR was not scanned, so the gateway kept that unlinked socket alive. Pressing Link again logged the old socket out and opened a
 * new one, and two things then went wrong. (a) The old socket's close arrived after the new socket was open, and the close handler deleted
 * the number's entry without checking it was its own: the new socket ran on untracked, and the next open made another. (b) The connection
 * event for that close rewrote `link_requested_at` (unchanged) in an upsert, and `AFTER UPDATE OF link_requested_at` fires on any SET of the
 * column, so the gateway was told to start the same link a second time. Two sockets ended up logged in as one device and replaced each other
 * (`conflict type="replaced"`, 624 times); every send was held as `sender_not_connected`.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const silent = {
  level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

/** Just enough of a Baileys socket for the adapter's lifecycle: an event bus, end and logout. */
class FakeSocket {
  readonly ev = new EventEmitter();
  user: { id: string } | undefined = undefined;
  end(): void { /* the real one closes the websocket; the test emits the close itself */ }
  async logout(): Promise<void> { /* the real one asks WhatsApp to drop this device */ }
  /** Emits a close the way Baileys does, with WhatsApp's status code on the error. */
  close(statusCode: number): void {
    this.ev.emit('connection.update', {
      connection: 'close', lastDisconnect: { error: Object.assign(new Error('closed'), { output: { statusCode } }), date: new Date() }
    });
  }
}

/** A provider whose sockets are fakes, plus the list of every socket it opened. */
function fakeProvider(): { provider: BaileysChannelProvider; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const provider = new BaileysChannelProvider({
    authStore: new InMemoryAuthStateStore(), logger: silent, waVersion: [2, 3000, 1],
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as WASocket; }
  });
  return { provider, sockets };
}

/** Starts a QR link and answers it with a QR from the socket it opens, the way WhatsApp would. */
async function linkWithQr(provider: BaileysChannelProvider, sockets: FakeSocket[], senderId: string): Promise<FakeSocket> {
  const before = sockets.length;
  const pending = provider.link(senderId, 'qr');
  let done = false;
  void pending.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    // Keep offering a QR until the adapter is listening for one (it starts listening once the socket is open).
    sockets[before]?.ev.emit('connection.update', { qr: `qr-${String(before)}` });
    await new Promise((r) => setTimeout(r, 5));
  }
  await pending;
  return sockets[before]!;
}

describe('[R-014] a second link while the first QR socket is alive leaves exactly one socket', () => {
  it('[R-014] the old socket closing late does not drop the new socket', async () => {
    const { provider, sockets } = fakeProvider();
    const senderId = randomUUID();
    const first = await linkWithQr(provider, sockets, senderId);

    // Link pressed again: the gateway logs the unlinked number out first, then links.
    await provider.logout(senderId);
    await linkWithQr(provider, sockets, senderId);

    first.close(401);   // the old socket's close lands after the new socket is open

    expect((await provider.health(senderId)).state).toBe('connecting');
    await provider.shutdown();
  });

  it('[R-014] the old socket closing late does not open another socket', async () => {
    const { provider, sockets } = fakeProvider();
    const senderId = randomUUID();
    const first = await linkWithQr(provider, sockets, senderId);
    await provider.logout(senderId);
    await linkWithQr(provider, sockets, senderId);

    first.close(408);   // a QR timeout on the old socket: reconnectable, so it would schedule a reconnect
    await new Promise((r) => setTimeout(r, 1_300));   // past the first reconnect delay (1 s)

    expect(sockets).toHaveLength(2);
    await provider.shutdown();
  });
});

describe('[R-014] a connection event while a link is pending does not ask for the link again', () => {
  let db: Database;
  let orgId: string;
  let senderId: string;
  let sessionId: string;

  beforeAll(() => { db = createDatabase(url, { max: 4 }); });
  afterAll(async () => { await db.$client.end(); });

  beforeEach(async () => {
    orgId = randomUUID();
    await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'r14',${'r14-' + orgId.slice(0, 8)})`);
    const s = await db.execute(sql`
      INSERT INTO sender_identity(org_id,provider,label,status) VALUES (${orgId},'baileys','r14','linking') RETURNING id`);
    senderId = (s as unknown as Array<{ id: string }>)[0]!.id;
    // A link the API has asked for, whose QR the gateway has not written back yet.
    const cs = await db.execute(sql`
      INSERT INTO channel_session(sender_identity_id, connection_state, link_requested_at, link_requested_mode)
      VALUES (${senderId}, 'closed', now(), 'qr') RETURNING id`);
    sessionId = (cs as unknown as Array<{ id: string }>)[0]!.id;
  });

  it('[R-014] a logged_out event does not re-send the link notification', async () => {
    const seen: string[] = [];
    const listener = await db.$client.listen('gateway', (payload) => { seen.push(payload); });
    try {
      await applyConnectionEvent(
        { db, provider: new FakeChannelProvider(), logger, tenantRole: 'crm_app', decrypt: () => '' } as never,
        { senderId, state: 'logged_out', reason: 'logged_out', code: 401, at: new Date() }
      );
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await listener.unlisten();
    }
    const links = seen.map((p) => JSON.parse(p) as { kind: string; id: string }).filter((c) => c.kind === 'link' && c.id === sessionId);
    expect(links).toHaveLength(0);

    // The pending request itself is untouched: the handler that is already working on it still finds it.
    const row = (await db.execute(sql`SELECT link_requested_at AS at FROM channel_session WHERE id = ${sessionId}`) as unknown as Array<{ at: string | null }>)[0];
    expect(row?.at).not.toBeNull();
  });

  it('[R-014] an open still clears the finished link request', async () => {
    await applyConnectionEvent(
      { db, provider: new FakeChannelProvider(), logger, tenantRole: 'crm_app', decrypt: () => '' } as never,
      { senderId, state: 'open', reason: null, at: new Date() }
    );
    const row = (await db.execute(sql`
      SELECT link_requested_at AS at, link_requested_mode AS mode, connection_state AS state FROM channel_session WHERE id = ${sessionId}`
    ) as unknown as Array<{ at: string | null; mode: string | null; state: string }>)[0];
    expect(row).toEqual({ at: null, mode: null, state: 'open' });
  });
});
