/** Domain logic. Depends on ports and the database, never on a concrete adapter. */
export {
  storeInboundMessage, markMessageSent, markMessageFailed, applyDeliveryStatus,
  type InboundMessage, type StoredInbound
} from './messages.js';
