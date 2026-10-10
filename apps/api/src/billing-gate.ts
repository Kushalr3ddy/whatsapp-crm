import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { problem } from './problem.js';

/** How long a looked-up status is trusted. Short, so an operator's change takes effect within seconds. */
const TTL_MS = 10_000;

/** Org id → last seen status and when. In-process: a change is picked up when the entry expires. */
const cache = new Map<string, { status: string; at: number }>();

/** Forget what is cached for an org, so a billing change applies on the very next request. */
export function forgetBilling(orgId: string): void {
  cache.delete(orgId);
}

/**
 * Refuses data routes for an org that has not paid and has not been exempted.
 *
 * The web app also redirects to Billing, but that is a courtesy: this is the actual rule, so an
 * unpaid org cannot use the API by skipping the UI. Mounted after `requireTenant`, so `/auth` (to
 * sign in and ask who you are) and `/admin` stay reachable. Fails open on a lookup error, because a
 * database hiccup must not lock paying customers out.
 */
export function requireBilling(db: Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.crm?.orgId;
    if (orgId === undefined) { next(); return; }
    try {
      let hit = cache.get(orgId);
      if (hit === undefined || Date.now() - hit.at > TTL_MS) {
        const rows = (await db.execute(sql`SELECT billing_status AS status FROM org WHERE id = ${orgId}`)) as
          unknown as Array<{ status: string }>;
        hit = { status: rows[0]?.status ?? 'exempt', at: Date.now() };
        cache.set(orgId, hit);
      }
      if (hit.status === 'unpaid') {
        res.status(402).json(problem(req, 402, 'BILLING_REQUIRED',
          'This organisation has not paid yet. Open Billing, or ask an administrator to enable your account.'));
        return;
      }
    } catch {
      /* fail open — see above */
    }
    next();
  };
}
