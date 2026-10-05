/**
 * What a transport is allowed to do. Declared statically by each adapter so the dispatcher
 * can refuse an illegal send BEFORE calling the provider, rather than discovering it at the
 * wire. Shaped to match the host application's own comms spec so integration is configuration
 * rather than a rewrite (docs/16-integration-jobportal.md).
 */
export interface ChannelCapabilities {
  /** Can send arbitrary text at any time. Baileys: true. Meta Cloud API: false. */
  readonly freeformOutsideWindow: boolean;
  /** Hours after an inbound message during which freeform is legal. Meta: 24. Baileys: null. */
  readonly sessionWindowHours: number | null;
  /** Whether sending outside that window requires a pre-approved template. */
  readonly requiresApprovedTemplate: boolean;
  /** Whether the provider reports delivered/read, or only accepted. */
  readonly supportsDeliveryReceipts: boolean;
  readonly supportsMedia: boolean;
  /** Buttons, lists, carousels, flows. */
  readonly supportsInteractive: boolean;
  /** Provider-imposed ceiling, separate from our own anti-ban limits. Null if none. */
  readonly perSenderDailyCap: number | null;
  /** Whether messages cost money. Drives cost-aware routing between free and paid transports. */
  readonly costPerMessage: boolean;
}

/**
 * What to send. Always EITHER a pre-approved template OR freeform text — never a bare string,
 * because which of the two is legal depends on the provider's capabilities and the
 * conversation's window. The dispatcher decides; the caller never does.
 */
export type OutboundContent =
  | { readonly kind: 'template'; readonly key: string; readonly variables: Record<string, string> }
  | { readonly kind: 'freeform'; readonly body: string; readonly mediaUrl?: string };

/** Who to send to, in whatever form this channel addresses people by. */
export interface Recipient {
  /** Canonical E.164 where the channel is phone-based. */
  readonly phoneE164: string;
  /**
   * The provider's own id for this recipient, when one is known. Preferred over deriving an
   * address from the phone number: WhatsApp issues privacy ids (`@lid`) to accounts that hide
   * their number, and for those a synthesised address does not exist. Getting this wrong took
   * down the previous system's entire engine, not just one send (docs/00-prior-art.md, M26).
   */
  readonly providerAddress?: string;
}

/** Which of our numbers to send from. */
export interface SenderRef {
  readonly id: string;
  readonly phoneE164: string;
}

/** A message the provider accepted, identified by ITS id — our idempotency key. */
export interface SendResult {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}

/** One inbound message, normalised so every provider produces the same shape. */
export interface NormalisedInboundEvent {
  readonly providerMessageId: string;
  readonly senderId: string;
  readonly fromPhoneE164: string | null;
  /** The provider's own id for the sender — may be a privacy id with no phone number attached. */
  readonly fromProviderAddress: string;
  readonly body: string;
  readonly contentType: 'text' | 'image' | 'document' | 'audio' | 'video' | 'other';
  /**
   * The provider's handle for the attachment, or null when the message carries none.
   *
   * Opaque on purpose — what it means differs per provider (Baileys can only re-download from
   * the message itself; Meta issues a media id), so nothing outside the adapter interprets it.
   * Its one job above the port is to answer "is there a file here to fetch?".
   */
  readonly mediaRef: string | null;
  readonly receivedAt: Date;
  /** The untouched provider payload, persisted before processing so it can be replayed. */
  readonly raw: unknown;
}

/**
 * The bytes behind an inbound media message.
 *
 * `declaredContentType` and `filename` are both **the sender's input**, carried through for
 * the record and for the download filename — never for deciding how to serve the file. That
 * decision is made from the bytes themselves by `detectMediaType`, because a file named
 * `cv.pdf` containing HTML is a stored-XSS payload and the name is exactly what an attacker
 * controls (docs/21-deferred.md, D-11).
 */
export interface InboundMedia {
  readonly bytes: Uint8Array;
  /** What the provider says it is. Recorded, never trusted. */
  readonly declaredContentType: string | null;
  /** What the sender called it. Unsanitised — `safeFilename` is applied before it is used. */
  readonly filename: string | null;
}

/** A delivery-state change, normalised across providers. */
export interface NormalisedStatusEvent {
  readonly providerMessageId: string;
  readonly senderId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly errorCode: string | null;
  readonly at: Date;
}

/** Connection state of one sender, as the provider currently sees it. */
export interface ProviderHealth {
  readonly senderId: string;
  readonly state: 'connecting' | 'open' | 'closed' | 'logged_out';
  readonly lastConnectedAt: Date | null;
  /** Typed disconnect reason — each carries its own backoff and risk weight (docs/08-antiban.md). */
  readonly disconnectReason: DisconnectReason | null;
}

/**
 * Why a connection dropped. Typed rather than a raw code because the response differs sharply:
 * `logged_out` is terminal and the number is gone, `restart_required` is routine, and
 * `rate_limited` means back off rather than retry. The previous system treated all failures
 * alike and reconnect-stormed through them.
 */
export type DisconnectReason =
  | 'logged_out'         // 401 — unlinked on the phone. Terminal; no reconnect.
  | 'forbidden'          // 403 — access refused. High risk signal.
  | 'timeout'            // 408
  | 'connection_closed'  // 428 — routine; self-heals with backoff.
  | 'rate_limited'       // 429 — back off hard.
  | 'connection_replaced'// 440 — linked elsewhere; another client took over.
  | 'reachout_timelock'  // 463 — messaging strangers too fast. Pause 24h.
  | 'restart_required'   // 515 — routine.
  | 'unknown';

