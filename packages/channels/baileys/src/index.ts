import makeWASocket, {
  Browsers, DisconnectReason as BaileysDisconnect, downloadMediaMessage,
  fetchLatestBaileysVersion, normalizeMessageContent,
  type WASocket, type ConnectionState, type WAMessage
} from 'baileys';
import type {
  AuthStateStore, ChannelCapabilities, ChannelProvider, DisconnectReason, InboundMedia,
  LinkChallenge,
  NormalisedConnectionEvent, NormalisedIdentityLink, NormalisedInboundEvent, NormalisedNoticeEvent, NormalisedRetryEvent, NormalisedStatusEvent,
  OutboundContent, ProfileVisibility,
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
   * gateway turns a burst of these into a note on the session row.
   */
  readonly onDecryptFailure?: (senderId: string, at: Date, info: { own: boolean }) => void;
  /**
   * Called when a recipient asks us to send a message again because their phone could not decrypt it (it shows "Waiting for this
   * message"). `messageId` is WhatsApp's id for the message we sent. The gateway records it on the message so the thread can say so.
   */
  readonly onRetryRequest?: (senderId: string, messageId: string, at: Date) => void;
  /**
   * Gives back the text of a message this sender sent, by WhatsApp's id, when a recipient asks for it again.
   *
   * A recipient whose phone could not decrypt a message shows "Waiting for this message" and asks us to resend. Baileys can only do
   * that if it can get the original from here; without this it logs "recv retry request, but message not available" and the
   * placeholder never clears. Text only: return `undefined` for anything else.
   */
  readonly resendText?: (senderId: string, messageId: string) => Promise<string | undefined>;
  /** Builds the socket. Defaults to Baileys' `makeWASocket`; a test passes a fake to drive the lifecycle without WhatsApp. */
  readonly makeSocket?: (config: Parameters<typeof makeWASocket>[0]) => WASocket;
  /** The WhatsApp Web version to present. Defaults to asking WhatsApp for the latest; a test sets it to stay off the network. */
  readonly waVersion?: [number, number, number];
}

/**
 * Reconnection budget.
 *
 * WhatsApp closes the socket with 515 `restart_required` immediately after a QR pairing and
 * expects the client straight back with the credentials it has just issued — so that case
 * reconnects at once and is not counted as a failure. Everything else backs off, because a
 * reconnect storm is one of the behaviours that gets a number banned.
 */
const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1_000;
/** Restarts (515) in a row that are treated as the normal handshake. */
const RESTART_FREE_TRIES = 3;
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
  costPerMessage: false
};

/** One live WhatsApp connection plus the state we track alongside it. */
interface Connection {
  socket: WASocket;
  /** Waits for every credential and key write asked for so far (see `loadAuthState`). */
  flush: () => Promise<void>;
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
 * no appeal. Nothing in this class rate-limits anything: the anti-ban policy and the safety gates
 * live in the gateway above it, so that every producer passes through
 * them and none can bypass by reaching the provider directly (M12).
 */
export class BaileysChannelProvider implements ChannelProvider {
  readonly name = 'baileys';
  readonly capabilities = BAILEYS_CAPABILITIES;

  readonly #connections = new Map<string, Connection>();
  readonly #inbound = new EventStream<NormalisedInboundEvent>();
  readonly #links = new EventStream<NormalisedIdentityLink>();
  readonly #status = new EventStream<NormalisedStatusEvent>();
  readonly #connectionEvents = new EventStream<NormalisedConnectionEvent>();
  readonly #notices = new EventStream<NormalisedNoticeEvent>();
  readonly #retries = new EventStream<NormalisedRetryEvent>();
  /** Consecutive failed reconnects per sender, so backoff grows and eventually gives up. */
  readonly #reconnectAttempts = new Map<string, number>();
  /** Tries in a row that never reached WhatsApp (no internet). They only set the wait; they never give up. */
  readonly #offlineAttempts = new Map<string, number>();
  /** Restarts (515) in a row since the last open, per number. One is the normal step after a scan; many in a row is WhatsApp refusing (R-028). */
  readonly #restartStreak = new Map<string, number>();
  /** Sockets being opened right now, so two callers at the same moment share one (R-027). */
  readonly #opening = new Map<string, Promise<Connection>>();
  /** Link attempts in progress, so pressing Link twice at the same moment is one attempt (R-027). */
  readonly #linking = new Map<string, Promise<LinkChallenge>>();
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
    const running = this.#linking.get(senderId);
    if (running !== undefined) return running;
    const attempt = this.#link(senderId, mode, phoneE164).finally(() => { this.#linking.delete(senderId); });
    this.#linking.set(senderId, attempt);
    return attempt;
  }

