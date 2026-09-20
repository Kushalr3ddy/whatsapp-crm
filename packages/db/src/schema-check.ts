import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** What the schema check found. */
export interface SchemaCheckResult {
  /** Migrations that exist as files in the repository. */
  readonly expected: number;
  /** Migrations the database records as applied. */
  readonly applied: number;
  /** Tables the code needs that are not in the database. */
  readonly missingTables: readonly string[];
  /** True when the database matches what this build of the code expects. */
  readonly ok: boolean;
  readonly problem: string | null;
}

/**
 * Tables the application cannot function without. Checked by name rather than by diffing the
 * whole schema: a full diff would be stricter but would also fail on harmless differences
 * (an index added by hand, a column another tool created), which trains people to ignore it.
 */
const REQUIRED_TABLES = [
  'org', 'app_user', 'org_membership', 'contact', 'contact_identity',
  'sender_identity', 'channel_session', 'channel_auth_state', 'conversation', 'message',
  'session', 'api_key'
] as const;

/**
 * Verifies the database matches what this build of the code expects, before the server starts.
 *
 * Two failure modes this catches, both of which otherwise surface as a confusing error on the
 * first real request rather than at boot:
 *
 *   1. **Migrations not run.** Someone pulls a branch that adds a column and starts the server
 *      without migrating. Queries fail on a missing column, and the error names the column
 *      rather than the cause.
 *   2. **Pointing at the wrong database.** A `DATABASE_URL` aimed at an empty database, or at
 *      another project's, looks identical to a healthy start until the first query.
 *
 * This is part of the gated startup sequence (docs/00-prior-art.md, M6) — the previous system's
 * bootstrap was fire-and-forget and served traffic even when table creation had failed.
 */
export async function verifySchema(db: Database): Promise<SchemaCheckResult> {
  const expected = await countMigrationFiles();

  let applied = 0;
  try {
    const rows = await db.execute(sql`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`);
    applied = (rows as unknown as Array<{ c: number }>)[0]?.c ?? 0;
  } catch {
    // The table itself is absent, which means no migration has ever run here.
    return {
      expected, applied: 0, missingTables: [...REQUIRED_TABLES], ok: false,
      problem: `this database has never been migrated (no drizzle.__drizzle_migrations table). Run: npm run db:migrate`
    };
  }

  const present = await db.execute(sql`
    SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public'`);
  const names = new Set((present as unknown as Array<{ t: string }>).map((r) => r.t));
  const missingTables = REQUIRED_TABLES.filter((t) => !names.has(t));

  if (missingTables.length > 0) {
    return {
      expected, applied, missingTables, ok: false,
      problem: `missing ${String(missingTables.length)} required table(s): ${missingTables.join(', ')}. ` +
        `The database has ${String(applied)} of ${String(expected)} migrations applied. Run: npm run db:migrate`
    };
  }

  if (applied < expected) {
    return {
      expected, applied, missingTables: [], ok: false,
      problem: `${String(expected - applied)} migration(s) have not been applied ` +
        `(${String(applied)} of ${String(expected)}). The tables exist but may be missing recent ` +
        `columns or constraints. Run: npm run db:migrate`
    };
  }

  if (applied > expected) {
    // The database is ahead of the code — usually a rollback to an older commit without a
    // matching database rollback. Worth saying explicitly, because the failure it causes later
    // (a column the code does not know about, or a constraint it violates) looks unrelated.
    return {
      expected, applied, missingTables: [], ok: false,
      problem: `the database is AHEAD of this code: ${String(applied)} migrations applied but only ` +
        `${String(expected)} exist in this checkout. You are probably running older code against a ` +
        `newer database. Check out the matching commit, or migrate a fresh database.`
    };
  }

  return { expected, applied, missingTables: [], ok: true, problem: null };
}

/** Counts migrations in the journal that ships with this build of the code. */
async function countMigrationFiles(): Promise<number> {
  const journalPath = fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url));
  const parsed = JSON.parse(await readFile(journalPath, 'utf8')) as { entries?: unknown[] };
  return parsed.entries?.length ?? 0;
}
