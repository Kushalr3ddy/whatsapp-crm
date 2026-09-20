import type { NextFunction, Request, Response } from 'express';
import { setTenant, assumeRole, type Database, type Transaction } from '@crm/db';

/**
 * Runs a unit of tenant-scoped database work inside a transaction that has `app.org_id` set,
 * which is what every row-level security policy reads.
 *
 * A function rather than a handle, because the transaction must not be held open for the whole
 * request: the next feature is media, where a handler authorises a download and then streams
 * bytes, and a transaction held across the stream would pin a pooled connection for the length
 * of the transfer. The transaction lasts exactly as long as the queries in it.
 */
export type TenantRunner = <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    /** Express's request type, augmented with the tenant-scoped executor. */
    interface Request {
      /** Present on every request past `requireTenant`. Absent means the middleware skipped. */
      tenant?: TenantRunner;
    }
  }
}

/**
 * Attaches the tenant-scoped database runner to a request.
 *
 * This is the second layer of tenant isolation, and until it existed the first layer was the
 * only one. Every query still carries an explicit `WHERE org_id`, which is real and tested —
 * but it is application code, and the point of row-level security is to survive the day
 * somebody writes a query that forgets it. The policies have been in place since migration
 * 0001 and were enforcing nothing on the request path, because nothing ever set `app.org_id`
 * for a request (docs/09-security.md).
 *
 * Two things have to be true for a policy to bite, and both are arranged here:
 *
 *  - **The tenant is set inside the transaction that reads.** `set_config(..., true)` is
 *    transaction-scoped, deliberately: setting it per connection would leak a tenant to
 *    whatever borrows that pooled connection next, which is worse than not setting it at all.
 *  - **The role is one that policies apply to.** A superuser or the owner of the table
 *    bypasses row-level security entirely, and in this deployment the application connects as
 *    the owner. `tenantRole` — resolved once at startup by measuring, not guessing — drops the
 *    transaction to `crm_app` when that is the case, and is null when the connecting role is
 *    already restricted and the switch would be pointless.
 */
export function withTenant(db: Database, tenantRole: string | null) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const orgId = req.crm?.orgId ?? '';
    // No tenant on the request means `requireTenant` has already refused it, or will.
    if (orgId === '') { next(); return; }

    req.tenant = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) => {
        if (tenantRole !== null) await assumeRole(tx, tenantRole);
        await setTenant(tx, orgId);
        return work(tx);
      });
    next();
  };
}
