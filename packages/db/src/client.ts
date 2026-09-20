import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** A connected database handle, typed against the schema. */
export type Database = ReturnType<typeof createDatabase>;

/**
 * An executor inside an open transaction, as handed to a `db.transaction()` callback.
 *
 * Named because tenant-scoped work has to be typed against it rather than against `Database`:
 * `app.org_id` is transaction-scoped, so a query that runs on the pool instead of the open
 * transaction silently carries no tenant at all (`packages/db/src/security-check.ts`).
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Opens the connection pool. One per process; the caller owns its lifetime and closes it
 * on shutdown so queues drain cleanly (docs/13-deployment.md).
 */
export function createDatabase(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Fail fast rather than hanging a request behind an unreachable database.
    connect_timeout: 10,
    idle_timeout: 30
  });
  return Object.assign(drizzle(sql, { schema }), { $client: sql });
}

export * as schema from './schema.js';