/**
 * A change in one sender's connection to the provider.
 *
 * Emitted rather than polled because the moment a socket opens is exactly when a queued
 * message becomes sendable, and when the UI can finally say a number is linked. Nothing
 * outside the adapter can observe that transition — the socket lives inside it.
 */
export interface NormalisedConnectionEvent {
  readonly senderId: string;
  readonly state: ProviderHealth['state'];
  /** Why it closed, when it closed. Null on a successful open. */
  readonly reason: DisconnectReason | null;
  readonly at: Date;
}

/** How a linking attempt is presented to the person holding the phone. */
export type LinkChallenge =
  | { readonly mode: 'qr'; readonly qr: string; readonly expiresAt: Date }
  | { readonly mode: 'pairing_code'; readonly code: string; readonly expiresAt: Date };

/**
 * A messaging transport. Every channel — Baileys, Meta Cloud API, and the fake used in tests —
 * implements exactly this, and nothing outside packages/channels/* may import a transport SDK
 * (docs/00-prior-art.md, M1). That rule is what makes every adapter swappable, and what makes
 * the whole product testable with no WhatsApp account.
 */
export interface ChannelProvider {
  /** Which adapter this is: 'baileys' | 'meta' | 'fake'. */
  readonly name: string;

  /** Static declaration of what this transport permits. Read by the dispatcher before sending. */
  readonly capabilities: ChannelCapabilities;

  /** Begins linking a number, returning the QR or pairing code to show the user. */
  link(senderId: string, mode: 'qr' | 'pairing_code', phoneE164?: string): Promise<LinkChallenge>;

  /** Restores a previously linked sender from stored auth state. Called on process start. */
  connect(sender: SenderRef): Promise<void>;

  /** Closes the connection without unlinking. The sender can be reconnected later. */
  disconnect(senderId: string): Promise<void>;

  /** Unlinks permanently. The stored auth state becomes useless and the number must re-link. */
  logout(senderId: string): Promise<void>;

  /**
   * Sends one message. Throws on failure; the caller classifies and decides whether to retry.
   * A failure here must never affect the connection or any other recipient (M26).
   */
  send(sender: SenderRef, to: Recipient, content: OutboundContent): Promise<SendResult>;

  /**
   * Signals that a sender is `composing` (typing) to a recipient, or has `paused`.
   *
   * Optional: a transport with no presence concept omits it. Used only by the anti-ban engine's
   * typing simulation (docs/08-antiban.md, D-24) to make a send look human — an instant,
   * zero-delay send is a bot tell — so it is cosmetic, never load-bearing. A failure here must
   * be swallowed by the caller and never fail the send it precedes.
   */
  typing?(sender: SenderRef, to: Recipient, state: 'composing' | 'paused'): Promise<void>;

  /**
   * Sends a read receipt (the blue ticks) for one inbound message. Resolves true when it was
   * actually sent, false when it could not be (socket closed) so the caller leaves the message
   * unread and tries again later rather than recording a receipt that never went out.
   *
   * Optional, and used only by the anti-ban read behaviour (docs/08-antiban.md, Layer 3): a real
   * person reads a message minutes after it lands, so the gateway delays this rather than calling
   * it on arrival. Cosmetic like `typing` — a failure must never affect anything else.
   */
  markRead?(sender: SenderRef, to: Recipient, providerMessageId: string): Promise<boolean>;

  /** Inbound messages, normalised. Consumed by the gateway and republished onto the queue. */
  inbound(): AsyncIterable<NormalisedInboundEvent>;

  /**
   * Fetches the file behind an inbound message, or null when it carries none.
   *
   * Takes the whole event rather than `mediaRef` because providers differ in what they need to
   * retrieve bytes: Baileys re-downloads from the original message payload, which is why
   * `raw` is carried on every event, while Meta would use an id. Keeping the whole event in
   * the signature means neither adapter has to smuggle provider state out through a string.
   *
   * Throws when the file exists but cannot be fetched — expired, revoked, or the connection is
   * down. The caller must treat that as "message kept, attachment missing" rather than losing
   * the message, because the text of a message with a failed attachment is still worth having.
   */
  downloadMedia(event: NormalisedInboundEvent): Promise<InboundMedia | null>;

  /** Delivery-state changes, normalised. */
  status(): AsyncIterable<NormalisedStatusEvent>;

  /**
   * Connection state changes, so a caller can persist them and react the instant a socket
   * opens. Same streaming shape as `inbound()` and `status()`.
   */
  connections(): AsyncIterable<NormalisedConnectionEvent>;

  /** Current connection state for one sender. */
  health(senderId: string): Promise<ProviderHealth>;

  /** Releases every connection and stops the event streams. Called on shutdown. */
  shutdown(): Promise<void>;
}

/**
 * Where a provider keeps its credentials. Backed by Postgres rather than the filesystem, so a
 * restart restores sessions and a database restore brings the numbers back with it. Baileys'
 * own file-based helper is explicitly marked "DO NOT USE IN PROD" (M29, M30).
 */
export interface AuthStateStore {
  /** Reads one stored credential blob, or null if absent. */
  get(senderId: string, key: string): Promise<Uint8Array | null>;
  /** Writes one credential blob, encrypted at rest. */
  set(senderId: string, key: string, value: Uint8Array): Promise<void>;
  /** Removes one key. */
  remove(senderId: string, key: string): Promise<void>;
  /** Removes every key for a sender. Called on logout. */
  clear(senderId: string): Promise<void>;
  /** Lists stored keys, so an adapter can rebuild its in-memory state on connect. */
  keys(senderId: string): Promise<string[]>;
}
