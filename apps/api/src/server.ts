import { createLogger, loadConfig, ConfigError } from '@crm/shared';
import { createDatabase } from '@crm/db';
import { buildApp } from './app.js';

/**
 * Process entry point. Startup is a gated sequence — configuration validated, dependencies
 * reached, and only then does the server listen. Failing loudly here is the whole point
 * (docs/00-prior-art.md, M6 and M17).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createDatabase(config.DATABASE_URL);

  const app = buildApp({ config, logger, db });

  /** Drains in-flight work before exiting so a deploy never severs a request mid-flight. */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    { port: config.PORT, preset: config.PRESET, role: config.PROCESS_ROLE, env: config.NODE_ENV },
    'listening'
  );
}

main().catch((error: unknown) => {
  // Configuration problems get a readable message; anything else gets a stack trace.
  // Either way the process exits non-zero so an orchestrator does not route traffic here.
  if (error instanceof ConfigError) {
    process.stderr.write(`\n${error.message}\n\n`);
  } else {
    process.stderr.write(`startup failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  }
  process.exit(1);
});
