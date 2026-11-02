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
  | { readonly kind: 'freeform'; readonly body: string; readonly media?: OutboundMedia };

/**
 * A file to send, handed over as bytes rather than a URL. The gateway reads it from storage and
 * the adapter uploads it; a URL would be a second way to reach a file, and the only authorisation
 * a stored file has is the database walk that resolves it (docs/21-deferred.md, D-11). For a
 * media message `body` is the caption (possibly empty).
 */
export interface OutboundMedia {
  readonly bytes: Uint8Array;
  /** Detected from the bytes at upload, never from a filename or a client's claim. */
  readonly contentType: string;
  readonly filename: string | null;
  /** True for a clip made from a GIF: sent as a video with GIF playback, so WhatsApp loops it silently like a GIF. */
  readonly gifPlayback?: boolean;
}

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
  /**
   * The sender's phone number when `fromProviderAddress` is a privacy id but the provider also
   * supplied the number (Baileys: `key.senderPn`). Lets the caller attach the number to the same
   * contact instead of leaving a person with no phone. Absent when the provider did not say.
   */
  readonly linkedPhoneE164?: string | null;
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
  /**
   * True when the owner sent this message themselves, from their own phone or another linked device, rather than the contact
   * sending it to us (D-94). `fromPhoneE164` / `fromProviderAddress` then name the OTHER person in the chat. Messages the CRM
   * itself sent are never reported this way (they are already recorded). Absent or false for ordinary inbound traffic.
   */
  readonly fromMe?: boolean;
  /** The untouched provider payload, persisted before processing so it can be replayed. */
  readonly raw: unknown;
}

/** A privacy address and the phone number the provider says it belongs to. */
export interface NormalisedIdentityLink {
  readonly senderId: string;
  readonly providerAddress: string;
  readonly phoneE164: string;
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
  /** Typed disconnect reason — each carries its own backoff. */
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
  /** The provider's raw close code (WhatsApp: 401, 403, 428, 463, …), when it gave one. */
  readonly code?: number | null;
  /**
   * What the provider said about why, when it said more than a code (WhatsApp: the stream error's
   * `<conflict type='device_removed'/>` child, as `device_removed`). Tells an unlink on the phone from a ban.
   */
  readonly detail?: string | null;
  /**
   * The phone number the connection belongs to (E.164), reported on open when the transport knows it.
   * Lets the app fill in a number's own phone after linking instead of showing "no number yet".
   */
  readonly phoneE164?: string | null | undefined;
  readonly at: Date;
}

/**
 * A limit warning WhatsApp sent one of our numbers (F6 S2). Two kinds, both about starting new chats: the reachout timelock
 * (WhatsApp is not letting the number message people who have not written to it, until a time) and the new-chat cap (how many
 * new chats the number may start in a cycle, and how close it is). Emitted rather than polled, because they arrive on their own.
 */
export type NormalisedNoticeEvent =
  | {
    readonly kind: 'timelock';
    readonly senderId: string;
    /** False when WhatsApp lifted the restriction. */
    readonly active: boolean;
    /** When the restriction ends, when WhatsApp said. */
    readonly until: Date | null;
    /** WhatsApp's type: `DEFAULT`, `WEB_COMPANION_ONLY`, a `BIZ_…` violation kind. */
    readonly enforcementType: string | null;
    readonly at: Date;
    readonly raw?: unknown;
  }
  | {
    readonly kind: 'capping';
    readonly senderId: string;
    /** `NONE`, `FIRST_WARNING`, `SECOND_WARNING` or `CAPPED`. */
    readonly status: 'NONE' | 'FIRST_WARNING' | 'SECOND_WARNING' | 'CAPPED' | null;
    readonly totalQuota: number | null;
    readonly usedQuota: number | null;
    readonly cycleStart: Date | null;
    readonly cycleEnd: Date | null;
    readonly at: Date;
    readonly raw?: unknown;
  };

/**
 * A contact's phone asked us to send a message again because it could not decrypt it: it shows "Waiting for this message" until we
 * answer (F6 S5). Baileys answers by itself; the event lets the gateway hold new sends to that contact and count the retries.
 */
export interface NormalisedRetryEvent {
  readonly senderId: string;
  /** WhatsApp's id for the message we sent. */
  readonly providerMessageId: string;
  readonly at: Date;
}

