import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema, type Database } from '@crm/db';

/**
 * A clock the whole engine can be run against, so days of behaviour take seconds.
 *
 * The engine reads time in two places: JavaScript (`new Date()`) and SQL (`now()`, used by the
 * window queries and by `markMessageSent`). Both have to move together or a window count would
 * compare simulated sends against the real wall clock. JavaScript is handled by faking `Date`.
 * SQL is handled with a `simclock.now()` function that shadows `pg_catalog.now()` — but ONLY on the
 * simulation's own connections, whose `search_path` lists `simclock` first. Every other connection,
 * and every other test file, still gets the real `now()`, and with the clock table empty even the
 * simulation connections fall back to it.
 */
export type SimDb = Database;

/** Opens a pool whose unqualified `now()` is the simulated clock, and installs the shim. */
export async function openSimDatabase(url: string): Promise<SimDb> {
  const admin = postgres(url, { max: 1 });
  await admin.unsafe('CREATE SCHEMA IF NOT EXISTS simclock');
  await admin.unsafe('CREATE TABLE IF NOT EXISTS simclock.clock (t timestamptz)');
  await admin.unsafe(`
    CREATE OR REPLACE FUNCTION simclock.now() RETURNS timestamptz LANGUAGE sql STABLE AS
    $$ SELECT coalesce((SELECT t FROM simclock.clock LIMIT 1), pg_catalog.now()) $$`);
  await admin.unsafe('TRUNCATE simclock.clock');
  await admin.end();

  const client = postgres(url, {
    max: 4, connection: { search_path: 'simclock, public, pg_catalog' }
  });
  return Object.assign(drizzle(client, { schema }), { $client: client }) as unknown as SimDb;
}

/** Removes the shim, so nothing of the simulation outlives it. */
export async function closeSimDatabase(db: SimDb): Promise<void> {
  await db.$client.end();
  const admin = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test', { max: 1 });
  await admin.unsafe('DROP SCHEMA IF EXISTS simclock CASCADE');
  await admin.end();
}

/** Moves JavaScript time and the database's `now()` to the same instant. */
export async function setSimTime(db: SimDb, at: Date): Promise<void> {
  vi.setSystemTime(at);
  await db.execute(sql`DELETE FROM simclock.clock`);
  await db.execute(sql`INSERT INTO simclock.clock (t) VALUES (${at.toISOString()}::timestamptz)`);
}
