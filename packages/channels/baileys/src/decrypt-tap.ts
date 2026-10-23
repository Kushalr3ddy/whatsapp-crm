import type { BaileysLogger } from './index.js';

/**
 * True when a Baileys log call is an undecryptable-frame report ("failed to decrypt message",
 * `Bad MAC`, `No matching sessions`). Baileys drops such frames *before* `messages.upsert`, so its
 * logger is the only place the application can see them at all (docs/21-deferred.md, D-14).
 */
export function isDecryptFailure(obj: unknown, msg?: string): boolean {
  if (msg !== undefined && /failed to decrypt/i.test(msg)) return true;
  if (obj !== null && typeof obj === 'object') {
    const err = (obj as { err?: unknown }).err;
    const text = err instanceof Error ? err.message
      : typeof err === 'string' ? err
      : err !== null && typeof err === 'object' ? String((err as { message?: unknown }).message ?? '') : '';
    if (/Bad MAC|No matching sessions/i.test(text)) return true;
  }
  return false;
}

/** Who an undecryptable frame was from (`key.remoteJid`, or the participant of a group frame), or null when the log call does not say. */
export function failedFrameJid(obj: unknown): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  const key = (obj as { key?: { remoteJid?: unknown; participant?: unknown } }).key;
  const jid = key?.remoteJid ?? key?.participant;
  return typeof jid === 'string' ? jid : null;
}

/**
 * The id of the message a recipient asked us to send again, when a Baileys log call is that request ("recv retry request"), else null.
 * A recipient sends one when it could not decrypt what we sent: its phone shows "Waiting for this message" until we answer (D-101).
 */
export function retryRequestMessageId(obj: unknown, msg?: string): string | null {
  if (msg !== 'recv retry request' || obj === null || typeof obj !== 'object') return null;
  const id = (obj as { attrs?: { id?: unknown } }).attrs?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** What the tap tells its callbacks about one undecryptable frame. */
export interface DecryptFailureInfo {
  /** The address the frame came from, when the log call named one. */
  readonly jid: string | null;
}

/**
 * Wraps a logger so every decrypt-failure report also calls `onFailure`, and every recipient retry request calls `onRetryRequest`,
 * then passes everything through unchanged. Child loggers are wrapped too, because Baileys logs from children, not the root. The
 * callbacks must not throw — a broken tap must never break logging.
 */
export function tapDecryptFailures(
  logger: BaileysLogger, onFailure: (info: DecryptFailureInfo) => void, onRetryRequest?: (messageId: string) => void
): BaileysLogger {
  /** Fires the tap for a matching call, swallowing any error the callback raises. */
  const check = (obj: unknown, msg?: string): void => {
    if (!isDecryptFailure(obj, msg)) return;
    try { onFailure({ jid: failedFrameJid(obj) }); } catch { /* the tap is best-effort */ }
  };
  const retry = (obj: unknown, msg?: string): void => {
    if (onRetryRequest === undefined) return;
    const id = retryRequestMessageId(obj, msg);
    if (id === null) return;
    try { onRetryRequest(id); } catch { /* the tap is best-effort */ }
  };
  return {
    get level() { return logger.level; },
    set level(v: string) { logger.level = v; },
    child: (bindings) => tapDecryptFailures(logger.child(bindings), onFailure, onRetryRequest),
    info: (o, m) => { retry(o, m); logger.info(o, m); },
    debug: (o, m) => { retry(o, m); logger.debug(o, m); },
    trace: (o, m) => { retry(o, m); logger.trace(o, m); },
    warn: (o, m) => { check(o, m); logger.warn(o, m); },
    error: (o, m) => { check(o, m); logger.error(o, m); }
  };
}
