import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { loadConfig, createLogger } from '@crm/shared';
import { createDatabase } from './client.js';

/**
 * Applies pending migrations, then exits. Run before the server starts, never from inside
 * it — the previous system created tables on every boot from application code, leaving two
 * schema sources of truth that nothing detected drift between (docs/00-prior-art.md, M5).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config);
  const db = createDatabase(config.DATABASE_URL, { max: 1 });

  const folder = fileURLToPath(new URL('../migrations', import.meta.url));
  log.info({ folder }, 'applying migrations');

  await migrate(db, { migrationsFolder: folder });
  await db.$client.end();

  log.info('migrations applied');
}

main().catch((error: unknown) => {
  // A failed migration must be loud and must stop the deploy. Never proceed to listen.
  process.stderr.write(`migration failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
