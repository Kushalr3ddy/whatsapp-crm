import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WASocket } from 'baileys';
import type { NormalisedNoticeEvent } from '@crm/channels';
import { InMemoryAuthStateStore } from '@crm/channel-fake';
import { BaileysChannelProvider } from './index.js';

/**
 * F6 S2 and S1 at the adapter: WhatsApp's reachout timelock and new-chat cap become port events, presence and read receipts reach the
 * socket, and a 463 refusal carries its status code to the gateway. Driven with a fake socket, so no WhatsApp account is needed.
 */
const silent = {
  level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

class FakeSocket {
  readonly ev = new EventEmitter();
  user: { id: string } | undefined = { id: '919000000001:1@s.whatsapp.net' };
  readonly presence: string[] = [];
  readonly reads: Array<Array<{ remoteJid: string; id: string; fromMe: boolean }>> = [];
  sendError: Error | null = null;
  end(): void { /* the test emits the close itself */ }
  async logout(): Promise<void> { /* nothing to drop */ }
  async sendPresenceUpdate(state: string): Promise<void> { this.presence.push(state); }
  async readMessages(keys: Array<{ remoteJid: string; id: string; fromMe: boolean }>): Promise<void> { this.reads.push(keys); }
  async sendMessage(): Promise<{ key: { id: string } }> {
    if (this.sendError !== null) throw this.sendError;
    return { key: { id: 'WAMID1' } };
  }
}

/** A provider with one open socket for `senderId`. */
async function openProvider(senderId: string): Promise<{ provider: BaileysChannelProvider; socket: FakeSocket }> {
  const sockets: FakeSocket[] = [];
  const provider = new BaileysChannelProvider({
    authStore: new InMemoryAuthStateStore(), logger: silent, waVersion: [2, 3000, 1],
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as WASocket; }
  });
  const pending = provider.link(senderId, 'qr');
  let done = false;
  void pending.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    sockets[0]?.ev.emit('connection.update', { qr: 'qr' });
    await new Promise((r) => setTimeout(r, 5));
  }
  await pending;
  sockets[0]!.ev.emit('connection.update', { connection: 'open' });
  return { provider, socket: sockets[0]! };
}

/** The next `n` notices the provider emits. */
async function notices(provider: BaileysChannelProvider, n: number, emit: () => void): Promise<NormalisedNoticeEvent[]> {
  const it = provider.notices()[Symbol.asyncIterator]();
  emit();
  const out: NormalisedNoticeEvent[] = [];
  for (let i = 0; i < n; i++) out.push((await it.next()).value as NormalisedNoticeEvent);
  return out;
}

describe('WhatsApp limit warnings become port events', () => {
  it('AC-2.1 an active reachout timelock becomes a timelock notice with its end time and type', async () => {
    const { provider, socket } = await openProvider('s1');
    const until = new Date('2026-11-05T10:00:00.000Z');
    const [n] = await notices(provider, 1, () => socket.ev.emit('connection.update', {
      reachoutTimeLock: { isActive: true, timeEnforcementEnds: until, enforcementType: 'WEB_COMPANION_ONLY' }
    }));
    expect(n).toMatchObject({ kind: 'timelock', senderId: 's1', active: true, enforcementType: 'WEB_COMPANION_ONLY' });
    expect(n!.kind === 'timelock' && n!.until).toEqual(until);
    await provider.shutdown();
  });

  it('AC-2.2 an inactive update becomes a notice that the lock is lifted', async () => {
    const { provider, socket } = await openProvider('s2');
    const [n] = await notices(provider, 1, () => socket.ev.emit('connection.update', {
      reachoutTimeLock: { isActive: false, enforcementType: 'DEFAULT' }
    }));
    expect(n).toMatchObject({ kind: 'timelock', active: false, until: null });
    await provider.shutdown();
  });

  it('AC-2.3 a message-capping update becomes a capping notice with the quota, status and cycle', async () => {
    const { provider, socket } = await openProvider('s3');
    const [n] = await notices(provider, 1, () => socket.ev.emit('message-capping.update', {
      total_quota: 100, used_quota: 80, capping_status: 'FIRST_WARNING',
      cycle_start_timestamp: '1793000000', cycle_end_timestamp: '1793086400'
    }));
    expect(n).toMatchObject({ kind: 'capping', senderId: 's3', status: 'FIRST_WARNING', totalQuota: 100, usedQuota: 80 });
    expect(n!.kind === 'capping' && n!.cycleEnd).toEqual(new Date(1793086400 * 1000));
    await provider.shutdown();
  });

  it('AC-2.3 a status WhatsApp invents later is kept as unknown rather than guessed', async () => {
    const { provider, socket } = await openProvider('s4');
    const [n] = await notices(provider, 1, () => socket.ev.emit('message-capping.update', { total_quota: 5, capping_status: 'SURPRISE' }));
    expect(n).toMatchObject({ kind: 'capping', status: null, totalQuota: 5 });
    await provider.shutdown();
  });
});

describe('presence, read receipts and a 463 at the adapter', () => {
  const sender = { id: 's5', phoneE164: '+919000000001' };

  it('AC-1.6 presence goes to the socket as available / unavailable', async () => {
    const { provider, socket } = await openProvider('s5');
    await provider.presence!(sender, 'available');
    await provider.presence!(sender, 'unavailable');
    expect(socket.presence).toEqual(['available', 'unavailable']);
    await provider.shutdown();
  });

  it('AC-1.7 markRead asks WhatsApp to read exactly the given messages of that chat, as not from us', async () => {
    const { provider, socket } = await openProvider('s5');
    await provider.markRead!(sender, { phoneE164: '+919876500001' }, ['A1', 'A2']);
    await provider.markRead!(sender, { phoneE164: '', providerAddress: '1234@lid' }, ['B1']);
    await provider.markRead!(sender, { phoneE164: '+919876500001' }, []);
    expect(socket.reads).toEqual([
      [{ remoteJid: '919876500001@s.whatsapp.net', id: 'A1', fromMe: false }, { remoteJid: '919876500001@s.whatsapp.net', id: 'A2', fromMe: false }],
      [{ remoteJid: '1234@lid', id: 'B1', fromMe: false }]
    ]);
    await provider.shutdown();
  });

  it('AC-2.6 a send that WhatsApp refuses with a 463 throws an error carrying statusCode 463', async () => {
    const { provider, socket } = await openProvider('s5');
    socket.sendError = Object.assign(new Error('forbidden'), { output: { statusCode: 463 } });
    await expect(provider.send(sender, { phoneE164: '+919876500001' }, { kind: 'freeform', body: 'hi' }))
      .rejects.toMatchObject({ statusCode: 463 });
    socket.sendError = new Error('timed out');
    await expect(provider.send(sender, { phoneE164: '+919876500001' }, { kind: 'freeform', body: 'hi' }))
      .rejects.not.toHaveProperty('statusCode');
    await provider.shutdown();
  });
});
