import { createLogger, loadConfig, ConfigError } from '@crm/shared';
import { createDatabase, inspectDatabaseSecurity, verifySchema } from '@crm/db';
import { buildApp } from './app.js';

/** Thrown when the database does not match this build of the code. Always fatal. */
class SchemaMismatchError extends Error {
  /** Names the error so a crash log says what kind of failure this was. */
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

/**
 * Process entry point. Startup is a gated sequence — configuration validated, schema verified,
 * dependencies reached, and only then does the server listen. Failing loudly here is the whole
 * point (docs/00-prior-art.md, M6 and M17).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createDatabase(config.DATABASE_URL);

  // Refuse to start against a database that does not match this code. Fatal, unlike the
  // security warning below: if migrations are outstanding, queries WILL fail, and failing here
  // with an actionable message beats failing on a user's first request (M6).
  const schema = await verifySchema(db);
  if (!schema.ok) {
    throw new SchemaMismatchError(schema.problem ?? 'the database schema does not match this code');
  }
  logger.info({ migrations: schema.applied }, 'database schema verified');

  // Part of the gated startup sequence: check that tenant isolation genuinely works for the
  // role we connect as, BEFORE accepting traffic. Warns rather than refuses, because a
  // single-tenant deployment and local development are both legitimately fine without it.
  const security = await inspectDatabaseSecurity(db);
  for (const warning of security.warnings) {
    logger.warn({ role: security.role, isolationEffective: security.isolationEffective }, warning);
  }
  if (security.warnings.length === 0) {
    logger.info({ role: security.role }, 'tenant isolation verified for this database role');
  }

  const app = buildApp({ config, logger, db });
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(
      { port: config.PORT, preset: config.PRESET, role: config.PROCESS_ROLE, env: config.NODE_ENV },
      'listening'
    );
  });

  /** Drains in-flight work before exiting so a deploy never severs a request mid-flight. */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void db.$client.end({ timeout: 5 }).then(() => process.exit(0));
    });
    // If connections refuse to drain, leave anyway rather than blocking the deploy.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Configuration problems get a readable message; anything else gets a stack trace.
  // Either way the process exits non-zero so an orchestrator does not route traffic here.
  if (error instanceof ConfigError || error instanceof SchemaMismatchError) {
    process.stderr.write(`\n${error.name}: ${error.message}\n\n`);
  } else {
    process.stderr.write(`startup failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  }
  process.exit(1);
});
