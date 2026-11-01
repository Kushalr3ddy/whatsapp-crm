import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WASocket } from 'baileys';
import type { NormalisedRetryEvent } from '@crm/channels';
import { InMemoryAuthStateStore } from '@crm/channel-fake';
import { BaileysChannelProvider } from './index.js';

/**
 * F6 S4 and S5 at the adapter: a contact's retry request becomes a port event, the profile photo and about are probed with "hidden"
 * told apart from "could not tell", and the encryption session with a contact is recreated by dropping its keys from our store.
 * Driven with a fake socket, so no WhatsApp account is needed.
 */
const silent = {
  level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

class FakeSocket {
  readonly ev = new EventEmitter();
  user: { id: string } | undefined = { id: '919000000001:1@s.whatsapp.net' };
  /** What the next profile photo lookup does: a URL, nothing, or a throw. */
  picture: () => Promise<string | undefined> = () => Promise.resolve('https://pps.whatsapp.net/photo');
  status: () => Promise<unknown[] | undefined> = () => Promise.resolve([{ id: 'x', status: { status: 'Hey there', setAt: new Date() } }]);
  readonly signalRepository = { lidMapping: { getLIDForPN: () => Promise.resolve(null as string | null), getPNForLID: () => Promise.resolve(null as string | null) } };
  end(): void { /* the test emits the close itself */ }
  async logout(): Promise<void> { /* nothing to drop */ }
  profilePictureUrl(): Promise<string | undefined> { return this.picture(); }
  fetchStatus(): Promise<unknown[] | undefined> { return this.status(); }
}

async function openProvider(senderId: string, store = new InMemoryAuthStateStore()) {
  const sockets: FakeSocket[] = [];
  const configs: Array<{ logger: { info(o: unknown, m?: string): void } }> = [];
  const provider = new BaileysChannelProvider({
    authStore: store, logger: silent, waVersion: [2, 3000, 1],
    makeSocket: (config) => { const s = new FakeSocket(); sockets.push(s); configs.push(config as never); return s as unknown as WASocket; }
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
  return { provider, socket: sockets[0]!, config: configs[0]!, store };
}

const boom = (statusCode: number): Error => Object.assign(new Error('iq error'), { output: { statusCode } });
const to = { phoneE164: '+919876500001' };

describe('AC-5.1 a retry request becomes a port event', () => {
  it('AC-5.1 Baileys\' "recv retry request" log line is reported with the message id and the sender', async () => {
    const { provider, config } = await openProvider('r1');
    const it = provider.retries()[Symbol.asyncIterator]();
    config.logger.info({ attrs: { id: '3EB0ABC' } }, 'recv retry request');
    const event = (await it.next()).value as NormalisedRetryEvent;
    expect(event).toMatchObject({ senderId: 'r1', providerMessageId: '3EB0ABC' });
    expect(event.at).toBeInstanceOf(Date);
    await provider.shutdown();
  });
});

describe('AC-4.2 the profile probe', () => {
  it('AC-4.2 photo and about both fetched → both visible', async () => {
    const { provider } = await openProvider('p1');
    expect(await provider.profileSnapshot({ id: 'p1', phoneE164: '' }, to)).toEqual({ photo: true, about: true });
    await provider.shutdown();
  });

  it('AC-4.3 a photo refused as not-authorized and an about with no status → both hidden', async () => {
    const { provider, socket } = await openProvider('p2');
    socket.picture = () => Promise.reject(boom(401));
    socket.status = () => Promise.resolve([{ id: 'x', status: null }]);
    expect(await provider.profileSnapshot({ id: 'p2', phoneE164: '' }, to)).toEqual({ photo: false, about: false });
    await provider.shutdown();
  });

  it('AC-4.4 a contact with no photo set (nothing returned) and a visible about → photo false, about true', async () => {
    const { provider, socket } = await openProvider('p3');
    socket.picture = () => Promise.resolve(undefined);
    expect(await provider.profileSnapshot({ id: 'p3', phoneE164: '' }, to)).toEqual({ photo: false, about: true });
    await provider.shutdown();
  });

  it('AC-4.2 a timeout or a failed query is "could not tell", never "hidden"', async () => {
    const { provider, socket } = await openProvider('p4');
    socket.picture = () => Promise.reject(new Error('Timed Out'));
    expect(await provider.profileSnapshot({ id: 'p4', phoneE164: '' }, to)).toBeNull();
    socket.picture = () => Promise.resolve('https://pps.whatsapp.net/photo');
    socket.status = () => Promise.resolve(undefined);
    expect(await provider.profileSnapshot({ id: 'p4', phoneE164: '' }, to)).toBeNull();
    await provider.shutdown();
  });

  it('AC-4.2 a sender that is not connected cannot be asked', async () => {
    const { provider } = await openProvider('p5');
    expect(await provider.profileSnapshot({ id: 'someone-else', phoneE164: '' }, to)).toBeNull();
    await provider.shutdown();
  });
});

describe('AC-5.3 recreating the session with a contact', () => {
  it('AC-5.3 removes the session keys of every device of that contact and nobody else\'s', async () => {
    const store = new InMemoryAuthStateStore();
    const { provider } = await openProvider('s1', store);
    const bytes = new Uint8Array([1]);
    for (const key of [
      'session-919876500001.0', 'session-919876500001.7', 'session-919876500002.0', 'session-9198765000011.0',
      'pre-key-1', 'sender-key-919876500001', 'session-919876500001_1.0'
    ]) await store.set('s1', key, bytes);

    await provider.resetSession({ id: 's1', phoneE164: '' }, to);

    const left = (await store.keys('s1')).filter((k) => k !== 'creds').sort();
    expect(left).toEqual(['pre-key-1', 'sender-key-919876500001', 'session-9198765000011.0', 'session-919876500002.0']);
    await provider.shutdown();
  });

  it('AC-5.3 also drops the sessions kept under the contact\'s privacy address when the mapping is known', async () => {
    const store = new InMemoryAuthStateStore();
    const { provider, socket } = await openProvider('s2', store);
    socket.signalRepository.lidMapping.getLIDForPN = () => Promise.resolve('55555555@lid');
    const bytes = new Uint8Array([1]);
    for (const key of ['session-919876500001.0', 'session-55555555_1.0', 'session-55555555_1.2', 'session-66666666_1.0']) await store.set('s2', key, bytes);

    await provider.resetSession({ id: 's2', phoneE164: '' }, to);

    expect((await store.keys('s2')).filter((k) => k.startsWith('session-'))).toEqual(['session-66666666_1.0']);
    await provider.shutdown();
  });
});
