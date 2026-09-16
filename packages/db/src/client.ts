import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** A connected database handle, typed against the schema. */
export type Database = ReturnType<typeof createDatabase>;

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
