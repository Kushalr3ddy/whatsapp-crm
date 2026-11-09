import { EventEmitter } from 'node:events';
import type { WASocket } from 'baileys';
import type { AuthStateStore } from '@crm/channels';
import { InMemoryAuthStateStore } from '@crm/channel-fake';
import { BaileysChannelProvider, loadAuthState } from '@crm/channel-baileys';

/**
 * A scripted stand-in for a Baileys socket, so the real WhatsApp adapter (`BaileysChannelProvider`) can be driven through the event
 * sequences WhatsApp actually produces (QR, scan, the 515 restart, 401/403/428/440 closes, a device removed on the phone) without a
 * phone or the network. The adapter's own code runs unchanged; only the wire is fake.
 *
 * The sequences come from what the gateway logs on a real number (docs/26-linking-lifecycle.md): after a scan WhatsApp always closes
 * with 515 and expects the client straight back; an unlink on the phone is a 401 whose stream error carries `<conflict type="device_removed"/>`;
 * a ban is a 403; another client taking the session is a 440.
 */
export class ScriptedSocket {
  readonly ev = new EventEmitter();
  user: { id: string; lid?: string } | undefined = undefined;
  ended = false;
  loggedOut = false;
  /** Every message the adapter asked WhatsApp to send, in order. */
  readonly sent: Array<{ jid: string; content: unknown; id: string }> = [];
  /** Recipients (`<digits>@s.whatsapp.net` or a LID) that WhatsApp refuses, with the status code it refuses with. */
  readonly refuse = new Map<string, number>();
  /** When set, the next send throws this, the way a socket that dropped mid-write does. */
  nextSendThrows: Error | null = null;
  private seq = 0;

  constructor(readonly index: number, private readonly phoneDigits: string) {
    this.ev.setMaxListeners(0);
  }

  // ---- what the adapter calls ----

  end(): void { this.ended = true; }
  async logout(): Promise<void> {
    // Baileys tells WhatsApp to drop the device, then ends the stream with 401 itself.
    this.loggedOut = true;
    this.close(401);
  }
  async sendMessage(jid: string, content: unknown): Promise<{ key: { id: string; remoteJid: string } }> {
    if (this.nextSendThrows !== null) { const e = this.nextSendThrows; this.nextSendThrows = null; throw e; }
    const code = this.refuse.get(jid);
    if (code !== undefined) throw Object.assign(new Error(`refused ${String(code)}`), { output: { statusCode: code } });
    const id = `3EB0${String(this.index)}${String(++this.seq).padStart(6, '0')}`;
    this.sent.push({ jid, content, id });
    return { key: { id, remoteJid: jid } };
  }
  async requestPairingCode(phone: string): Promise<string> {
    if (phone === '') throw new Error('no phone');
    return 'K7QX2M9P';
  }
  async sendPresenceUpdate(): Promise<void> { /* cosmetic */ }
  async readMessages(): Promise<void> { /* cosmetic */ }
  async onWhatsApp(jid: string): Promise<Array<{ exists: boolean; jid: string }>> { return [{ exists: true, jid }]; }
  async profilePictureUrl(): Promise<string | undefined> { return undefined; }
  async fetchStatus(): Promise<unknown[] | undefined> { return undefined; }
  readonly signalRepository = { lidMapping: { getLIDForPN: () => Promise.resolve(null), getPNForLID: () => Promise.resolve(null) } };

  // ---- what WhatsApp does, scripted by the test ----

  qr(value = `2@qr-${String(this.index)}`): void { this.ev.emit('connection.update', { qr: value }); }
  /** The socket opens as this account. */
  open(): void {
    this.user = { id: `${this.phoneDigits}:${String(this.index)}@s.whatsapp.net` };
    this.ev.emit('creds.update', {});
    this.ev.emit('connection.update', { connection: 'open' });
  }
  /** WhatsApp closes the stream with a status code, and optionally the stream error's conflict type. */
  close(statusCode: number, conflict?: string): void {
    const error = Object.assign(new Error(`stream closed ${String(statusCode)}`), {
      output: { statusCode },
      ...(conflict !== undefined ? { data: { tag: 'conflict', attrs: { type: conflict } } } : {})
    });
    this.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error, date: new Date() } });
  }
  /** A message from a contact. */
  inbound(fromDigits: string, body: string, id = `IN${String(++this.seq)}`, type: 'notify' | 'append' = 'notify'): string {
    this.ev.emit('messages.upsert', {
      type,
      messages: [{ key: { id, remoteJid: `${fromDigits}@s.whatsapp.net`, fromMe: false }, message: { conversation: body }, messageTimestamp: Math.floor(Date.now() / 1000) }]
    });
    return id;
  }
  /** A delivery update for something we sent (3 = delivered, 4 = read, 0 = error). */
  status(id: string, code: number): void {
    this.ev.emit('messages.update', [{ key: { id }, update: { status: code } }]);
  }
}

