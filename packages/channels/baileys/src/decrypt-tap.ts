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

/**
 * Wraps a logger so every decrypt-failure report also calls `onFailure`, then passes everything
 * through unchanged. Child loggers are wrapped too, because Baileys logs from children, not the
 * root. The callback must not throw — a broken tap must never break logging.
 */
export function tapDecryptFailures(logger: BaileysLogger, onFailure: () => void): BaileysLogger {
  /** Fires the tap for a matching call, swallowing any error the callback raises. */
  const check = (obj: unknown, msg?: string): void => {
    if (!isDecryptFailure(obj, msg)) return;
    try { onFailure(); } catch { /* the tap is best-effort */ }
  };
  return {
    get level() { return logger.level; },
    set level(v: string) { logger.level = v; },
    child: (bindings) => tapDecryptFailures(logger.child(bindings), onFailure),
    info: (o, m) => { logger.info(o, m); },
    debug: (o, m) => { logger.debug(o, m); },
    trace: (o, m) => { logger.trace(o, m); },
    warn: (o, m) => { check(o, m); logger.warn(o, m); },
    error: (o, m) => { check(o, m); logger.error(o, m); }
  };
}
