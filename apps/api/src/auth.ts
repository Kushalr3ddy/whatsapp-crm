import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import type { Config } from '@crm/shared';
import type { Database } from '@crm/db';

/** The tenant a request acts within, attached by the auth middleware. */
export interface RequestContext {
  readonly orgId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    /** Express's request type, augmented with the tenant context our middleware attaches. */
    interface Request {
      /** Present on every authenticated request. Absent means the middleware did not run. */
      crm?: RequestContext;
    }
  }
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * A plain `===` returns faster the earlier two strings differ, which over many attempts reveals
 * the secret one character at a time. Lengths are compared first because `timingSafeEqual`
 * throws on a mismatch — that comparison is not constant-time, but a key's length is not the
 * secret.
 */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Requires a valid API key, and resolves which tenant the request acts as.
 *
 * Deliberately fails closed on every ambiguity. In particular, if the database holds more than
 * one org it refuses the request rather than guessing — a single config-level key cannot say
 * which tenant it speaks for, and picking one would be a cross-tenant data leak waiting to
 * happen. Per-key scopes in an `api_key` table are P2; this is the honest interim.
 */
export function requireApiKey(config: Config, db: Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (token === '' || !secretsMatch(token, config.API_KEY)) {
      // Never say which part was wrong; a 401 that distinguishes "no key" from "wrong key"
      // tells an attacker their key format is right.
      res.status(401).json({
        type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED',
        detail: 'Send a valid API key as: Authorization: Bearer <key>',
        request_id: req.id
      });
      return;
    }

    const rows = await db.execute(sql`SELECT id FROM org ORDER BY created_at ASC LIMIT 2`);
    const orgs = rows as unknown as Array<{ id: string }>;

    if (orgs.length === 0) {
      res.status(503).json({
        type: 'about:blank', title: 'Not provisioned', status: 503, code: 'NO_ORG',
        detail: 'No organisation exists yet. Create one before using the API.',
        request_id: req.id
      });
      return;
    }
    if (orgs.length > 1) {
      res.status(409).json({
        type: 'about:blank', title: 'Ambiguous tenant', status: 409, code: 'MULTIPLE_ORGS',
        detail: 'More than one organisation exists, and a config-level API key cannot say ' +
                'which it acts for. Per-org API keys arrive in P2.',
        request_id: req.id
      });
      return;
    }

    req.crm = { orgId: orgs[0]!.id };
    next();
  };
}
