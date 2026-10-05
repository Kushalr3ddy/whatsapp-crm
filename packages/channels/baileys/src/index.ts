import makeWASocket, {
  Browsers, DisconnectReason as BaileysDisconnect, downloadMediaMessage,
  fetchLatestBaileysVersion,
  type WASocket, type ConnectionState, type WAMessage
} from 'baileys';
import type {
  AuthStateStore, ChannelCapabilities, ChannelProvider, DisconnectReason, InboundMedia,
  LinkChallenge,
  NormalisedConnectionEvent, NormalisedInboundEvent, NormalisedStatusEvent, OutboundContent,
  ProviderHealth, Recipient,
  SenderRef, SendResult
} from '@crm/channels';
import { loadAuthState, hasStoredSession } from './auth-adapter.js';
import { EventStream } from './event-stream.js';
import { tapDecryptFailures } from './decrypt-tap.js';
import { toBaileysContent } from './outbound-content.js';

/** The minimum logger shape Baileys requires. Satisfied by pino. */
export interface BaileysLogger {
  child(bindings: Record<string, unknown>): BaileysLogger;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  trace(obj: unknown, msg?: string): void;
  level: string;
}

/** Everything the adapter needs from the outside, passed in rather than imported. */
export interface BaileysProviderOptions {
  readonly authStore: AuthStateStore;
  readonly logger: BaileysLogger;
  /** How long a QR stays valid before the caller should request a fresh one. */
  readonly qrTtlMs?: number;
  /**
   * Called each time Baileys reports a frame it could not decrypt on this sender's socket. The
   * gateway turns a burst of these into a health signal (docs/08-antiban.md, Layer 5).
   */
  readonly onDecryptFailure?: (senderId: string, at: Date) => void;
}

/**
 * Reconnection budget.
 *
 * WhatsApp closes the socket with 515 `restart_required` immediately after a QR pairing and
 * expects the client straight back with the credentials it has just issued — so that case
 * reconnects at once and is not counted as a failure. Everything else backs off, because a
 * reconnect storm is one of the behaviours that gets a number banned (docs/08-antiban.md).
 */
const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 60_000;
/** 429 means we are already going too fast; retrying soon would make it worse. */
const RECONNECT_RATE_LIMITED_MS = 5 * 60_000;

/**
 * What this transport can and cannot do, declared up front.
 *
 * The dispatcher reads this to reject an illegal send BEFORE calling the provider, rather than
 * discovering the problem at the wire. Baileys has no 24-hour service window and needs no
 * template pre-approval — unlike the official Meta API — and those differences are real product
 * behaviour, not details to hide behind a uniform `send(text)` (docs/04-architecture.md).
 */
const BAILEYS_CAPABILITIES: ChannelCapabilities = {
  freeformOutsideWindow: true,
  sessionWindowHours: null,
  requiresApprovedTemplate: false,
  supportsDeliveryReceipts: true,
  supportsMedia: true,
  supportsInteractive: false,
  // Not a technical limit — a safety one. See docs/08-antiban.md; the engine enforces it.
  perSenderDailyCap: 1500,
  costPerMessage: false
};

/** One live WhatsApp connection plus the state we track alongside it. */
interface Connection {
  socket: WASocket;
  state: ProviderHealth['state'];
  lastConnectedAt: Date | null;
  disconnectReason: DisconnectReason | null;
  /** Resolves with the QR string the first time WhatsApp issues one. */
  pendingQr: { resolve: (qr: string) => void; reject: (e: Error) => void } | null;
}

/**
 * Talks to WhatsApp through Baileys, an unofficial client that works by presenting itself as
 * WhatsApp Web.
 *
 * This is the free transport. It is also the one that can get a number permanently banned, with
 * no appeal — see docs/08-antiban.md. Nothing in this class rate-limits anything: pacing, warmup
 * and the safety gates live in the dispatcher above it, so that every producer passes through
 * them and none can bypass by reaching the provider directly (M12).
 */
export class BaileysChannelProvider implements ChannelProvider {
  readonly name = 'baileys';
  readonly capabilities = BAILEYS_CAPABILITIES;

  readonly #connections = new Map<string, Connection>();
  readonly #inbound = new EventStream<NormalisedInboundEvent>();
  readonly #status = new EventStream<NormalisedStatusEvent>();
  readonly #connectionEvents = new EventStream<NormalisedConnectionEvent>();
  /** Consecutive failed reconnects per sender, so backoff grows and eventually gives up. */
  readonly #reconnectAttempts = new Map<string, number>();
  /** Scheduled reconnects, kept so shutdown can cancel them instead of firing into a closed pool. */
  readonly #reconnectTimers = new Map<string, NodeJS.Timeout>();
  readonly #options: BaileysProviderOptions;
  #shuttingDown = false;

