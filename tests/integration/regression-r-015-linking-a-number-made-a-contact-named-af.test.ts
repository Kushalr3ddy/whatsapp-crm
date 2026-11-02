import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { WASocket } from 'baileys';
import type { NormalisedInboundEvent } from '@crm/channels';
import { BaileysChannelProvider } from '@crm/channel-baileys';
import { InMemoryAuthStateStore } from '@crm/channel-fake';

/**
 * R-015 (2026-10-26, area: channels, found by: Mikhil, local sanity test; issue #3).
 *
 * Right after linking, the Contacts page showed a contact named `<digits>@lid` with an empty thread of 10–11 "sent" messages. The `@lid` was
 * the linked account's OWN privacy id: on link the phone sends the new device its sync messages (`protocolMessage`, history sync and the
 * like) addressed to the account's own chat. Baileys hands every message to `messages.upsert`; the adapter only dropped groups, channels and
 * broadcasts, so these came through as messages the owner sent from the phone (D-94). The gateway's "message yourself" guard compares phone
 * numbers, and these carry only the LID, so a contact was made for the account itself and its never-delivered "sends" cost the number
 * 40 risk points. The adapter knows its own addresses, so it is where both kinds of message are dropped.
 */

// Fiction numbers (R-009): the linked account, and one other person.
const OWN_PHONE = '12025550701';
const OWN_LID = '99000000000701';
const OTHER_LID = '99000000000702';
const OTHER_PHONE = '12025550702';

const silent = {
  level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

/** Just enough of a Baileys socket: an event bus, the logged-in account, end and logout. */
class FakeSocket {
  readonly ev = new EventEmitter();
  user: { id: string; lid?: string } | undefined = undefined;
  end(): void {}
  async logout(): Promise<void> {}
}

/** A linked provider whose socket knows its own phone number and LID, the way Baileys reports them once logged in. */
async function linkedProvider(): Promise<{ provider: BaileysChannelProvider; socket: FakeSocket; senderId: string }> {
  const sockets: FakeSocket[] = [];
  const provider = new BaileysChannelProvider({
    authStore: new InMemoryAuthStateStore(), logger: silent, waVersion: [2, 3000, 1],
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as WASocket; }
  });
  const senderId = randomUUID();
  const pending = provider.link(senderId, 'qr');
  let done = false;
  void pending.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    sockets[0]?.ev.emit('connection.update', { qr: 'qr-0' });
    await new Promise((r) => setTimeout(r, 5));
  }
  await pending;
  const socket = sockets[0]!;
  socket.user = { id: `${OWN_PHONE}:91@s.whatsapp.net`, lid: `${OWN_LID}:91@lid` };
  socket.ev.emit('creds.update', {});
  return { provider, socket, senderId };
}

/** Delivers messages the way Baileys does for live traffic, then returns every inbound event the adapter produced. */
async function deliver(messages: unknown[]): Promise<NormalisedInboundEvent[]> {
  const { provider, socket } = await linkedProvider();
  socket.ev.emit('messages.upsert', { type: 'notify', messages });
  await provider.shutdown();   // closes the stream: the loop below reads what was buffered, then ends
  const events: NormalisedInboundEvent[] = [];
  for await (const e of provider.inbound()) events.push(e);
  return events;
}

const at = 1_793_000_000;
/** A sync message from the phone to the account's own chat, as it arrives on link. */
const historySync = (remoteJid: string, id: string): unknown => ({
  key: { remoteJid, fromMe: true, id },
  message: { protocolMessage: { type: 5, historySyncNotification: { syncType: 0, fileLength: 0 } } },
  messageTimestamp: at
});

describe('[R-015] the phone\'s own sync and system messages never become a conversation', () => {
  it('[R-015] drops history-sync messages the phone sends to the account\'s own LID', async () => {
    const events = await deliver([historySync(`${OWN_LID}@lid`, 'SYNC-1'), historySync(`${OWN_LID}@lid`, 'SYNC-2')]);
    expect(events).toEqual([]);
  });

  it('[R-015] drops a system message to the account\'s own phone-number chat', async () => {
    const events = await deliver([{
      key: { remoteJid: `${OWN_PHONE}@s.whatsapp.net`, fromMe: true, id: 'KEYSHARE-1' },
      message: { protocolMessage: { type: 6, appStateSyncKeyShare: { keys: [] } } },
      messageTimestamp: at
    }]);
    expect(events).toEqual([]);
  });

  it('[R-015] drops a text the owner sent to their own chat ("message yourself"), by LID and by number', async () => {
    const events = await deliver([
      { key: { remoteJid: `${OWN_LID}@lid`, fromMe: true, id: 'SELF-1' }, message: { conversation: 'note to self' }, messageTimestamp: at },
      { key: { remoteJid: `${OWN_PHONE}@s.whatsapp.net`, fromMe: true, id: 'SELF-2' }, message: { conversation: 'note' }, messageTimestamp: at }
    ]);
    expect(events).toEqual([]);
  });

  it('[R-015] drops a system message in a real person\'s chat (a "delete for everyone" from either side)', async () => {
    const revoke = (fromMe: boolean, id: string): unknown => ({
      key: { remoteJid: `${OTHER_LID}@lid`, fromMe, id },
      message: { protocolMessage: { type: 0, key: { remoteJid: `${OTHER_LID}@lid`, fromMe: !fromMe, id: 'ORIGINAL' } } },
      messageTimestamp: at
    });
    const events = await deliver([revoke(true, 'REVOKE-MINE'), revoke(false, 'REVOKE-THEIRS')]);
    expect(events).toEqual([]);
  });

  it('[R-015] drops a message that carries only encryption-key distribution and no content', async () => {
    const events = await deliver([{
      key: { remoteJid: `${OTHER_LID}@lid`, fromMe: false, id: 'SKDM-1' },
      message: { senderKeyDistributionMessage: { groupId: 'x', axolotlSenderKeyDistributionMessage: new Uint8Array([1]) }, messageContextInfo: {} },
      messageTimestamp: at
    }]);
    expect(events).toEqual([]);
  });

  it('[R-015] still passes on what real people send, and what the owner typed to them from the phone', async () => {
    const events = await deliver([
      { key: { remoteJid: `${OTHER_LID}@lid`, fromMe: true, id: 'MINE-1', remoteJidAlt: `${OTHER_PHONE}@s.whatsapp.net` },
        message: { conversation: 'hi from my phone' }, messageTimestamp: at },
      { key: { remoteJid: `${OTHER_PHONE}@s.whatsapp.net`, fromMe: false, id: 'THEIRS-1' },
        message: { extendedTextMessage: { text: 'hello' } }, messageTimestamp: at }
    ]);
    expect(events.map((e) => [e.providerMessageId, e.fromMe === true, e.body])).toEqual([
      ['MINE-1', true, 'hi from my phone'],
      ['THEIRS-1', false, 'hello']
    ]);
  });
});
