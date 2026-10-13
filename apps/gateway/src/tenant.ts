import type { SQL } from 'drizzle-orm';
import { assumeRole, setTenant, type Database } from '@crm/db';

/**
 * A database handle pinned to one org, for the gateway (D-41).
 *
 * The API enters the caller's tenant on every request, so Postgres itself refuses another org's
 * rows. The gateway has no request, and used to query as the connecting role with only each
 * query's own `WHERE org_id` between it and another tenant. This is the equivalent of the API's
 * `req.tenant`: every statement runs in its own short transaction that first drops to the
 * restricted role and sets `app.org_id`, so a query that forgot its org filter returns nothing
 * from another org instead of everything.
 *
 * Short transactions per statement, not one held open: a send sleeps for seconds and calls the
 * network between queries, and a transaction held across that would pin a pooled connection per
 * message in flight.
 *
 * Only `execute` and `transaction` exist, because those are all the gateway and `@crm/core`
 * call. Anything else throws rather than quietly running unscoped on the pool.
 */
export function tenantDatabase(base: Database, orgId: string, role: string | null): Database {
  /** Enters the tenant on an open transaction: restricted role first, then the org. */
  const enter = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<void> => {
    if (role !== null) await assumeRole(tx, role);
    await setTenant(tx, orgId);
  };

  const scoped = {
    execute: (query: SQL) =>
      base.transaction(async (tx) => {
        await enter(tx);
        return tx.execute(query);
      }),
    transaction: <T>(work: Parameters<Database['transaction']>[0] extends (tx: infer X) => infer R
      ? (tx: X) => R : never) =>
      base.transaction(async (tx) => {
        await enter(tx);
        return work(tx) as Promise<T>;
      })
  };

  return new Proxy(scoped, {
    get(target, prop, receiver) {
      if (prop === 'execute' || prop === 'transaction') return Reflect.get(target, prop, receiver);
      // `then` is probed by `await`; answering undefined keeps the handle awaitable-safe.
      if (prop === 'then') return undefined;
      throw new Error(
        `tenant-scoped database: "${String(prop)}" is not available; use execute or transaction`
      );
    }
  }) as unknown as Database;
}
