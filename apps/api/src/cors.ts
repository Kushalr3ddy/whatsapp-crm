import type { NextFunction, Request, Response } from 'express';

/**
 * Cross-origin access for browsers, from an explicit allowlist only.
 *
 * CORS is a *browser* rule: a page served from one origin may not read a response from another
 * unless the response says so. It does nothing to a server calling this API (a backend, curl,
 * Postman), which is why a server-to-server integration needs no entry here at all. An entry is
 * only for a web page on another host or port that calls the API from the user's browser.
 *
 * Deliberately narrow: only the exact origins listed (never `*`), no credentials (cookies are never
 * sent cross-origin, so a foreign page cannot ride a signed-in session — it must present an API
 * key), and an unlisted origin simply gets no CORS headers, which makes the browser refuse it
 * (docs/00-prior-art.md, M18 — the previous system answered `cors()` with no allowlist at all).
 * Preflight (`OPTIONS`) is answered here, before authentication, because a preflight carries no
 * credentials by design.
 */
export function corsAllowlist(allowed: readonly string[]) {
  const origins = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !origins.has(origin)) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers',
      'X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key, X-Request-Id');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
