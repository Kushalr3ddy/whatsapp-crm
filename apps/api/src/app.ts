import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Config, Logger } from '@crm/shared';
import type { Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import type { PasswordHasher } from '@crm/auth-builtin';
import type { StorageDriver } from '@crm/storage';
import { attachPrincipal, requireAuthenticated, requireTenant, requireCsrf } from './auth.js';
import { withTenant } from './tenant.js';
import { rateLimitApiKey } from './rate-limit.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { sendersRouter } from './routes/senders.js';
import { messagesRouter } from './routes/messages.js';
import { mediaRouter } from './routes/media.js';
import { importsRouter } from './routes/imports.js';
import { campaignsRouter } from './routes/campaigns.js';

/**
 * How large a file may be uploaded to `/imports`.
 *
 * 20 MB is a very large CSV — roughly 200,000 contact rows — and small enough that holding one
 * in memory while it is parsed is unremarkable. It becomes a streaming read, and a larger
 * number, when the `SourceConnector` port lands (docs/07-ingestion.md).
 */
const IMPORT_LIMIT = '20mb';
const IMPORT_LIMIT_BYTES = 20 * 1024 * 1024;

/** Everything the HTTP layer needs, passed in rather than imported. */
export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly db: Database;
  readonly kms: KmsDriver;
  readonly hasher: PasswordHasher;
  /** Where attachments live. The API only ever reads; the gateway is what writes them. */
  readonly storage: StorageDriver;
  /**
   * The Postgres role tenant queries run as, or null to stay as the connecting role.
   * Resolved at startup by `resolveTenantRole`, because whether it is needed depends on
   * whether the connecting role bypasses row-level security (`apps/api/src/tenant.ts`).
   */
  readonly tenantRole: string | null;
}

/**
 * Builds the HTTP application. Takes its dependencies as arguments so tests can pass fakes
 * and so the dependency graph stays readable — this is the composition root the layering
 * rule relies on (docs/04-architecture.md, ADR-0003).
 *
 * Route handlers stay thin: validate, delegate, respond. Nothing that talks to a third
 * party runs here — it goes on a queue (docs/00-prior-art.md, M2 and M27).
 */
export function buildApp(deps: AppDependencies): Express {
  const app = express();

  // Trust the reverse proxy for client IPs; Caddy sits in front (docs/13-deployment.md).
  app.set('trust proxy', true);
  // Don't advertise the framework. Free, and one less thing for a scanner to fingerprint.
  app.disable('x-powered-by');

  // Correlation id on every request, so one request's trail can be grepped out of
  // concurrent traffic and later propagated into queue jobs.
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' && existing !== '' ? existing : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      }
    })
  );

  app.use(express.json({ limit: '1mb' }));
  // The import upload is the one route that takes a file rather than JSON. Scoped to that
  // path and capped, so no other route inherits a large body limit — the system this replaces
  // had a global 50 MB JSON limit and every endpoint wore the cost (M3).
  // CSV and Excel both arrive as a raw body on this one path. Excel is binary, so its type and
  // `application/octet-stream` (what some clients send) are accepted too; the handler tells them
  // apart by the bytes, not the header.
  app.use('/api/v1/imports', express.raw({
    type: [
      'text/csv', 'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ],
    limit: IMPORT_LIMIT
  }));

  /**
   * Liveness. Answers "is this process running?" and nothing more — it must not touch the
   * database, or a database blip would cause an orchestrator to kill a healthy process.
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  /**
   * Readiness. Answers "can this process serve traffic?", which means every dependency is
   * reachable. Startup is gated on this: the previous system listened and accepted traffic
   * even when its bootstrap had failed (docs/00-prior-art.md, M6).
   */
  app.get('/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    try {
      await deps.db.execute(sql`select 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'failed';
    }

    const ready = Object.values(checks).every((c) => c === 'ok');
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks,
      preset: deps.config.PRESET,
      role: deps.config.PROCESS_ROLE
    });
  });

  // Everything under /api/v1 authenticates and resolves a tenant. Mounted as one guard
  // rather than per-route, so a new route cannot be added unprotected by omission.
  //
  // The ordering matters and is deliberate:
  //   attachPrincipal     — works out who is calling; never rejects
  //   rateLimitApiKey     — enforces the key's own rate_limit_per_min. Above /auth, so a
  //                         runaway integration cannot spend the login route's throttle
  //   requireCsrf         — only bites cookie-authenticated writes; header auth passes through
  //   /auth               — must be reachable unauthenticated: it is how you get a credential
  //   requireAuthenticated— the door closes here
  //   /admin              — provisioning, before a tenant exists to belong to
  //   requireTenant       — refuses the bootstrap key everywhere below, so no data route can
  //                         be reached by the deployment-level secret
  //   withTenant          — opens the tenant-scoped executor the data routes run every query
  //                         through. Mounted here, once, rather than per route: the routers
  //                         below are no longer given a pool handle at all, so a new data
  //                         route cannot reach the database except through this
  const api = express.Router();
  api.use(attachPrincipal(deps.config, deps.db));
  api.use(rateLimitApiKey);
  api.use(requireCsrf);
  // Before the door closes: logging in is how a credential is obtained.
  api.use('/auth', authRouter(deps.db, deps.hasher, deps.config.NODE_ENV === 'production'));
  api.use(requireAuthenticated);
  api.use('/admin', adminRouter(deps.db, deps.hasher));
  api.use(requireTenant);
  api.use(withTenant(deps.db, deps.tenantRole));
  api.use('/senders', sendersRouter());
  api.use('/media', mediaRouter(deps.storage));
  api.use('/imports', importsRouter(deps.storage, IMPORT_LIMIT_BYTES));
  api.use('/campaigns', campaignsRouter({
    perMinute: deps.config.SEND_RATE_PER_MINUTE, perDay: deps.config.SEND_RATE_PER_DAY
  }));
  api.use('/', messagesRouter(deps.kms, deps.config.DEFAULT_COUNTRY));
  app.use('/api/v1', api);

  /** Anything unrouted. Kept in the same problem+json shape as a real error. */
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: `No route for ${req.method} ${req.path}.`,
      request_id: req.id
    });
  });

  /**
   * The single error boundary. Express 5 forwards rejected promises from async handlers
   * here automatically, which is the main reason for choosing 5 over 4 — in Express 4 an
   * async handler that throws hangs the request instead of answering it.
   *
   * Errors are logged once, here, rather than at every layer (docs/11-conventions.md).
   */
  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log.error({ err: error }, 'unhandled error');
    res.status(500).json({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      // Never leak an internal message to a caller; it is in the logs, correlated by id.
      detail: 'The request could not be completed.',
      request_id: req.id
    });
  });

  return app;
}
