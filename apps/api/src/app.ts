import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import type { Config, Logger } from '@crm/shared';
import type { Database } from '@crm/db';

/** Everything the HTTP layer needs, passed in rather than imported. */
export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly db: Database;
}

/**
 * Builds the HTTP application. Takes its dependencies as arguments so tests can pass fakes
 * and so the dependency graph stays readable — this is the composition root the layering
 * rule relies on (docs/04-architecture.md, ADR-0003).
 *
 * Route handlers stay thin: validate, delegate, respond. Nothing that talks to a third
 * party runs here — it goes on a queue (docs/00-prior-art.md, M2 and M27).
 */
export function buildApp(deps: AppDependencies) {
  const app = Fastify({
    // `loggerInstance`, not `logger`: Fastify v5 takes a pre-built pino instance here,
    // while `logger` expects options it would construct one from.
    loggerInstance: deps.logger,
    // Trust the reverse proxy for client IPs; Caddy sits in front (docs/13-deployment.md).
    trustProxy: true,
    // Echo a correlation id on every request so one request's trail can be grepped out of
    // concurrent traffic, and so it can later be propagated into queue jobs.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID()
  });

  app.addHook('onSend', async (req, reply) => {
    void reply.header('x-request-id', req.id);
  });

  /**
   * Liveness. Answers "is this process running?" and nothing more — it must not touch the
   * database, or a database blip would cause an orchestrator to kill a healthy process.
   */
  app.get('/health', async () => ({ status: 'ok' }));

  /**
   * Readiness. Answers "can this process serve traffic?", which means every dependency is
   * reachable. Startup is gated on this: the previous system listened and accepted traffic
   * even when its bootstrap had failed (docs/00-prior-art.md, M6).
   */
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    try {
      await deps.db.execute(sql`select 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'failed';
    }

    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks,
      preset: deps.config.PRESET,
      role: deps.config.PROCESS_ROLE
    });
  });

  return app;
}

/** The built application's type, inferred so the pino logger's typing flows through it. */
export type App = ReturnType<typeof buildApp>;
