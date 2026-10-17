import type {
  AuthStateStore, ChannelCapabilities, ChannelProvider, DisconnectReason, LinkChallenge,
  NormalisedConnectionEvent, NormalisedInboundEvent, NormalisedStatusEvent, OutboundContent,
  ProviderHealth,
  Recipient, SenderRef, SendResult, InboundMedia } from '@crm/channels';

/**
 * A sent message, kept in memory so tests can assert on what would have gone out.
 */
export interface FakeSentMessage {
  readonly senderId: string;
  readonly to: Recipient;
  readonly content: OutboundContent;
  readonly providerMessageId: string;
  readonly at: Date;
}

/** Knobs for making the fake misbehave on purpose. */
export interface FakeOptions {
  /** Capability overrides, for testing a Meta-shaped transport without Meta. */
  readonly capabilities?: Partial<ChannelCapabilities>;
  /** Recipients whose sends always throw, for testing per-recipient failure isolation. */
  readonly failFor?: readonly string[];
  /** Make every send throw, for testing outage handling. */
  readonly failAll?: boolean;
  /**
   * When set, every accepted send is reported `delivered` this many milliseconds later, as a
   * healthy real number would. Off by default so unit tests control receipts themselves; the
   * fake gateway turns it on, because without receipts the health scorer reads a day of
   * undelivered sends as a delivery collapse and pauses the number for 48 hours.
   */
  readonly autoDeliverAfterMs?: number;
}

/** Baileys-like defaults: free, unofficial, no window, no template requirement. */
const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  freeformOutsideWindow: true,
  sessionWindowHours: null,
  requiresApprovedTemplate: false,
  supportsDeliveryReceipts: true,
  supportsMedia: true,
  supportsInteractive: false,
  perSenderDailyCap: null,
  costPerMessage: false
};

/**
 * An in-memory ChannelProvider. Sends nothing; records everything.
 *
 * This is the single most useful object in the test suite. With it, the dispatcher, the
 * anti-ban engine, campaigns, the inbox and the whole inbound pipeline are testable with no
 * WhatsApp account, no phone and no ban risk. The previous system had no such thing, which is
 * why its own docs describe changes as "verified live against the real OpenWA session" —
 * i.e. by messaging real people (docs/00-prior-art.md, M20).
 *
 * It also proves the port is implementable by something that is not Baileys, which is the
 * cheapest possible check that the abstraction has not quietly leaked.
 */
export class FakeChannelProvider implements ChannelProvider {
  readonly name = 'fake';
  readonly capabilities: ChannelCapabilities;

  /** Everything "sent", in order. Assert against this instead of a real account. */
  readonly sent: FakeSentMessage[] = [];

  /** Every typing-presence call, in order, so a test can assert composing fired before the send. */
  readonly typingCalls: Array<{ senderId: string; to: Recipient; state: 'composing' | 'paused' }> = [];
  /** Numbers (E.164) this fake reports as having no WhatsApp account; every other number is registered. */
  readonly unregistered = new Set<string>();
  /** Every registration lookup, in order, so a test can assert how many were made and for which numbers. */
  readonly registrationChecks: string[] = [];
  /** When set, lookups answer "could not tell" (null), as a closed socket or a failed query would. */
  registrationUnknown = false;

  /** Every read receipt sent, in order, so a test can assert when (and whether) one went out. */
  readonly readCalls: Array<{ senderId: string; to: Recipient; providerMessageId: string }> = [];

  /** Every own-presence call, in order, so a test can assert the entropy blip fired. */
  readonly presenceCalls: Array<{ senderId: string; state: 'available' | 'unavailable' }> = [];

  private readonly health_ = new Map<string, ProviderHealth>();
  private readonly inboundQueue: NormalisedInboundEvent[] = [];
  /** Attachments this fake will hand back, keyed by the ref put on the event. */
  private readonly media = new Map<string, InboundMedia>();
  private readonly statusQueue: NormalisedStatusEvent[] = [];
  private readonly connectionQueue: NormalisedConnectionEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly options: FakeOptions;
  private counter = 0;
  /**
   * Distinguishes this instance's ids from a previous process's. The counter alone restarts at 1 on
   * every gateway boot, and provider ids are unique in the database — a fake gateway that is
   * restarted would otherwise collide with the messages the last run stored.
   */
  private readonly run = Math.random().toString(36).slice(2, 8);
  private closed = false;

  /** Builds a fake provider, optionally with an auth store and misbehaviour configured. */
  constructor(options: FakeOptions = {}, private readonly authStore?: AuthStateStore) {
    this.options = options;
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
  }

