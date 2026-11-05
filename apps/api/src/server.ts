import { createLogger, loadConfig, ConfigError } from '@crm/shared';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole, verifySchema } from '@crm/db';
import { localKmsFromConfig } from '@crm/kms-local';
import { assertKeyRingCoversData } from '@crm/core';
import { createStorage } from '@crm/storage';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { buildApp } from './app.js';
import { IMPORT_PARSE_DEFAULTS, warmImportParsers } from './import-parse.js';

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

  // Which role tenant-scoped requests should run as. Null when the connecting role already
  // has policies enforced against it; otherwise the restricted role the migrations create,
  // but only when dropping to it was measured to actually make isolation work. The queries
  // themselves always set the tenant — the role is what decides whether the policies reading
  // it apply at all (apps/api/src/tenant.ts).
  const tenantRole = await resolveTenantRole(db, security);
  if (tenantRole !== null) {
    logger.info({ role: security.role, tenantRole },
      'tenant requests will run as a restricted role, so row-level security applies to them');
  } else if (!security.isolationEffective) {
    logger.warn({ role: security.role },
      'row-level security is NOT enforced on the request path: the connecting role bypasses ' +
      'it and no restricted role was available to drop to. Tenant isolation rests entirely ' +
      'on the org filter in each query. See docs/09-security.md');
  }

  const kms = localKmsFromConfig(config);
  // Refuse to run if the database holds data under a key this process cannot read (a retired key
  // dropped too early, D-31). Better a loud boot failure than messages that silently won't open.
  await assertKeyRingCoversData(db, kms);

  // Read-only from here: attachments are written by the gateway, which is the process
  // holding the connection they arrive on.
  const storage = createStorage(config);

  const app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage
  });
  // Picks up AI requests left waiting by a restart, and keeps the queue tidy.
  app.aiRunner.start();
  // Uploaded contact files are read in child processes (R-016); start them now, not on the first upload.
  warmImportParsers(IMPORT_PARSE_DEFAULTS);
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(
      { port: config.PORT, preset: config.PRESET, role: config.PROCESS_ROLE, env: config.NODE_ENV },
      'listening'
    );
  });

  /** Drains in-flight work before exiting so a deploy never severs a request mid-flight. */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    app.aiRunner.stop();
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
