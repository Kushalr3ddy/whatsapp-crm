/**
 * The channel port. Types only — this package defines the contract every transport adapter
 * implements, and deliberately depends on no transport SDK itself.
 */
export type {
  ChannelProvider, ChannelCapabilities, AuthStateStore,
  OutboundContent, OutboundMedia, Recipient, SenderRef, SendResult,
  NormalisedInboundEvent, NormalisedStatusEvent, NormalisedConnectionEvent, NormalisedIdentityLink,
  InboundMedia,
  ProviderHealth, DisconnectReason, LinkChallenge
} from './port.js';