  /** Returns a QR or pairing code immediately, as a real provider would after a round trip. */
  async link(senderId: string, mode: 'qr' | 'pairing_code'): Promise<LinkChallenge> {
    const expiresAt = new Date(Date.now() + 60_000);
    // Record that linking started, so health() is meaningful before the link completes.
    this.health_.set(senderId, {
      senderId, state: 'connecting', lastConnectedAt: null, disconnectReason: null
    });
    return mode === 'qr'
      ? { mode: 'qr', qr: `fake-qr-${senderId}-${++this.counter}`, expiresAt }
      : { mode: 'pairing_code', code: `FAKE-${String(++this.counter).padStart(4, '0')}`, expiresAt };
  }

  /** Marks a sender connected. Touches the auth store if one was supplied, as a real one would. */
  async connect(sender: SenderRef): Promise<void> {
    if (this.authStore) await this.authStore.set(sender.id, 'creds', new TextEncoder().encode('fake'));
    this.health_.set(sender.id, {
      senderId: sender.id, state: 'open', lastConnectedAt: new Date(), disconnectReason: null
    });
    this.emitConnection(sender.id, 'open', null);
  }

  /** Closes a connection without discarding credentials. */
  async disconnect(senderId: string): Promise<void> {
    this.health_.set(senderId, {
      senderId, state: 'closed', lastConnectedAt: null, disconnectReason: 'connection_closed'
    });
    this.emitConnection(senderId, 'closed', 'connection_closed');
  }

  /** Unlinks and discards stored credentials, as a real logout does. */
  async logout(senderId: string): Promise<void> {
    if (this.authStore) await this.authStore.clear(senderId);
    this.health_.set(senderId, {
      senderId, state: 'logged_out', lastConnectedAt: null, disconnectReason: 'logged_out'
    });
    this.emitConnection(senderId, 'logged_out', 'logged_out');
  }

  /**
   * Records a send, or throws if configured to fail for this recipient. Failure is per
   * recipient by design: the connection stays open, which is the behaviour a real adapter
   * must also guarantee (M26).
   */
  async send(sender: SenderRef, to: Recipient, content: OutboundContent): Promise<SendResult> {
    if (this.health_.get(sender.id)?.state !== 'open') {
      throw new Error(`sender ${sender.id} is not connected`);
    }
    if (this.options.failAll || this.options.failFor?.includes(to.phoneE164)) {
      throw new Error(`fake send failure for ${to.phoneE164}`);
    }
    const providerMessageId = `fake-msg-${this.run}-${++this.counter}`;
    this.sent.push({ senderId: sender.id, to, content, providerMessageId, at: new Date() });
    this.emitStatus({
      providerMessageId, senderId: sender.id, status: 'sent', errorCode: null, at: new Date()
    });
    const after = this.options.autoDeliverAfterMs;
    if (after !== undefined) {
      // unref'd so a pending receipt never keeps a finished process alive.
      setTimeout(() => {
        if (this.closed) return;
        this.emitStatus({
          providerMessageId, senderId: sender.id, status: 'delivered', errorCode: null, at: new Date()
        });
      }, after).unref();
    }
    return { providerMessageId, acceptedAt: new Date() };
  }

  /**
   * Records a typing-presence call instead of sending one, so a test can assert the anti-ban
   * typing simulation (docs/08-antiban.md, D-24) fired `composing` before the send. A disconnected
   * sender is a silent no-op, exactly as the real adapter treats a closed socket.
   */
  async typing(sender: SenderRef, to: Recipient, state: 'composing' | 'paused'): Promise<void> {
    if (this.health_.get(sender.id)?.state !== 'open') return;
    this.typingCalls.push({ senderId: sender.id, to, state });
  }

  /** Records an own-presence call; false (like the real adapter) when not connected. */
  async presence(sender: SenderRef, state: 'available' | 'unavailable'): Promise<boolean> {
    if (this.health_.get(sender.id)?.state !== 'open') return false;
    this.presenceCalls.push({ senderId: sender.id, state });
    return true;
  }

  /** Answers a registration lookup from `unregistered`, recording it; null when set to be unable to tell. */
  async isRegistered(_sender: SenderRef, phoneE164: string): Promise<boolean | null> {
    this.registrationChecks.push(phoneE164);
    if (this.registrationUnknown) return null;
    return !this.unregistered.has(phoneE164);
  }

  /** Records a read receipt; false (like the real adapter) when the sender is not connected. */
  async markRead(sender: SenderRef, to: Recipient, providerMessageId: string): Promise<boolean> {
    if (this.health_.get(sender.id)?.state !== 'open') return false;
    this.readCalls.push({ senderId: sender.id, to, providerMessageId });
    return true;
  }