  /** Takes the credential store and logger; opens no connection until asked. */
  constructor(options: BaileysProviderOptions) {
    this.#options = options;
  }

  /**
   * Starts the linking flow for a number that has no stored session.
   *
   * QR mode returns the string to render as a barcode. Pairing-code mode returns an eight-digit
   * code typed into the phone instead — which matters because it lets someone link a number they
   * are not physically holding, the exact situation here where the phones belong to other people.
   */
  async link(senderId: string, mode: 'qr' | 'pairing_code', phoneE164?: string): Promise<LinkChallenge> {
    const ttl = this.#options.qrTtlMs ?? 60_000;
    const expiresAt = new Date(Date.now() + ttl);

    if (mode === 'pairing_code') {
      if (phoneE164 === undefined || phoneE164 === '') {
        throw new Error('pairing_code mode needs the phone number being linked');
      }
      const conn = await this.#openSocket(senderId, { expectQr: false });
      // Baileys wants the number without a leading + and without punctuation.
      const code = await conn.socket.requestPairingCode(phoneE164.replace(/\D/g, ''));
      return { mode: 'pairing_code', code, expiresAt };
    }

    const conn = await this.#openSocket(senderId, { expectQr: true });
    const qr = await new Promise<string>((resolve, reject) => {
      conn.pendingQr = { resolve, reject };
      setTimeout(() => { reject(new Error('WhatsApp did not issue a QR within the timeout')); }, ttl);
    });
    return { mode: 'qr', qr, expiresAt };
  }

  /**
   * Restores a previously linked number from its stored credentials. This is what runs on boot
   * so that a restart costs nothing — the credentials live in Postgres, not on disk (M29/M30).
   */
  async connect(sender: SenderRef): Promise<void> {
    if (!(await hasStoredSession(this.#options.authStore, sender.id))) {
      throw new Error(`sender ${sender.id} has no stored session — call link() first`);
    }
    await this.#openSocket(sender.id, { expectQr: false });
  }

  /** Closes the connection but keeps the credentials, so it can be restored later. */
  async disconnect(senderId: string): Promise<void> {
    const conn = this.#connections.get(senderId);
    if (!conn) return;
    conn.socket.end(undefined);
    conn.state = 'closed';
    this.#connections.delete(senderId);
  }

  /**
   * Unlinks from WhatsApp's side and destroys the stored credentials. Keeping them after a
   * logout would only feed a reconnect loop that can never succeed.
   */
  async logout(senderId: string): Promise<void> {
    const conn = this.#connections.get(senderId);
    if (conn) {
      try { await conn.socket.logout(); } catch { /* already gone from WhatsApp's side */ }
      this.#connections.delete(senderId);
    }
    await this.#options.authStore.clear(senderId);
  }

  /** Sends one message. Failure is per-recipient and never takes the connection down (M26). */
  async send(sender: SenderRef, to: Recipient, content: OutboundContent): Promise<SendResult> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') {
      throw new Error(`sender ${sender.id} is not connected`);
    }
    if (content.kind === 'template') {
      // Baileys has no template concept; the dispatcher renders templates to text before
      // reaching here. Arriving with one means a routing bug worth failing loudly on.
      throw new Error('baileys does not send templates — render to freeform before dispatch');
    }

    // Prefer the address WhatsApp itself gave us. Synthesising `<number>@s.whatsapp.net` for a
    // privacy-mode contact addresses a chat that does not exist, and in the previous system that
    // crashed the whole engine rather than one send — a permanent crash loop (M26).
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    const sent = await conn.socket.sendMessage(jid, toBaileysContent(content) as never);
    if (!sent?.key.id) throw new Error('WhatsApp accepted the send but returned no message id');

    return { providerMessageId: sent.key.id, acceptedAt: new Date() };
  }