  /** One link attempt; `link` makes sure only one runs per number at a time. */
  async #link(senderId: string, mode: 'qr' | 'pairing_code', phoneE164?: string): Promise<LinkChallenge> {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const qr = await new Promise<string>((resolve, reject) => {
        conn.pendingQr = { resolve, reject };
        timer = setTimeout(() => {
          reject(Object.assign(new Error('WhatsApp did not issue a QR within the timeout'), { code: 'qr_timeout' }));
        }, ttl);
      });
      return { mode: 'qr', qr, expiresAt };
    } catch (error) {
      // Do not leave a half-open socket behind: it would keep trying to register in the background.
      conn.pendingQr = null;
      this.#connections.delete(senderId);
      try { conn.socket.end(undefined); } catch { /* already closed */ }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    // Let the last session writes land before the process may exit: a session behind what WhatsApp has acknowledged is what breaks
    // the number after a restart (D-82). Bounded, so a stuck database cannot hold a shutdown forever.
    await Promise.race([conn.flush(), new Promise<void>((resolve) => { setTimeout(resolve, 10_000).unref(); })]);
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
    let sent;
    try {
      sent = await conn.socket.sendMessage(jid, toBaileysContent(content) as never);
    } catch (error) {
      // WhatsApp's refusal carries its status code (a Boom error keeps it under `output`): put it where the gateway looks, so a 463
      // is told apart from any other failure (F6 AC-2.6).
      const code = (error as { output?: { statusCode?: number } } | null)?.output?.statusCode;
      if (typeof code === 'number' && error instanceof Error && (error as { statusCode?: number }).statusCode === undefined) {
        throw Object.assign(error, { statusCode: code });
      }
      throw error;
    }
    if (!sent?.key.id) throw new Error('WhatsApp accepted the send but returned no message id');
    this.#rememberSent(sent.key.id);

    return { providerMessageId: sent.key.id, acceptedAt: new Date() };
  }

  /**
   * Shows or clears the "typing…" indicator to a recipient (D-24).
   *
   * Best-effort: presence is cosmetic, never correctness, so a closed socket or a
   * refused update is a silent no-op — the caller must never let it fail the send it precedes.
   */
  async typing(sender: SenderRef, to: Recipient, state: 'composing' | 'paused'): Promise<void> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return;
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    await conn.socket.sendPresenceUpdate(state, jid);
  }

  /**
   * Shows the number online or offline (F6 AC-1.6). `markOnlineOnConnect` is off, so nothing else ever sets it: the lane does,
   * around a run of sends. Best-effort like typing.
   */
  async presence(sender: SenderRef, state: 'available' | 'unavailable'): Promise<void> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return;
    await conn.socket.sendPresenceUpdate(state);
  }

  /** Tells WhatsApp these messages from a contact were read (F6 AC-1.7). Never called when a message arrives. */
  async markRead(sender: SenderRef, from: Recipient, providerMessageIds: readonly string[]): Promise<void> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open' || providerMessageIds.length === 0) return;
    const jid = from.providerAddress ?? `${from.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    await conn.socket.readMessages(providerMessageIds.map((id) => ({ remoteJid: jid, id, fromMe: false })));
  }

  /**
   * Whether a number has a WhatsApp account, via Baileys' `onWhatsApp` (a contact-sync query on this
   * session). Baileys returns only the numbers that DO exist, so a result without our number means
   * "no account", and no result at all (query failed) means "could not tell".
   */
  async isRegistered(sender: SenderRef, phoneE164: string): Promise<boolean | null> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return null;
    const found = await conn.socket.onWhatsApp(`${phoneE164.replace(/\D/g, '')}@s.whatsapp.net`);
    if (found === undefined) return null;
    return found.some((r) => r.exists);
  }

  /**
   * Whether the contact's profile photo and about can be fetched from this number (F6 AC-4.2). A hidden photo comes back as a
   * not-authorized or not-found answer, a hidden about as no status at all; a timeout or a closed socket is "could not tell" (null),
   * never "hidden". Two lookups, so the caller keeps this to once per contact per day.
   */
  async profileSnapshot(sender: SenderRef, to: Recipient): Promise<ProfileVisibility | null> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return null;
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    let photo: boolean | null;
    try {
      const url = await conn.socket.profilePictureUrl(jid, 'preview');
      photo = typeof url === 'string' && url !== '';
    } catch (error) {
      const code = (error as { output?: { statusCode?: number }; data?: number } | null);
      const status = code?.output?.statusCode ?? code?.data;
      photo = status === 401 || status === 403 || status === 404 ? false : null;
    }
    let about: boolean | null;
    try {
      const list = await conn.socket.fetchStatus(jid);
      if (list === undefined) about = null;
      else {
        const entry = list[0] as { status?: { status?: string } | string | null } | undefined;
        const text = typeof entry?.status === 'string' ? entry.status : entry?.status?.status;
        about = typeof text === 'string' && text.trim() !== '';
      }
    } catch {
      about = null;
    }
    return photo === null || about === null ? null : { photo, about };
  }

  /**
   * Throws away the encryption sessions with a contact, for every device of theirs, so the next message starts a fresh one (F6 AC-5.3).
   * The sessions are keys in our own credential store (`session-<user>.<device>`, a privacy address as `<user>_1`), so removing them
   * there is what the next send and the next receipt will find missing, and Baileys builds a new one from the contact's pre-keys.
   */
  async resetSession(sender: SenderRef, to: Recipient): Promise<void> {
    const conn = this.#connections.get(sender.id);
    if (!conn || conn.state !== 'open') return;
    const jid = to.providerAddress ?? `${to.phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
    const userOf = (j: string): string => (j.split('@')[0] ?? '').split(':')[0] ?? '';
    const users = new Set([userOf(jid)]);
    try {
      const mapping = (conn.socket.signalRepository as unknown as {
        lidMapping?: { getLIDForPN?: (pn: string) => Promise<string | null>; getPNForLID?: (lid: string) => Promise<string | null> };
      }).lidMapping;
      const other = jid.endsWith('@lid') ? await mapping?.getPNForLID?.(jid) : await mapping?.getLIDForPN?.(jid);
      if (typeof other === 'string' && other !== '') users.add(userOf(other));
    } catch { /* the mapping is a convenience; the address we have is enough */ }
    users.delete('');
    if (users.size === 0) return;
    const escaped = [...users].map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const sessionKey = new RegExp(`^session-(?:${escaped.join('|')})(?:_\\d+)?\\.\\d+$`);
    const store = this.#options.authStore;
    for (const key of await store.keys(sender.id)) {
      if (sessionKey.test(key)) await store.remove(sender.id, key);
    }
  }

  /** Inbound messages, normalised so callers never see Baileys' own shapes. */
  inbound(): AsyncIterable<NormalisedInboundEvent> {
    return this.#inbound;
  }

  /** A privacy address and its phone number, whenever WhatsApp shows them together. */
  identityLinks(): AsyncIterable<NormalisedIdentityLink> {
    return this.#links;
  }

  /** A contact's phone asking for one of our messages again because it could not decrypt it (F6 S5). Baileys answers it itself. */
  retries(): AsyncIterable<NormalisedRetryEvent> {
    return this.#retries;
  }

  /** WhatsApp's limit warnings: the reachout timelock and the new-chat cap (F6 S2). */
  notices(): AsyncIterable<NormalisedNoticeEvent> {
    return this.#notices;
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
    this.#links.close();
    this.#notices.close();
  }

  /** Opens a socket and wires every Baileys event onto our normalised streams. */
  async #openSocket(senderId: string, opts: { expectQr: boolean }): Promise<Connection> {
    const existing = this.#connections.get(senderId);
    if (existing) return existing;
    // The check above and the registration further down are separated by awaits: without this, two callers at the same moment both pass the
    // check and each open a socket, and the two then take the device from each other (R-027).
    const inflight = this.#opening.get(senderId);
    if (inflight !== undefined) return inflight;
    const opening = this.#openSocketNow(senderId, opts).finally(() => { this.#opening.delete(senderId); });
    this.#opening.set(senderId, opening);
    return opening;
  }

  /** Opens the socket for real. Only `#openSocket` calls this. */
  async #openSocketNow(senderId: string, opts: { expectQr: boolean }): Promise<Connection> {

    const { state, saveCreds, flush } = await loadAuthState(this.#options.authStore, senderId);
    const version = this.#options.waVersion ?? (await fetchLatestBaileysVersion()).version;
    const onFail = this.#options.onDecryptFailure;
    const onRetry = this.#options.onRetryRequest;
    const resendText = this.#options.resendText;
    // This account's own addresses (phone number and LID), known once the socket is open: a failure from one of them is the owner's
    // other device (phone, WhatsApp Web), not a contact (D-102).
    const ownUsers = new Set<string>();
    const isOwn = (jid: string | null): boolean => jid !== null && ownUsers.has((jid.split('@')[0] ?? '').split(':')[0] ?? '');

    const socket = (this.#options.makeSocket ?? makeWASocket)({
      version,
      auth: state,
      logger: tapDecryptFailures(
        this.#options.logger,
        // Own device: the frame says it is from this account (`fromMe`), or its author, or its chat, is this account's own address.
        (info) => { onFail?.(senderId, new Date(), { own: info.fromMe || isOwn(info.author) || isOwn(info.jid) }); },
        (messageId) => {
          const at = new Date();
          if (!this.#shuttingDown) this.#retries.push({ senderId, providerMessageId: messageId, at });
          onRetry?.(senderId, messageId, at);
        }
      ) as never,
      // Identify as a desktop browser. A plausible, stable client fingerprint matters — the
      // detection heuristics notice inconsistency across sessions.
      browser: Browsers.ubuntu('Chrome'),
      // We render the QR ourselves; printing it to stdout would put a credential in the logs.
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Asked when a recipient could not decrypt something we sent: hand back the original so it can be encrypted and sent again.
      getMessage: async (key) => {
        if (resendText === undefined || key.id === undefined || key.id === null) return undefined;
        try {
          const text = await resendText(senderId, key.id);
          return text === undefined ? undefined : { conversation: text };
        } catch { return undefined; }
      }
    });

    const conn: Connection = {
      socket, flush, state: 'connecting', lastConnectedAt: null, disconnectReason: null, pendingQr: null
    };
    this.#connections.set(senderId, conn);

    const learnOwnAddresses = (): void => {
      const me = socket.user as { id?: string; lid?: string } | undefined;
      for (const jid of [me?.id, me?.lid]) {
        const user = (jid?.split('@')[0] ?? '').split(':')[0] ?? '';
        if (user !== '') ownUsers.add(user);
      }
    };
    learnOwnAddresses();
    socket.ev.on('creds.update', () => { learnOwnAddresses(); void saveCreds(); });
    socket.ev.on('connection.update', (u) => { learnOwnAddresses(); this.#onConnectionUpdate(senderId, conn, u, opts.expectQr); });
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;   // 'append' is history sync, not new traffic
      for (const m of messages) this.#emitInbound(senderId, m, isOwn);
    });
    // WhatsApp's own warnings about starting new chats (F6 S2). The timelock arrives as part of a connection update, the cap as its own event.
    socket.ev.on('message-capping.update', (info) => { this.#emitCapping(senderId, info); });
    socket.ev.on('messages.update', (updates) => {
      for (const u of updates) this.#emitStatus(senderId, u);
    });
    // Baileys 7 learns which phone number a privacy (LID) address belongs to whenever WhatsApp shows them together, keeps the pair in
    // the credential store and moves the encryption session across (this is what stops "Waiting for this message", docs/45). We
    // also keep the pair as one of the contact's identities.
    (socket.ev as unknown as { on: (e: string, h: (p: unknown) => void) => void })
      .on('lid-mapping.update', (p) => {
        const pair = p as { lid?: string; pn?: string };
        const phone = phoneFromJid(pair.pn);
        if (!this.#shuttingDown && typeof pair.lid === 'string' && pair.lid.endsWith('@lid') && phone !== null) {
          this.#links.push({ senderId, providerAddress: pair.lid, phoneE164: phone });
        }
      });
    // A person sharing their number reveals which phone a privacy address is. Baileys 6.x emits it
    // as `{ lid, jid }`; the shape is read defensively because it is not part of the typed events.
    (socket.ev as unknown as { on: (e: string, h: (p: unknown) => void) => void })
      .on('chats.phoneNumberShare', (p) => {
        const share = p as { lid?: string; jid?: string };
        const phone = phoneFromJid(share.jid);
        if (!this.#shuttingDown && typeof share.lid === 'string' && phone !== null) {
          this.#links.push({ senderId, providerAddress: share.lid, phoneE164: phone });
        }
      });

    return conn;
  }

  /** Handles connection lifecycle: QR issued, opened, or closed with a typed reason. */
  #onConnectionUpdate(
    senderId: string, conn: Connection, update: Partial<ConnectionState>, expectQr: boolean
  ): void {
    if (update.reachoutTimeLock !== undefined) this.#emitTimelock(senderId, update.reachoutTimeLock);

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
      this.#offlineAttempts.delete(senderId);
      this.#restartStreak.delete(senderId);
      this.#options.logger.info({ senderId }, 'whatsapp connection open');
      this.#connectionEvents.push({
        senderId, state: 'open', reason: null, at: new Date(), phoneE164: phoneFromJid(conn.socket.user?.id)
      });
    }

    if (update.connection === 'close') {
      const statusCode = extractStatusCode(update.lastDisconnect);
      const detail = extractCloseDetail(update.lastDisconnect);
      const reason = mapDisconnectReason(statusCode);
      // A close while we were still waiting for a QR is the answer: fail the link now, with WhatsApp's
      // own code, instead of making the operator wait out the timeout.
      const failedLink = conn.pendingQr !== null;
      if (conn.pendingQr) {
        const code = statusCode === 401 ? 'stale_session' : statusCode === 429 ? 'rate_limited' : 'connection_closed';
        conn.pendingQr.reject(Object.assign(new Error(`connection closed before a QR (${String(statusCode ?? 'no code')})`), { code, statusCode }));
        conn.pendingQr = null;
      }
      conn.disconnectReason = reason;
      // Logged out is terminal: the number was unlinked on the phone, so reconnecting cannot
      // work and retrying would only look like abuse. Everything else stays reconnectable.
      conn.state = reason === 'logged_out' ? 'logged_out' : 'closed';
      // A socket this number has already moved on from (logged out before a new link) can close after the new socket is open. Its close
      // is not about the number any more: deleting the entry would orphan the live socket and the next open would make a second one,
      // and the two then log each other out as the same device forever (R-014). Nor is it a logout or a reason to reconnect.
      if (this.#connections.get(senderId) !== conn) {
        this.#options.logger.info({ senderId, statusCode, reason }, 'an old socket closed after the number moved on; ignored');
        return;
      }
      this.#connections.delete(senderId);
      this.#options.logger.warn({ senderId, statusCode, reason, detail }, 'whatsapp connection closed');
      this.#connectionEvents.push({
        senderId, state: conn.state, reason, code: statusCode ?? null, detail, at: new Date()
      });
      // A link attempt that failed is reported to the operator, who decides whether to try again;
      // reconnecting on our own would just re-register in the background.
      if (!failedLink) this.#scheduleReconnect(senderId, reason, isLocalNetworkFailure(update.lastDisconnect));
    }
  }

  /** Turns WhatsApp's reachout timelock state into a port notice. An inactive state is the restriction being lifted. */
  #emitTimelock(
    senderId: string, state: { isActive?: boolean; timeEnforcementEnds?: Date; enforcementType?: string }
  ): void {
    if (this.#shuttingDown) return;
    const active = state.isActive === true;
    this.#options.logger.info({ senderId, active, until: state.timeEnforcementEnds, type: state.enforcementType }, 'whatsapp reachout timelock update');
    this.#notices.push({
      kind: 'timelock', senderId, active, until: state.timeEnforcementEnds ?? null,
      enforcementType: state.enforcementType ?? null, at: new Date(), raw: state
    });
  }

  /** Turns WhatsApp's new-chat cap update into a port notice. Its timestamps are seconds since the epoch, sent as strings. */
  #emitCapping(
    senderId: string,
    info: {
      total_quota?: number; used_quota?: number; cycle_start_timestamp?: string; cycle_end_timestamp?: string; capping_status?: string
    }
  ): void {
    if (this.#shuttingDown) return;
    const seconds = (v: string | undefined): Date | null => {
      const n = v === undefined ? NaN : Number(v);
      return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
    };
    const known = ['NONE', 'FIRST_WARNING', 'SECOND_WARNING', 'CAPPED'] as const;
    const status = known.find((k) => k === info.capping_status) ?? null;
    this.#options.logger.info({ senderId, status, total: info.total_quota, used: info.used_quota }, 'whatsapp new-chat cap update');
    this.#notices.push({
      kind: 'capping', senderId, status, totalQuota: info.total_quota ?? null, usedQuota: info.used_quota ?? null,
      cycleStart: seconds(info.cycle_start_timestamp), cycleEnd: seconds(info.cycle_end_timestamp), at: new Date(), raw: info
    });
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
  #scheduleReconnect(senderId: string, reason: DisconnectReason, offline = false): void {
    if (this.#shuttingDown) return;
    if (reason === 'logged_out') return;
    // WhatsApp refused the number (403, a ban), or another client took the session (440). Dialling again by itself makes a ban permanent, or
    // starts the two clients taking the device from each other (R-029, R-030): a person decides, from the Numbers page.
    if (reason === 'forbidden' || reason === 'connection_replaced') {
      this.#options.logger.warn({ senderId, reason }, 'not reconnecting by itself; a person has to relink or resume the number');
      return;
    }

    // A try that never reached WhatsApp (this machine has no internet) is not a reconnect WhatsApp sees, so it carries no ban risk and
    // does not spend the budget: keep trying, backing off to once a minute, until the internet is back (R-026). Before this, five such
    // tries (about 30 s offline) used the budget up and the number stayed offline until a restart.
    // The first restarts in a row are the handshake after a scan and cost nothing. Past RESTART_FREE_TRIES it is WhatsApp refusing (R-028), and
    // the restart is treated like any other failure: it backs off and spends the budget.
    const streak = reason === 'restart_required' ? (this.#restartStreak.get(senderId) ?? 0) + 1 : 0;
    if (reason === 'restart_required') this.#restartStreak.set(senderId, streak);
    const handshake = reason === 'restart_required' && streak <= RESTART_FREE_TRIES;
    const offlineTries = offline ? (this.#offlineAttempts.get(senderId) ?? 0) + 1 : 0;
    if (offline) this.#offlineAttempts.set(senderId, offlineTries);
    const attempts = handshake || offline ? (this.#reconnectAttempts.get(senderId) ?? 0) : (this.#reconnectAttempts.get(senderId) ?? 0) + 1;
    if (!handshake && !offline) this.#reconnectAttempts.set(senderId, attempts);

    if (!offline && attempts > RECONNECT_MAX_ATTEMPTS) {
      this.#options.logger.error(
        { senderId, reason, attempts },
        'giving up reconnecting — the number needs attention'
      );
      return;
    }

    const delay = handshake
      ? 0
      : offline
        ? Math.min(RECONNECT_BASE_MS * 2 ** (offlineTries - 1), RECONNECT_CAP_MS)
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

  /** Ids of messages this process sent, kept briefly so their echo is not mistaken for a message typed on the phone (D-94). */
  readonly #recentlySent = new Map<string, number>();

  /** Notes that the CRM itself sent this message id, and forgets ids older than ten minutes. */
  #rememberSent(id: string): void {
    const now = Date.now();
    this.#recentlySent.set(id, now);
    for (const [key, at] of this.#recentlySent) if (now - at > 10 * 60_000) this.#recentlySent.delete(key);
  }

  /** Converts one Baileys message into the normalised inbound shape. */
  #emitInbound(senderId: string, raw: unknown, isOwn: (jid: string | null) => boolean): void {
    if (this.#shuttingDown) return;
    const m = raw as {
      key?: {
        id?: string; remoteJid?: string; fromMe?: boolean; senderPn?: string; participantPn?: string;
        /** Baileys 7: the same person's other address (the phone number when `remoteJid` is a LID, and the other way round). */
        remoteJidAlt?: string; participantAlt?: string;
      };
      message?: Record<string, unknown> | null;
      messageTimestamp?: number | Long;
    };
    if (!m.key?.id || !m.key.remoteJid || !m.message) return;
    // A message the owner typed on their own phone (or another linked device) arrives with `fromMe` too (D-94). The CRM's own sends also
    // echo back through here and are already recorded, so those are skipped: the ones this process sent are remembered by id.
    const fromMe = m.key.fromMe === true;
    if (fromMe && this.#recentlySent.has(m.key.id)) return;

    const jid = m.key.remoteJid;
    // Not a person: groups (and the groups inside communities), channels (`@newsletter`), and broadcast lists
    // and the status feed (`@broadcast`). A message from one must never create a contact or a conversation.
    if (isNotAPerson(jid)) return;
    // The account's own chat, by number or LID: the phone's sync messages on link and "message yourself" notes. Not a contact (R-015).
    if (isOwn(jid)) return;
    // WhatsApp's own plumbing (history sync, key shares, "delete for everyone"): nothing a person wrote, so no message and no contact (R-015).
    if (isSystemMessage(m.message)) return;

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
      fromPhoneE164: phoneFromJid(jid),
      // For a privacy address, WhatsApp also says which number it is: `remoteJidAlt` in Baileys 7 (`senderPn` in 6.x).
      linkedPhoneE164: linkedPhoneFor(jid, m.key),
      fromProviderAddress: jid,
      body,
      contentType,
      mediaRef: hasMedia ? m.key.id : null,
      receivedAt: toDate(m.messageTimestamp),
      ...(fromMe ? { fromMe: true } : {}),
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

/**
 * For a message from a privacy (LID) address, the phone number WhatsApp says it belongs to: `remoteJidAlt` or `participantAlt` in
 * Baileys 7, `senderPn` or `participantPn` in 6.x. Null for a phone-number address or when WhatsApp did not say.
 */
export function linkedPhoneFor(
  jid: string,
  key: { remoteJidAlt?: string; participantAlt?: string; senderPn?: string; participantPn?: string }
): string | null {
  if (!jid.endsWith('@lid')) return null;
  return phoneFromJid(key.remoteJidAlt) ?? phoneFromJid(key.participantAlt) ?? phoneFromJid(key.senderPn ?? key.participantPn);
}

/** Baileys timestamps arrive as a number or a protobuf Long; both mean seconds. */
type Long = { toNumber(): number };

/**
 * The E.164 number inside a phone JID (`919876543210@s.whatsapp.net`, optionally with a device
 * suffix `:12`), or null for anything else — a group, a privacy address, a missing value.
 */
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
  const user = (jid.split('@')[0] ?? '').split(':')[0] ?? '';
  return /^\d{7,15}$/.test(user) ? `+${user}` : null;
}

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
 * Whether a close happened because this machine could not reach WhatsApp at all. Baileys turns every socket error into a 408, the same
 * code as WhatsApp's own timeout (`getCodeFromWSError`), and keeps the original error on `data`. A Node network code there (ENOTFOUND,
 * ECONNREFUSED, ENETUNREACH…) means the socket never reached WhatsApp.
 */
export function isLocalNetworkFailure(lastDisconnect: unknown): boolean {
  const d = lastDisconnect as { error?: { data?: { code?: unknown } } } | undefined;
  const code = d?.error?.data?.code;
  return typeof code === 'string' && /^E[A-Z]+$/.test(code);
}

/**
 * Why WhatsApp ended the stream, when it said. Baileys puts the stream error's child node on the Boom error's `data`, so
 * `<conflict type='device_removed'/>` (the number was removed under Linked devices on the phone) arrives as `device_removed`.
 */
export function extractCloseDetail(lastDisconnect: unknown): string | null {
  const d = lastDisconnect as { error?: { data?: { tag?: unknown; attrs?: { type?: unknown } } } } | undefined;
  const data = d?.error?.data;
  return data?.tag === 'conflict' && typeof data.attrs?.type === 'string' ? data.attrs.type : null;
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
    case 0: return 'failed';     // ERROR — the server refused it; counted as a failed send
    case 1: return 'sent';       // pending
    case 2: return 'sent';       // server ack
    case 3: return 'delivered';  // delivery ack
    case 4: return 'read';
    case 5: return 'read';       // played, for voice notes
    default: return null;
  }
}

/**
 * True for addresses that are not a person: a group (`@g.us`, which also covers the groups inside a community),
 * a channel (`@newsletter`), and a broadcast list or the status feed (`@broadcast`). Such messages are ignored
 * on the way in, so they never become a contact named with a raw address.
 */
export function isNotAPerson(jid: string): boolean {
  return jid.endsWith('@g.us') || jid.endsWith('@newsletter') || jid.endsWith('@broadcast');
}

/**
 * True for a message that is WhatsApp's own plumbing rather than something a person wrote: a `protocolMessage` (history sync, app-state key
 * share, "delete for everyone", disappearing-mode change, edit notice) or one carrying nothing but encryption-key distribution and context
 * info. Looks through the same wrappers Baileys does (disappearing, view-once, edited) first.
 */
export function isSystemMessage(message: Record<string, unknown>): boolean {
  const content = normalizeMessageContent(message as Parameters<typeof normalizeMessageContent>[0]) as Record<string, unknown> | undefined;
  if (content === undefined) return true;
  // Decoded messages carry null, not undefined, for the kinds they are not: test for both.
  if (content.protocolMessage !== undefined && content.protocolMessage !== null) return true;
  return !Object.entries(content).some(([kind, value]) =>
    value !== undefined && value !== null && kind !== 'senderKeyDistributionMessage'
      && (kind === 'conversation' || kind.endsWith('Message')));
}

/** Wrappers WhatsApp puts around a message (disappearing chats, view-once, a document with a caption). */
const WRAPPERS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage'
] as const;

/** Looks through the wrappers to the message inside, a few levels at most. */
function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  let current = message;
  for (let depth = 0; depth < 4; depth++) {
    const wrapper = WRAPPERS.find((w) => (current[w] as { message?: unknown } | undefined)?.message !== undefined);
    if (wrapper === undefined) break;
    current = (current[wrapper] as { message: Record<string, unknown> }).message;
  }
  return current;
}

