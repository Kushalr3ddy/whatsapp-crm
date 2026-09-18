import makeWASocket, {
  Browsers, DisconnectReason as BaileysDisconnect, fetchLatestBaileysVersion,
  type WASocket, type ConnectionState
} from 'baileys';
import type {
  AuthStateStore, ChannelCapabilities, ChannelProvider, DisconnectReason, LinkChallenge,
  NormalisedInboundEvent, NormalisedStatusEvent, OutboundContent, ProviderHealth, Recipient,
  SenderRef, SendResult
} from '@crm/channels';
import { loadAuthState, hasStoredSession } from './auth-adapter.js';
import { EventStream } from './event-stream.js';

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
}

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
    const sent = await conn.socket.sendMessage(jid, { text: content.body });
    if (!sent?.key.id) throw new Error('WhatsApp accepted the send but returned no message id');

    return { providerMessageId: sent.key.id, acceptedAt: new Date() };
  }

  /** Inbound messages, normalised so callers never see Baileys' own shapes. */
  inbound(): AsyncIterable<NormalisedInboundEvent> {
    return this.#inbound;
  }

  /** Delivery receipts, normalised to one status vocabulary across every provider. */
  status(): AsyncIterable<NormalisedStatusEvent> {
    return this.#status;
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

    const socket = makeWASocket({
      version,
      auth: state,
      logger: this.#options.logger as never,
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
      this.#options.logger.info({ senderId }, 'whatsapp connection open');
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
    }
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
    this.#inbound.push({
      providerMessageId: m.key.id,
      senderId,
      // A "@lid" address is WhatsApp's privacy id and carries no phone number. Resolving it is
      // the caller's job via contact_identity — it is simply another identity for one person.
      fromPhoneE164: jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0] ?? ''}` : null,
      fromProviderAddress: jid,
      body,
      contentType,
      mediaRef: null,
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