  /**
   * Hands back media previously queued with `receiveMessage`, or null when there is none.
   *
   * Throws for a ref it does not know, which is how a real provider behaves when media has
   * expired — the contract requires the caller to keep the message and lose only the file.
   */
  async downloadMedia(event: NormalisedInboundEvent): Promise<InboundMedia | null> {
    if (event.mediaRef === null) return null;
    const media = this.media.get(event.mediaRef);
    if (media === undefined) {
      throw new Error(`no media for ref ${event.mediaRef} — expired, or never stored`);
    }
    return media;
  }

  /** Streams inbound events until shutdown. */
  async *inbound(): AsyncIterable<NormalisedInboundEvent> {
    yield* this.drain(this.inboundQueue);
  }

  /** Streams delivery-state events until shutdown. */
  async *status(): AsyncIterable<NormalisedStatusEvent> {
    yield* this.drain(this.statusQueue);
  }

  /** Streams connection state changes until shutdown. */
  async *connections(): AsyncIterable<NormalisedConnectionEvent> {
    yield* this.drain(this.connectionQueue);
  }

  /** Queues a connection event and wakes anyone waiting on the stream. */
  private emitConnection(
    senderId: string, state: ProviderHealth['state'], reason: DisconnectReason | null
  ): void {
    this.connectionQueue.push({ senderId, state, reason, at: new Date() });
    this.release();
  }

  /** Reports connection state, defaulting to closed for a sender never seen. */
  async health(senderId: string): Promise<ProviderHealth> {
    return this.health_.get(senderId) ?? {
      senderId, state: 'closed', lastConnectedAt: null, disconnectReason: null
    };
  }

  /** Stops the event streams and releases waiters so consumers can exit. */
  async shutdown(): Promise<void> {
    this.closed = true;
    this.release();
  }

  // ---- test controls, not part of the port -------------------------------------------

  /**
   * Simulates an inbound message arriving.
   *
   * Pass `media` to simulate an attachment: it is registered against a generated ref and
   * handed back by `downloadMedia`, so the whole media pipeline is exercisable with no
   * WhatsApp account. Omit it and the message carries no file, as before.
   */
  receiveMessage(
    event: Partial<NormalisedInboundEvent> & { senderId: string; fromProviderAddress: string },
    media?: InboundMedia
  ): void {
    const providerMessageId = event.providerMessageId ?? `fake-in-${this.run}-${++this.counter}`;
    let mediaRef = event.mediaRef ?? null;
    if (media !== undefined) {
      mediaRef = `fake-media-${providerMessageId}`;
      this.media.set(mediaRef, media);
    }
    this.inboundQueue.push({
      providerMessageId,
      fromPhoneE164: null, body: '', contentType: 'text',
      receivedAt: new Date(), raw: {}, ...event, mediaRef
    });
    this.release();
  }

  /** Drops a stored attachment without removing its message, to simulate expiry at the provider. */
  expireMedia(mediaRef: string): void {
    this.media.delete(mediaRef);
  }

  /** Simulates a delivery-state change from the provider. */
  emitStatus(event: NormalisedStatusEvent): void {
    this.statusQueue.push(event);
    this.release();
  }

  /** Simulates the connection dropping for a typed reason, so recovery paths are testable. */
  simulateDisconnect(senderId: string, reason: DisconnectReason): void {
    this.health_.set(senderId, {
      senderId,
      state: reason === 'logged_out' ? 'logged_out' : 'closed',
      lastConnectedAt: null,
      disconnectReason: reason
    });
  }

  // ---- internals ---------------------------------------------------------------------

  /** Yields queued items, waiting for more until shutdown. */
  private async *drain<T>(queue: T[]): AsyncIterable<T> {
    while (!this.closed) {
      while (queue.length > 0) yield queue.shift() as T;
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Wakes every stream consumer currently waiting for an event. */
  private release(): void {
    while (this.waiters.length > 0) this.waiters.shift()?.();
  }
}

/** An AuthStateStore backed by a Map. For tests that need one without a database. */
export class InMemoryAuthStateStore implements AuthStateStore {
  private readonly data = new Map<string, Map<string, Uint8Array>>();

  /** Reads one credential blob. */
  async get(senderId: string, key: string): Promise<Uint8Array | null> {
    return this.data.get(senderId)?.get(key) ?? null;
  }

  /** Writes one credential blob. */
  async set(senderId: string, key: string, value: Uint8Array): Promise<void> {
    if (!this.data.has(senderId)) this.data.set(senderId, new Map());
    this.data.get(senderId)?.set(key, value);
  }

  /** Removes one key. */
  async remove(senderId: string, key: string): Promise<void> {
    this.data.get(senderId)?.delete(key);
  }

  /** Removes every key for a sender. */
  async clear(senderId: string): Promise<void> {
    this.data.delete(senderId);
  }

  /** Lists stored keys for a sender. */
  async keys(senderId: string): Promise<string[]> {
    return [...(this.data.get(senderId)?.keys() ?? [])];
  }
}