/** One line for a shared contact card, from its display name. */
function contactLine(name: string | undefined): string {
  return name !== undefined && name !== '' ? `Contact card: ${name}` : 'Contact card';
}

/**
 * Extracts readable text and a content type from Baileys' nested message union.
 *
 * Stickers come through as images (they are downloaded like one). Shared contacts and locations have
 * no file to fetch, so they become a line of text rather than vanishing from the thread.
 */
export function extractBody(message: Record<string, unknown>): {
  body: string; contentType: NormalisedInboundEvent['contentType'];
} {
  const m = unwrap(message) as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
    audioMessage?: unknown;
    stickerMessage?: unknown;
    contactMessage?: { displayName?: string };
    contactsArrayMessage?: { displayName?: string; contacts?: Array<{ displayName?: string }> };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string };
    liveLocationMessage?: { degreesLatitude?: number; degreesLongitude?: number; caption?: string };
  };
  if (typeof m.conversation === 'string') return { body: m.conversation, contentType: 'text' };
  if (m.extendedTextMessage?.text !== undefined) return { body: m.extendedTextMessage.text, contentType: 'text' };
  if (m.imageMessage) return { body: m.imageMessage.caption ?? '', contentType: 'image' };
  if (m.videoMessage) return { body: m.videoMessage.caption ?? '', contentType: 'video' };
  if (m.documentMessage) return { body: m.documentMessage.caption ?? m.documentMessage.fileName ?? '', contentType: 'document' };
  if (m.audioMessage) return { body: '', contentType: 'audio' };
  if (m.stickerMessage) return { body: '', contentType: 'image' };
  if (m.contactMessage) return { body: contactLine(m.contactMessage.displayName), contentType: 'text' };
  if (m.contactsArrayMessage) {
    const names = (m.contactsArrayMessage.contacts ?? []).map((c) => c.displayName).filter((n): n is string => !!n);
    const body = names.length > 0 ? `Contact cards: ${names.join(', ')}` : contactLine(m.contactsArrayMessage.displayName);
    return { body, contentType: 'text' };
  }
  // Decoded WhatsApp messages carry null, not undefined, for the kinds they are not: test for both.
  const place = m.locationMessage ?? m.liveLocationMessage;
  if (place !== undefined && place !== null) {
    const where = place.degreesLatitude !== undefined && place.degreesLongitude !== undefined
      ? `${String(place.degreesLatitude)}, ${String(place.degreesLongitude)}` : 'location unknown';
    const label = (m.locationMessage?.name ?? m.locationMessage?.address ?? m.liveLocationMessage?.caption ?? '').trim();
    return { body: `${m.liveLocationMessage !== undefined && m.liveLocationMessage !== null ? 'Live location' : 'Location'}: ${label === '' ? where : `${label} (${where})`}`, contentType: 'text' };
  }
  return { body: '', contentType: 'other' };
}

export { loadAuthState, hasStoredSession } from './auth-adapter.js';
export { EventStream } from './event-stream.js';
