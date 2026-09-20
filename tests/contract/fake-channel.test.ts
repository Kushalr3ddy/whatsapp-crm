import { FakeChannelProvider } from '@crm/channel-fake';
import type { ChannelProvider, SenderRef } from '@crm/channels';
import { runChannelProviderContract } from './channel-provider.js';

const sender: SenderRef = { id: 'sender-1', phoneE164: '+919000000001' };

runChannelProviderContract('fake', {
  async create() {
    return { provider: new FakeChannelProvider(), sender };
  },
  async createWithFailingRecipient(phoneE164: string) {
    return { provider: new FakeChannelProvider({ failFor: [phoneE164] }), sender };
  },
  canSimulateRecipientFailure: true,
  canDeliverMedia: true,
  deliverInboundMedia(
    provider: ChannelProvider, senderId: string, from: string, bytes: Uint8Array,
    filename: string | null
  ) {
    (provider as FakeChannelProvider).receiveMessage(
      {
        senderId, fromProviderAddress: `${from.replace('+', '')}@s.whatsapp.net`,
        fromPhoneE164: from, body: '', contentType: 'document'
      },
      { bytes, declaredContentType: 'application/pdf', filename }
    );
  },
  deliverInbound(provider: ChannelProvider, senderId: string, from: string, body: string) {
    (provider as FakeChannelProvider).receiveMessage({
      senderId, fromProviderAddress: `${from.replace('+', '')}@s.whatsapp.net`,
      fromPhoneE164: from, body
    });
  }
});