/**
 * What a contact's profile shows this number right now (F6 S4). Both are hidden from a number that was blocked, and from one the contact
 * never shared them with, so they are only evidence together and compared with how they looked at the last delivery.
 */
export interface ProfileVisibility {
  /** The profile photo can be fetched. */
  readonly photo: boolean;
  /** The "about" text can be fetched. */
  readonly about: boolean;
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
   * Sends one message. Throws on failure; the caller classifies it and never retries it automatically. A refusal by WhatsApp that
   * carries a status code throws an error whose `statusCode` is that code (463 is the one the gateway acts on, F6 AC-2.6).
   * A failure here must never affect the connection or any other recipient (M26).
   */
  send(sender: SenderRef, to: Recipient, content: OutboundContent): Promise<SendResult>;

  /**
   * Signals that a sender is `composing` (typing) to a recipient, or has `paused`.
   *
   * Optional: a transport with no presence concept omits it. Used only by the typing
   * simulation (D-24) to make a send look human — an instant,
   * zero-delay send is a bot tell — so it is cosmetic, never load-bearing. A failure here must
   * be swallowed by the caller and never fail the send it precedes.
   */
  typing?(sender: SenderRef, to: Recipient, state: 'composing' | 'paused'): Promise<void>;

  /**
   * Shows the number as online (`available`) or offline (`unavailable`). The gateway sets it `available` before the first send of
   * a run and `unavailable` after 90 s with nothing sent, so the number is never left online (F6 AC-1.6).
   *
   * Optional: a transport with no presence concept omits it. Cosmetic like `typing`: a failure is swallowed by the caller.
   */
  presence?(sender: SenderRef, state: 'available' | 'unavailable'): Promise<void>;

  /**
   * Tells WhatsApp that messages from a recipient were read (the blue ticks they see). The gateway calls it when an agent opens the
   * chat, or a few seconds before the reply to them starts typing, and never when a message arrives (F6 AC-1.7).
   *
   * Optional: a transport with no read receipts omits it.
   */
  markRead?(sender: SenderRef, from: Recipient, providerMessageIds: readonly string[]): Promise<void>;

  /**
   * Asks whether a phone number has a WhatsApp account, the lookup the app does when you type a
   * number into "new chat". Resolves `true` or `false` when the answer is known and `null` when it
   * could not be asked (socket closed, query failed), in which case the caller must not act on it.
   *
   * Optional: a transport with no such lookup omits it. Used only by the number fallback
   * (docs/21-deferred.md, D-60), and only for a contact with more than one number, one number per
   * send and cached, never as a bulk sweep: a stream of existence lookups from one session is the
   * kind of pattern reported to get numbers restricted.
   */
  isRegistered?(sender: SenderRef, phoneE164: string): Promise<boolean | null>;

  /**
   * Whether the contact's profile photo and about can be seen from this number (F6 AC-4.2). Resolves `null` when it could not be asked
   * (socket closed, query failed), which the caller must not read as "hidden".
   *
   * Optional: a transport with no profile lookups omits it, and the checks that need it do nothing. Called at most once per contact per
   * day by the caller: a stream of profile lookups is itself a pattern to avoid.
   */
  profileSnapshot?(sender: SenderRef, to: Recipient): Promise<ProfileVisibility | null>;

  /**
   * Throws away the encryption session with a contact so the next message starts a fresh one (F6 AC-5.3). The gateway calls it when the
   * same message has been asked for twice, which means the session is out of step with the contact's phone. Optional.
   */
  resetSession?(sender: SenderRef, to: Recipient): Promise<void>;

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
   * Optional. Moments when the provider reveals which phone number a privacy address belongs to
   * (WhatsApp: a person shares their number). The caller links the two onto one contact.
   */
  identityLinks?(): AsyncIterable<NormalisedIdentityLink>;

  /**
   * Optional. Limit warnings from WhatsApp: the reachout timelock and the new-chat cap (F6 S2). The gateway stores the latest of
   * each on the number and every raw one as a notice.
   */
  notices?(): AsyncIterable<NormalisedNoticeEvent>;

  /**
   * Optional. A contact's phone asking for a message of ours again (F6 S5). The provider answers the request itself; this only reports it.
   */
  retries?(): AsyncIterable<NormalisedRetryEvent>;

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
