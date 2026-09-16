import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createLogger, type Config } from '@crm/shared';
import type { Database } from '@crm/db';
import { buildApp } from './app.js';

const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test'
} as unknown as Config;

const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

/** A database stand-in whose connectivity check either answers or throws. */
function stubDb(reachable: boolean): Database {
  return {
    execute: async () => {
      if (!reachable) throw new Error('connection refused');
      return [];
    }
  } as unknown as Database;
}

describe('health and readiness', () => {
  it('reports liveness without touching the database', async () => {
    // /health must not depend on the database, or a transient DB blip would cause an
    // orchestrator to kill a process that is actually fine.
    const app = buildApp({ config, logger, db: stubDb(false) });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    const app = buildApp({ config, logger, db: stubDb(true) });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
  });

  it('reports 503 when the database is unreachable', async () => {
    // The M6 regression test: the old system listened and served traffic even when its
    // bootstrap had failed. Readiness has to be able to say no.
    const app = buildApp({ config, logger, db: stubDb(false) });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.database).toBe('failed');
  });
});

describe('request correlation', () => {
  it('echoes a caller-supplied request id', async () => {
    const app = buildApp({ config, logger, db: stubDb(true) });
    const res = await request(app).get('/health').set('x-request-id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('generates a request id when the caller omits one', async () => {
    const app = buildApp({ config, logger, db: stubDb(true) });
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('unknown routes', () => {
  it('answers 404 in the same shape as an error, with a correlation id', async () => {
    const app = buildApp({ config, logger, db: stubDb(true) });
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.request_id).toBeTruthy();
  });
});
