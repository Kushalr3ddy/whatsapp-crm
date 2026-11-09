import { randomUUID } from 'node:crypto';
import type { ChannelProvider } from '@crm/channels';
import type { BaileysChannelProvider } from '@crm/channel-baileys';
import { runChannelProviderContract } from './channel-provider.js';
import { scriptedWhatsApp, storeCredentials, type ScriptedWhatsApp } from '../fixtures/baileys-socket.js';

/**
 * The same conformance suite the fake passes, run on the real WhatsApp adapter over a scripted socket. If the fake and the real adapter
 * ever disagree on a rule the gateway relies on (closed vs logged out, a refused recipient not taking the number down, distinct message
 * ids), this is where it shows, instead of in a campaign.
 */
const harnesses = new WeakMap<ChannelProvider, ScriptedWhatsApp>();

/** A provider whose next socket opens as soon as the adapter makes it, the way a number with valid credentials does. */
async function create(failFor?: string) {
  const w = scriptedWhatsApp();
  const id = randomUUID();
  await storeCredentials(w.store, id);
  const connect = w.provider.connect.bind(w.provider);
  w.provider.connect = async (sender) => {
    await connect(sender);
    const s = w.latest();
    if (failFor !== undefined) s.refuse.set(`${failFor.replace(/\D/g, '')}@s.whatsapp.net`, 500);
    if (!s.user) s.open();
  };
  // A QR link answers with a QR as soon as the socket exists.
  const link = w.provider.link.bind(w.provider);
  w.provider.link = async (senderId, mode, phone) => {
    const pending = link(senderId, mode, phone);
    if (mode === 'qr') { await w.socketCount(w.sockets.length + 1).catch(() => undefined); setTimeout(() => w.latest().qr(), 5); }
    return pending;
  };
  harnesses.set(w.provider, w);
  return { provider: w.provider as ChannelProvider, sender: { id, phoneE164: '+919000000001' } };
}

const socketOf = (provider: ChannelProvider) => harnesses.get(provider)!.latest();

runChannelProviderContract('baileys (scripted socket)', {
  create: () => create(),
  createWithFailingRecipient: (phone) => create(phone),
  canSimulateRecipientFailure: true,
  canDeliverMedia: false,
  knownBugs: ['R-031'],
  deliverInbound(provider: ChannelProvider, _senderId: string, from: string, body: string) {
    socketOf(provider as BaileysChannelProvider).inbound(from.replace(/\D/g, ''), body);
  }
});
