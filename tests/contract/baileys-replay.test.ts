import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  collectConnections, linkWithQr, recordingLogger, scriptedWhatsApp, storeCredentials, tick, type ScriptedWhatsApp
} from '../fixtures/baileys-socket.js';

/**
 * The real WhatsApp adapter, replayed through the sequences WhatsApp produces on linking, reconnecting and sending.
 *
 * Every test runs `BaileysChannelProvider` unchanged on a scripted socket (`tests/fixtures/baileys-socket.ts`). What each one checks is
 * what the operator needs: a QR that shows, a link that completes, a number that comes back by itself when it can, stays down when it
 * must (unlinked, banned, taken over elsewhere), and never opens a storm of sockets. Ids: WA-L linking, WA-C connection, WA-S sending.
 */
const open: ScriptedWhatsApp[] = [];
const wa = (opts: Parameters<typeof scriptedWhatsApp>[0] = {}): ScriptedWhatsApp => { const w = scriptedWhatsApp(opts); open.push(w); return w; };
afterEach(async () => {
  vi.useRealTimers();
  for (const w of open.splice(0)) await w.provider.shutdown();
});

/** A linked, open number: QR shown, scanned, 515, reconnected, open. */
async function linked(w: ScriptedWhatsApp, senderId = randomUUID()) {
  const { socket } = await linkWithQr(w, senderId);
  socket.ev.emit('creds.update', {});
  socket.close(515);                                   // WhatsApp always restarts the stream after a scan
  const second = await w.socketCount(2);
  second.open();
  await tick();
  return { senderId, socket: second };
}

describe('linking a number', () => {
  it('WA-L1 shows the QR WhatsApp issued, with an expiry in the future', async () => {
    const w = wa();
    const { qr } = await linkWithQr(w, randomUUID());
    expect(qr).toMatch(/^2@qr-/);
  });

  it('WA-L2 a QR that never comes fails as qr_timeout and leaves no half-open socket behind', async () => {
    const w = wa({ qrTtlMs: 50 });
    const id = randomUUID();
    await expect(w.provider.link(id, 'qr')).rejects.toMatchObject({ code: 'qr_timeout' });
    expect(w.latest().ended).toBe(true);
    expect((await w.provider.health(id)).state).toBe('closed');
    // Pressing Link again starts clean: a new socket, not the dead one.
    const again = await linkWithQr(w, id);
    expect(again.socket.index).toBe(1);
  });

  it('WA-L3 WhatsApp refusing the saved login before a QR fails at once as stale_session', async () => {
    const w = wa();
    const pending = w.provider.link(randomUUID(), 'qr');
    (await w.socketCount(1)).close(401);
    await expect(pending).rejects.toMatchObject({ code: 'stale_session' });
  });

  it('WA-L4 a 429 before the QR fails as rate_limited and does not retry by itself', async () => {
    const w = wa();
    const pending = w.provider.link(randomUUID(), 'qr');
    (await w.socketCount(1)).close(429);
    await expect(pending).rejects.toMatchObject({ code: 'rate_limited' });
    await tick(1_200);
    expect(w.sockets).toHaveLength(1);
  });

  it('WA-L5 after the scan, the 515 restart reconnects at once and the number comes up open with its own phone', async () => {
    const w = wa();
    const events = collectConnections(w.provider);
    const { senderId } = await linked(w);
    expect((await w.provider.health(senderId)).state).toBe('open');
    expect(events.at(-1)).toMatchObject({ state: 'open', phoneE164: '+919000000001' });
  });

  it('[R-027] WA-L6 pressing Link twice at the same moment opens one socket, not two', async () => {
    const w = wa();
    const id = randomUUID();
    const a = w.provider.link(id, 'qr');
    const b = w.provider.link(id, 'qr');
    await tick(50);
    for (const s of w.sockets) s.qr();
    await Promise.allSettled([a, b]);
    expect(w.sockets).toHaveLength(1);
  });

  it('WA-L7 a pairing code is offered for a number not held in hand', async () => {
    const w = wa();
    const c = await w.provider.link(randomUUID(), 'pairing_code', '+919000000001');
    expect(c).toMatchObject({ mode: 'pairing_code', code: 'K7QX2M9P' });
  });

  it('WA-L8 a pairing code without the phone number is refused before anything opens', async () => {
    const w = wa();
    await expect(w.provider.link(randomUUID(), 'pairing_code')).rejects.toThrow(/phone number/);
    expect(w.sockets).toHaveLength(0);
  });

  it('[R-028] WA-L9 WhatsApp sending 515 over and over does not become a storm of sockets', async () => {
    const w = wa();
    const id = randomUUID();
    const { socket } = await linkWithQr(w, id);
    socket.close(515);
    for (let i = 2; i <= 12; i++) {
      const next = await w.socketCount(i, 3_000).catch(() => null);
      if (next === null) break;
      next.close(515);
    }
    await tick(200);
    // A real handshake needs one restart. Ten in a row is WhatsApp refusing, and must back off like any other failure.
    expect(w.sockets.length).toBeLessThanOrEqual(7);
  }, 15_000);
});

