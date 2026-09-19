/**
 * The channel port. Types only — this package defines the contract every transport adapter
 * implements, and deliberately depends on no transport SDK itself.
 */
export type {
  ChannelProvider, ChannelCapabilities, AuthStateStore,
  OutboundContent, Recipient, SenderRef, SendResult,
  NormalisedInboundEvent, NormalisedStatusEvent, NormalisedConnectionEvent,
  ProviderHealth, DisconnectReason, LinkChallenge
} from './port.js';
