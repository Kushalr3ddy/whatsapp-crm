import type { NextFunction, Request, Response } from 'express';
import { problem } from './problem.js';

/**
 * Headers every API answer carries (R-040). The API speaks JSON to a server and, through the web app, to a browser; none of it should
 * be framed, sniffed into another type, or kept by a shared cache. Media (pictures and files) is the one family that is shown by a
 * browser, so it keeps its own caching and is not given the locked-down content policy.
 */
export function securityHeaders(isProduction: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.path.startsWith('/api/v1/media')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // A signed-in answer must never come from a shared cache. A route that wants caching sets its own header after this one.
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

/** True when the value, or anything inside it, is a string holding a NUL character. */
function holdsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 20 || value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return false;
  for (const inner of Object.values(value as Record<string, unknown>)) if (holdsNul(inner, depth + 1)) return true;
  return false;
}

/**
 * Refuses a request whose text holds a NUL character, with 422. Postgres cannot store one in text, so the statement failed and the
 * caller got a 500 (R-039). Uploads arrive as raw bytes (a Buffer), which this leaves alone: a file may hold any byte.
 */
export function rejectNulText(req: Request, res: Response, next: NextFunction): void {
  if (holdsNul(req.body) || holdsNul(req.query)) {
    res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Text may not contain a NUL (zero) character.'));
    return;
  }
  next();
}
