import type { NextFunction, Request, Response } from 'express';
import { sendProblem } from './problem.js';

/**
 * Per-key request rate limiting.
 *
 * `api_key.rate_limit_per_min` has been a column since the key table existed, stored on every
 * key, shown in the admin listing, and **enforced nowhere** — which is worse than not having
 * it, because it reads like a control that is in force. This is the code that makes it true.
 *
 * In-process, deliberately and with the same caveat as the login throttle in
 * `routes/auth.ts`: the lean preset runs one API process, and a shared counter would mean
 * Redis. With several replicas each would count separately, so a key's effective limit becomes
 * the limit times the replica count. That is a real limitation rather than a hidden one, and
 * it moves into the shared rate-limit layer with the login throttle (P9).
 *
 * Sessions are not limited here. A person clicking around an inbox is not the traffic shape
 * this protects against, and the login route has its own throttle — which is where the abuse
 * that matters actually lands.
 */

/** A fixed window per key: when it started, and how many requests have landed in it. */
interface Window { startedAt: number; count: number }

const WINDOW_MS = 60_000;

/**
 * Counters keyed by api_key id.
 *
 * A fixed window rather than a sliding one: it is one number per key instead of a list of
 * timestamps, and the failure mode — up to double the limit across a window boundary — is
 * acceptable for a control whose job is to stop a runaway integration, not to meter billing.
 */
const windows = new Map<string, Window>();

/**
 * Drops counters for keys that have gone quiet, so a long-running process does not accumulate
 * one entry per key ever seen. Cheap, and only runs when the map has grown enough to matter.
 */
function evictStale(now: number): void {
  if (windows.size < 1000) return;
  for (const [id, w] of windows) {
    if (now - w.startedAt > WINDOW_MS * 2) windows.delete(id);
  }
}

/**
 * Refuses a key that has exceeded its own limit, with `Retry-After` so a well-behaved client
 * knows exactly when to come back rather than hammering.
 */
export function rateLimitApiKey(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.crm;
  if (ctx?.kind !== 'api_key' || ctx.credentialId === null) { next(); return; }

  // 0 or less means unlimited — the escape hatch for an internal integration that should not
  // be throttled, set deliberately per key rather than by editing this file.
  const limit = ctx.rateLimitPerMin ?? 0;
  if (limit <= 0) { next(); return; }

  const now = Date.now();
  evictStale(now);

  const existing = windows.get(ctx.credentialId);
  const window = existing === undefined || now - existing.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : existing;
  window.count += 1;
  windows.set(ctx.credentialId, window);

  const remaining = Math.max(0, limit - window.count);
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(remaining));

  if (window.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    sendProblem(req, res, 429, 'RATE_LIMITED',
      `This key is limited to ${String(limit)} requests per minute. Retry in ` +
      `${String(retryAfterSec)}s, or raise rate_limit_per_min on the key.`);
    return;
  }
  next();
}

/** Clears every counter. For tests, so one suite's traffic cannot throttle the next. */
export function resetRateLimits(): void {
  windows.clear();
}