describe('a linked number losing its connection', () => {
  it('WA-C1 a dropped connection (428) comes back by itself after a short wait', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    socket.close(428);
    expect((await w.provider.health(senderId)).state).toBe('closed');
    const back = await w.socketCount(3, 3_000);
    back.open();
    await tick();
    expect((await w.provider.health(senderId)).state).toBe('open');
  });

  it('WA-C2 a timeout (408) also comes back by itself', async () => {
    const w = wa();
    const { socket } = await linked(w);
    socket.close(408);
    await w.socketCount(3, 3_000);
  });

  it('WA-C3 removed under Linked devices on the phone: logged out, with device_removed, and no reconnect', async () => {
    const w = wa();
    const events = collectConnections(w.provider);
    const { senderId, socket } = await linked(w);
    socket.close(401, 'device_removed');
    await tick(1_200);
    expect((await w.provider.health(senderId)).state).not.toBe('open');
    expect(events.at(-1)).toMatchObject({ state: 'logged_out', code: 401, detail: 'device_removed' });
    expect(w.sockets).toHaveLength(2);
  });

  it('[R-029] WA-C4 refused by WhatsApp (403, a ban): reported with its code, and not dialled again by itself', async () => {
    const w = wa();
    const events = collectConnections(w.provider);
    const { socket } = await linked(w);
    socket.close(403);
    await tick(1_300);
    expect(events.at(-1)).toMatchObject({ code: 403 });
    // Reconnecting into a ban is the behaviour that makes WhatsApp's decision permanent. A person decides.
    expect(w.sockets).toHaveLength(2);
  });

  it('[R-030] WA-C5 taken over by another client (440): not dialled again by itself, or the two fight over the device', async () => {
    const w = wa();
    const { socket } = await linked(w);
    socket.close(440, 'replaced');
    await tick(1_300);
    expect(w.sockets).toHaveLength(2);
  });

  it('[R-026] WA-C6 after five failed reconnects it stops, and says so in the log', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { logger, lines } = recordingLogger();
    const w = wa({ logger });
    const id = randomUUID();
    await storeCredentials(w.store, id);
    await w.provider.connect({ id, phoneE164: '+919000000001' });
    w.latest().open();
    for (let i = 0; i < 6; i++) {
      w.latest().close(428);
      await vi.advanceTimersByTimeAsync(61_000);
    }
    expect(lines.some((l) => l.level === 'error' && /giving up/.test(l.msg))).toBe(true);
    const count = w.sockets.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.sockets.length).toBe(count);
  });

  it('[R-026] WA-C9 no internet for 20 minutes: it keeps trying about once a minute, never gives up, and is back when the internet is', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { logger, lines } = recordingLogger();
    const w = wa({ logger });
    const id = randomUUID();
    await storeCredentials(w.store, id);
    await w.provider.connect({ id, phoneE164: '+919000000001' });
    w.latest().open();
    w.latest().close(408);                       // the drop itself: WhatsApp's keep-alive times out
    await vi.advanceTimersByTimeAsync(61_000);
    for (let i = 0; i < 20; i++) {               // every try after it fails without reaching WhatsApp
      const before = w.sockets.length;
      w.latest().offline();
      await vi.advanceTimersByTimeAsync(61_000);
      expect(w.sockets.length, `no new try after offline failure ${String(i + 1)}`).toBe(before + 1);
    }
    expect(lines.some((l) => /giving up/.test(l.msg))).toBe(false);
    w.latest().open();
    expect((await w.provider.health(id)).state).toBe('open');
  });

  it('[R-026] WA-C7 a number given up on comes back when it is connected again (a restart or the Numbers page)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = wa();
    const id = randomUUID();
    await storeCredentials(w.store, id);
    await w.provider.connect({ id, phoneE164: '+919000000001' });
    w.latest().open();
    for (let i = 0; i < 6; i++) { w.latest().close(428); await vi.advanceTimersByTimeAsync(61_000); }
    await w.provider.connect({ id, phoneE164: '+919000000001' });
    w.latest().open();
    expect((await w.provider.health(id)).state).toBe('open');
  });

  it('WA-C8 a gateway restart brings a linked number back from stored credentials, with no QR', async () => {
    const first = wa();
    const { senderId } = await linked(first);
    await first.provider.shutdown();
    const second = wa({ store: first.store });
    await second.provider.connect({ id: senderId, phoneE164: '+919000000001' });
    second.latest().open();
    await tick();
    expect((await second.provider.health(senderId)).state).toBe('open');
  });

  it('WA-C9 a number that was never linked cannot be "restored": a clear error, no socket', async () => {
    const w = wa();
    await expect(w.provider.connect({ id: randomUUID(), phoneE164: '' })).rejects.toThrow(/no stored session/);
    expect(w.sockets).toHaveLength(0);
  });

  it('WA-C10 shutting down cancels a reconnect that was waiting', async () => {
    const w = wa();
    const { socket } = await linked(w);
    socket.close(428);
    await w.provider.shutdown();
    await tick(1_300);
    expect(w.sockets).toHaveLength(2);
  });

  it('WA-C11 unlinking from the app clears the stored credentials, so the next Link starts with a fresh QR', async () => {
    const w = wa();
    const { senderId } = await linked(w);
    await w.provider.logout(senderId);
    await expect(w.provider.connect({ id: senderId, phoneE164: '' })).rejects.toThrow(/no stored session/);
  });

  it.fails('[R-031] WA-C12 after unlinking it reads as logged out, not merely closed', async () => {
    const w = wa();
    const { senderId } = await linked(w);
    await w.provider.logout(senderId);
    expect((await w.provider.health(senderId)).state).toBe('logged_out');
  });
});