  /**
   * Shows or clears the "typing…" indicator to a recipient (docs/08-antiban.md, D-24).
   *
   * Best-effort: presence is cosmetic anti-ban, never correctness, so a closed socket or a
   * refused update is a silent no-op — the caller must never let it fail the send it precedes.
   */
  async typing(sender: SenderRef, to: Recipient, state: 'composing' | 'paused'): Promise<void> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return;
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    await conn.socket.sendPresenceUpdate(state, jid);
  }

  /** Sets this number's own online/offline presence; false when the socket is not open. */
  async presence(sender: SenderRef, state: 'available' | 'unavailable'): Promise<boolean> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return false;
    await conn.socket.sendPresenceUpdate(state);
    return true;
  }

  /** Sends the blue ticks for one inbound message; false when the socket is not open. */
  async markRead(sender: SenderRef, to: Recipient, providerMessageId: string): Promise<boolean> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return false;
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    await conn.socket.readMessages([{ remoteJid: jid, id: providerMessageId, fromMe: false }]);
    return true;
  }

  /** Inbound messages, normalised so callers never see Baileys' own shapes. */
  inbound(): AsyncIterable<NormalisedInboundEvent> {
    return this.#inbound;
  }

  /** Delivery receipts, normalised to one status vocabulary across every provider. */
  status(): AsyncIterable<NormalisedStatusEvent> {
    return this.#status;
  }

  /**
   * Re-downloads the file behind an inbound message.
   *
   * Baileys has no "fetch media by id": WhatsApp media is encrypted per message, and the keys
   * needed to decrypt it live in the message payload. That is why the event carries `raw` and
   * why this takes the event rather than a handle.
   *
   * `reuploadRequest` is not optional in practice. WhatsApp expires media on its servers, and
   * when that has happened the only way to get the bytes is to ask the sender's device to
   * re-upload them — which needs a live socket, so this fails rather than returning nothing
   * when the sender is not connected. The caller keeps the message either way.
   */
  async downloadMedia(event: NormalisedInboundEvent): Promise<InboundMedia | null> {
    if (event.mediaRef === null) return null;

    const conn = this.#connections.get(event.senderId);
    if (!conn || conn.state !== 'open') {
      throw new Error(`sender ${event.senderId} is not connected, so media cannot be downloaded`);
    }

    const message = event.raw as WAMessage;
    const bytes = await downloadMediaMessage(message, 'buffer', {}, {
      logger: this.#options.logger,
      reuploadRequest: conn.socket.updateMediaMessage
    });

    const content = message.message ?? {};
    // Both of these are the SENDER's words about their own file. Carried through for the
    // record and for the saved filename; never used to decide how the file is served.
    const declared = content.imageMessage?.mimetype ?? content.videoMessage?.mimetype
      ?? content.documentMessage?.mimetype ?? content.audioMessage?.mimetype ?? null;
    const filename = content.documentMessage?.fileName ?? null;

    return { bytes: new Uint8Array(bytes), declaredContentType: declared, filename };
  }

  /** Connection state changes, so the gateway can persist them as they happen. */
  connections(): AsyncIterable<NormalisedConnectionEvent> {
    return this.#connectionEvents;
  }

  /** Current connection state for one sender. */
  async health(senderId: string): Promise<ProviderHealth> {
    const conn = this.#connections.get(senderId);
    return {
      senderId,
      state: conn?.state ?? 'closed',
      lastConnectedAt: conn?.lastConnectedAt ?? null,
      disconnectReason: conn?.disconnectReason ?? null
    };
  }

  /** Closes every connection and ends both streams, so a process can exit cleanly. */
  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    for (const timer of this.#reconnectTimers.values()) clearTimeout(timer);
    this.#reconnectTimers.clear();
    for (const senderId of [...this.#connections.keys()]) {
      await this.disconnect(senderId);
    }
    this.#inbound.close();
    this.#status.close();
  }

  /** Opens a socket and wires every Baileys event onto our normalised streams. */
  async #openSocket(senderId: string, opts: { expectQr: boolean }): Promise<Connection> {
    const existing = this.#connections.get(senderId);
    if (existing) return existing;

    const { state, saveCreds } = await loadAuthState(this.#options.authStore, senderId);
    const { version } = await fetchLatestBaileysVersion();
    const onFail = this.#options.onDecryptFailure;

    const socket = makeWASocket({
      version,
      auth: state,
      logger: (onFail
        ? tapDecryptFailures(this.#options.logger, () => { onFail(senderId, new Date()); })
        : this.#options.logger) as never,
      // Identify as a desktop browser. A plausible, stable client fingerprint matters — the
      // detection heuristics notice inconsistency across sessions (docs/08-antiban.md).
      browser: Browsers.ubuntu('Chrome'),
      // We render the QR ourselves; printing it to stdout would put a credential in the logs.
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    const conn: Connection = {
      socket, state: 'connecting', lastConnectedAt: null, disconnectReason: null, pendingQr: null
    };
    this.#connections.set(senderId, conn);

    socket.ev.on('creds.update', () => { void saveCreds(); });
    socket.ev.on('connection.update', (u) => { this.#onConnectionUpdate(senderId, conn, u, opts.expectQr); });
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;   // 'append' is history sync, not new traffic
      for (const m of messages) this.#emitInbound(senderId, m);
    });
    socket.ev.on('messages.update', (updates) => {
      for (const u of updates) this.#emitStatus(senderId, u);
    });

    return conn;
  }

  /** Handles connection lifecycle: QR issued, opened, or closed with a typed reason. */
  #onConnectionUpdate(
    senderId: string, conn: Connection, update: Partial<ConnectionState>, expectQr: boolean
  ): void {
    if (update.qr !== undefined && expectQr && conn.pendingQr) {
      conn.pendingQr.resolve(update.qr);
      conn.pendingQr = null;
    }

    if (update.connection === 'open') {
      conn.state = 'open';
      conn.lastConnectedAt = new Date();
      conn.disconnectReason = null;
      // A successful open clears the budget: the next failure starts backing off from scratch.
      this.#reconnectAttempts.delete(senderId);
      this.#options.logger.info({ senderId }, 'whatsapp connection open');
      this.#connectionEvents.push({ senderId, state: 'open', reason: null, at: new Date() });
    }

    if (update.connection === 'close') {
      const statusCode = extractStatusCode(update.lastDisconnect);
      const reason = mapDisconnectReason(statusCode);
      conn.disconnectReason = reason;
      // Logged out is terminal: the number was unlinked on the phone, so reconnecting cannot
      // work and retrying would only look like abuse. Everything else stays reconnectable.
      conn.state = reason === 'logged_out' ? 'logged_out' : 'closed';
      this.#connections.delete(senderId);
      this.#options.logger.warn({ senderId, statusCode, reason }, 'whatsapp connection closed');
      this.#connectionEvents.push({ senderId, state: conn.state, reason, at: new Date() });
      this.#scheduleReconnect(senderId, reason);
    }
  }

  /**
   * Brings a dropped connection back, unless doing so would be pointless or harmful.
   *
   * This is the step whose absence made linking impossible: WhatsApp *always* closes the
   * socket with 515 `restart_required` straight after a QR is scanned, and the credentials it
   * just issued are only usable by reconnecting with them. Without this the scan succeeds, the
   * credentials are stored, and the number still never comes online.
   *
   * `restart_required` therefore reconnects immediately and does not spend the retry budget —
   * it is a handshake step, not a failure. Everything else backs off exponentially, and
   * `logged_out` never retries at all because the number is gone from the phone's side.
   */
  #scheduleReconnect(senderId: string, reason: DisconnectReason): void {
    if (this.#shuttingDown) return;
    if (reason === 'logged_out') return;

    const handshake = reason === 'restart_required';
    const attempts = handshake ? 0 : (this.#reconnectAttempts.get(senderId) ?? 0) + 1;
    if (!handshake) this.#reconnectAttempts.set(senderId, attempts);

    if (attempts > RECONNECT_MAX_ATTEMPTS) {
      this.#options.logger.error(
        { senderId, reason, attempts },
        'giving up reconnecting — the number needs attention'
      );
      return;
    }

    const delay = handshake
      ? 0
      : reason === 'rate_limited'
        ? RECONNECT_RATE_LIMITED_MS
        : Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_CAP_MS);

    const existing = this.#reconnectTimers.get(senderId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.#reconnectTimers.delete(senderId);
      if (this.#shuttingDown) return;
      this.#options.logger.info({ senderId, reason, attempts, delay }, 'reconnecting');
      void this.#openSocket(senderId, { expectQr: false }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.#options.logger.warn({ senderId, err: message }, 'reconnect attempt failed');
        // A throw here means the socket never opened, so no close event will arrive to
        // schedule the next try. Drive the backoff from here instead.
        this.#scheduleReconnect(senderId, 'unknown');
      });
    }, delay);
    // Never hold the process open purely to retry a connection.
    timer.unref();
    this.#reconnectTimers.set(senderId, timer);
  }

  /** Converts one Baileys message into the normalised inbound shape. */
  #emitInbound(senderId: string, raw: unknown): void {
    if (this.#shuttingDown) return;
    const m = raw as {
      key?: { id?: string; remoteJid?: string; fromMe?: boolean };
      message?: Record<string, unknown> | null;
      messageTimestamp?: number | Long;
    };
    // Our own outbound messages echo back through this event; they are already recorded.
    if (m.key?.fromMe === true || !m.key?.id || !m.key.remoteJid || !m.message) return;

    const jid = m.key.remoteJid;
    // Group traffic is out of scope for now, and a group jid is not a person.
    if (jid.endsWith('@g.us') || jid === 'status@broadcast') return;

    const { body, contentType } = extractBody(m.message);
    // Baileys cannot fetch an attachment from an id — it re-downloads from the message
    // payload, which is carried on `raw`. So the ref is just the message id: its only job
    // above the port is to say that a file exists here at all.
    const hasMedia = contentType !== 'text' && contentType !== 'other';
    this.#inbound.push({
      providerMessageId: m.key.id,
      senderId,
      // A "@lid" address is WhatsApp's privacy id and carries no phone number. Resolving it is
      // the caller's job via contact_identity — it is simply another identity for one person.
      fromPhoneE164: jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0] ?? ''}` : null,
      fromProviderAddress: jid,
      body,
      contentType,
      mediaRef: hasMedia ? m.key.id : null,
      receivedAt: toDate(m.messageTimestamp),
      raw
    });
  }

  /** Converts one Baileys delivery update into the normalised status shape. */
  #emitStatus(senderId: string, raw: unknown): void {
    if (this.#shuttingDown) return;
    const u = raw as { key?: { id?: string }; update?: { status?: number } };
    const id = u.key?.id;
    const code = u.update?.status;
    if (id === undefined || code === undefined) return;

    const status = mapStatus(code);
    if (status === null) return;
    this.#status.push({ providerMessageId: id, senderId, status, errorCode: null, at: new Date() });
  }
}

/** Baileys timestamps arrive as a number or a protobuf Long; both mean seconds. */
type Long = { toNumber(): number };

/** Normalises a Baileys timestamp into a Date, falling back to now when absent. */
export function toDate(ts: number | Long | undefined): Date {
  if (ts === undefined) return new Date();
  const seconds = typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(seconds * 1000);
}

/** Pulls the status code out of Baileys' disconnect error, which is a Boom instance. */
export function extractStatusCode(lastDisconnect: unknown): number | null {
  const d = lastDisconnect as { error?: { output?: { statusCode?: number } } } | undefined;
  return d?.error?.output?.statusCode ?? null;
}

/**
 * Maps WhatsApp's status codes onto our vocabulary. Typed rather than generic because each one
 * implies a different response: 401 is terminal, 429 means back off hard, 463 means pause for a
 * day. The previous system treated every failure identically and retried into a ban.
 */
export function mapDisconnectReason(code: number | null): DisconnectReason {
  switch (code) {
    case BaileysDisconnect.loggedOut: return 'logged_out';           // 401
    case BaileysDisconnect.forbidden: return 'forbidden';            // 403
    case BaileysDisconnect.timedOut: return 'timeout';               // 408
    case BaileysDisconnect.connectionClosed: return 'connection_closed'; // 428
    case BaileysDisconnect.connectionLost: return 'connection_closed';
    case BaileysDisconnect.connectionReplaced: return 'connection_replaced'; // 440
    case BaileysDisconnect.restartRequired: return 'restart_required';   // 515
    case 429: return 'rate_limited';
    case 463: return 'reachout_timelock';
    default: return 'unknown';
  }
}

/** Maps Baileys' numeric delivery status onto our four states. */
export function mapStatus(code: number): NormalisedStatusEvent['status'] | null {
  switch (code) {
    case 1: return 'sent';       // pending
    case 2: return 'sent';       // server ack
    case 3: return 'delivered';  // delivery ack
    case 4: return 'read';
    case 5: return 'read';       // played, for voice notes
    default: return null;
  }
}

/** Extracts readable text and a content type from Baileys' nested message union. */
export function extractBody(message: Record<string, unknown>): {
  body: string; contentType: NormalisedInboundEvent['contentType'];
} {
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
    audioMessage?: unknown;
  };
  if (typeof m.conversation === 'string') return { body: m.conversation, contentType: 'text' };
  if (m.extendedTextMessage?.text !== undefined) return { body: m.extendedTextMessage.text, contentType: 'text' };
  if (m.imageMessage) return { body: m.imageMessage.caption ?? '', contentType: 'image' };
  if (m.videoMessage) return { body: m.videoMessage.caption ?? '', contentType: 'video' };
  if (m.documentMessage) return { body: m.documentMessage.caption ?? m.documentMessage.fileName ?? '', contentType: 'document' };
  if (m.audioMessage) return { body: '', contentType: 'audio' };
  return { body: '', contentType: 'other' };
}

export { loadAuthState, hasStoredSession } from './auth-adapter.js';
export { EventStream } from './event-stream.js';