export const silentLogger = {
  level: 'silent', child() { return silentLogger; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

/** A logger that keeps what was said, so a test can see that a reconnect was scheduled or given up. */
export function recordingLogger() {
  const lines: Array<{ level: string; msg: string; obj: unknown }> = [];
  const at = (level: string) => (obj: unknown, msg?: string) => { lines.push({ level, msg: msg ?? (typeof obj === 'string' ? obj : ''), obj }); };
  const logger = {
    level: 'debug', child() { return logger; },
    trace: at('trace'), debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error')
  };
  return { logger, lines };
}

export interface ScriptedWhatsApp {
  readonly provider: BaileysChannelProvider;
  readonly sockets: ScriptedSocket[];
  readonly store: AuthStateStore;
  /** The socket the adapter opened most recently. */
  latest(): ScriptedSocket;
  /** Waits until the adapter has opened `n` sockets in total. */
  socketCount(n: number, timeoutMs?: number): Promise<ScriptedSocket>;
}

/** The real adapter on scripted sockets. Each new socket is the next one WhatsApp would hand out. */
export function scriptedWhatsApp(opts: {
  store?: AuthStateStore; phoneDigits?: string; qrTtlMs?: number; logger?: typeof silentLogger | ReturnType<typeof recordingLogger>['logger'];
} = {}): ScriptedWhatsApp {
  const sockets: ScriptedSocket[] = [];
  const store = opts.store ?? new InMemoryAuthStateStore();
  const phoneDigits = opts.phoneDigits ?? '919000000001';
  const provider = new BaileysChannelProvider({
    authStore: store, logger: (opts.logger ?? silentLogger) as never, waVersion: [2, 3000, 1],
    ...(opts.qrTtlMs !== undefined ? { qrTtlMs: opts.qrTtlMs } : {}),
    makeSocket: () => { const s = new ScriptedSocket(sockets.length, phoneDigits); sockets.push(s); return s as unknown as WASocket; }
  });
  return {
    provider, sockets, store,
    latest: () => sockets[sockets.length - 1]!,
    async socketCount(n, timeoutMs = 5_000) {
      const until = Date.now() + timeoutMs;
      while (sockets.length < n) {
        if (Date.now() > until) throw new Error(`expected ${String(n)} sockets, the adapter opened ${String(sockets.length)}`);
        await new Promise((r) => setTimeout(r, 5));
      }
      return sockets[n - 1]!;
    }
  };
}

/** Stored credentials for a sender, as a finished link leaves them, so `connect()` (a restart restoring the number) has something to load. */
export async function storeCredentials(store: AuthStateStore, senderId: string): Promise<void> {
  const { saveCreds, flush } = await loadAuthState(store, senderId);
  await saveCreds();
  await flush();
}

/** Starts a QR link and answers it with a QR from the socket it opens, as WhatsApp would, returning the QR and that socket. */
export async function linkWithQr(wa: ScriptedWhatsApp, senderId: string): Promise<{ qr: string; socket: ScriptedSocket }> {
  const before = wa.sockets.length;
  const pending = wa.provider.link(senderId, 'qr');
  const socket = await wa.socketCount(before + 1);
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) { socket.qr(); await new Promise((r) => setTimeout(r, 5)); }
  const challenge = await pending;
  if (challenge.mode !== 'qr') throw new Error('expected a QR');
  return { qr: challenge.qr, socket };
}

/** Collects the adapter's connection events as they happen. */
export function collectConnections(provider: BaileysChannelProvider) {
  const events: Array<{ state: string; reason: string | null; code?: number | null | undefined; detail?: string | null | undefined; phoneE164?: string | null | undefined }> = [];
  void (async () => { for await (const e of provider.connections()) events.push(e); })();
  return events;
}

export const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));