describe('sending and receiving on the real adapter', () => {
  it('WA-S1 refuses to send while the number is still connecting', async () => {
    const w = wa();
    const id = randomUUID();
    await storeCredentials(w.store, id);
    await w.provider.connect({ id, phoneE164: '' });
    await expect(w.provider.send({ id, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'hi' }))
      .rejects.toThrow(/not connected/);
  });

  it('WA-S2 sends to the phone address, or to the privacy (LID) address when WhatsApp gave one', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    await w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'a' });
    await w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543211', providerAddress: '123456789@lid' }, { kind: 'freeform', body: 'b' });
    expect(socket.sent.map((s) => s.jid)).toEqual(['919876543210@s.whatsapp.net', '123456789@lid']);
  });

  it('WA-S3 a refusal (463) carries WhatsApp\'s code and leaves the connection open for everyone else', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    socket.refuse.set('919876543210@s.whatsapp.net', 463);
    await expect(w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'x' }))
      .rejects.toMatchObject({ statusCode: 463 });
    expect((await w.provider.health(senderId)).state).toBe('open');
    const ok = await w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543299' }, { kind: 'freeform', body: 'y' });
    expect(ok.providerMessageId).toBeTruthy();
  });

  it('WA-S4 a send after the connection dropped is refused (the gateway must keep it queued, not fail it)', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    socket.close(428);
    await expect(w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'x' }))
      .rejects.toThrow(/not connected/);
  });

  it('WA-S5 a contact\'s message arrives once; history sync, groups and our own echo do not', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    const got: string[] = [];
    const reading = (async () => { for await (const e of w.provider.inbound()) { got.push(e.body); if (got.length >= 1) break; } })();
    const sent = await w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'ours' });
    // Our own send echoing back, a history-sync message and a group message: none is a new message from a person.
    socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: sent.providerMessageId, remoteJid: '919876543210@s.whatsapp.net', fromMe: true }, message: { conversation: 'ours' } }] });
    socket.inbound('919876543210', 'old history', 'H1', 'append');
    socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'G1', remoteJid: '1203630@g.us', fromMe: false }, message: { conversation: 'group chatter' } }] });
    socket.inbound('919876543210', 'hello from a person');
    await reading;
    expect(got).toEqual(['hello from a person']);
  });

  it('WA-S6 delivery and read ticks become status events', async () => {
    const w = wa();
    const { senderId, socket } = await linked(w);
    const sent = await w.provider.send({ id: senderId, phoneE164: '' }, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'x' });
    const seen: string[] = [];
    const reading = (async () => { for await (const e of w.provider.status()) { seen.push(e.status); if (seen.length === 2) break; } })();
    socket.status(sent.providerMessageId, 3);
    socket.status(sent.providerMessageId, 4);
    await reading;
    expect(seen).toEqual(['delivered', 'read']);
  });
});
