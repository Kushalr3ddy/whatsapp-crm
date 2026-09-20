import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';
import { withTenant, type TenantRunner } from '../../apps/api/src/tenant.js';

/**
 * Row-level security on the request path.
 *
 * Separate from `api.test.ts` because it asks a different question. Those tests check that the
 * routes return the right rows; these check that the database would refuse the wrong ones even
 * if the routes asked for them. Every query in the application filters by `org_id`, so an
 * application-level test can never tell the two layers apart — the only way to see the second
 * one is to run a query with no filter at all and watch Postgres withhold the rows.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let tenantRole: string | null;
let isolationEffective: boolean;
let orgA: string;
let orgB: string;
let keyA: string;

/**
 * Builds the tenant runner the way a request gets one, by running the real middleware over a
 * request stub. Reimplementing it here would test a copy of the code rather than the code.
 */
function asTenant(orgId: string): TenantRunner {
  const req = { crm: { orgId } } as unknown as ExpressRequest;
  withTenant(db, tenantRole)(req, {} as ExpressResponse, () => undefined);
  return req.tenant!;
}

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  isolationEffective = security.isolationEffective;
  tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const rows = await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','rls-a'), ('b','rls-b') RETURNING id, slug`);
  const orgs = rows as unknown as Array<{ id: string; slug: string }>;
  orgA = orgs.find((o) => o.slug === 'rls-a')!.id;
  orgB = orgs.find((o) => o.slug === 'rls-b')!.id;

  // Written as the owning role, outside any tenant transaction, so the rows exist regardless
  // of what the policies would have allowed. The point is what can be *read* back.
  await db.execute(sql`
    INSERT INTO contact (org_id, display_name, source)
    VALUES (${orgA}, 'belongs to A', 'test'), (${orgB}, 'belongs to B', 'test')`);

  keyA = (await issueApiKey(db, {
    orgId: orgA, name: 'rls-a', scopes: ['senders:read', 'senders:write', 'conversations:read']
  })).secret;
});

describe('the mechanism is actually in force', () => {
  /**
   * Guards every other test in this file. If the connecting role bypasses row-level security
   * and no restricted role was available to drop to, the assertions below would pass for the
   * wrong reason — the rows would be filtered by the `WHERE org_id` we deliberately leave out,
   * which is to say not filtered at all. This makes that situation a failure rather than a
   * green suite that proves nothing.
   */
  it('either the connecting role is restricted, or requests drop to one that is', () => {
    expect(isolationEffective || tenantRole !== null).toBe(true);
  });
});

describe('reads', () => {
  it('withholds another tenant’s rows from a query that never filtered by org', async () => {
    const rows = await asTenant(orgA)((tx) => tx.execute(sql`
      SELECT display_name AS "displayName" FROM contact ORDER BY display_name`));

    // No `WHERE org_id` anywhere in that query. Both contacts exist; one comes back.
    expect((rows as unknown as Array<{ displayName: string }>).map((r) => r.displayName))
      .toEqual(['belongs to A']);
  });

  it('gives each tenant a different answer to the identical query', async () => {
    const count = async (orgId: string): Promise<number> => {
      const rows = await asTenant(orgId)((tx) => tx.execute(sql`
        SELECT count(*)::int AS n FROM contact`));
      return (rows as unknown as Array<{ n: number }>)[0]!.n;
    };
    expect(await count(orgA)).toBe(1);
    expect(await count(orgB)).toBe(1);
    // And the unscoped truth is two, which is what the policies are hiding half of.
    const all = await db.execute(sql`SELECT count(*)::int AS n FROM contact`);
    expect((all as unknown as Array<{ n: number }>)[0]!.n).toBe(2);
  });
});

describe('writes', () => {
  it('refuses to insert a row belonging to another tenant', async () => {
    // The policies carry WITH CHECK as well as USING, so a compromised or simply buggy handler
    // cannot write into a tenant it is not acting for — which a `WHERE org_id` on reads would
    // never have caught.
    await expect(asTenant(orgA)((tx) => tx.execute(sql`
      INSERT INTO contact (org_id, display_name, source)
      VALUES (${orgB}, 'planted by A', 'test')`))).rejects.toThrow(/row-level security/i);

    const planted = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE display_name = 'planted by A'`);
    expect((planted as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it('refuses to update another tenant’s row, silently matching nothing', async () => {
    // An UPDATE is filtered by USING before WITH CHECK is reached, so this is not an error —
    // the row is simply not there to update. Asserted because the difference matters when
    // reading code: a handler cannot tell "forbidden" from "absent", which is the intent.
    await asTenant(orgA)((tx) => tx.execute(sql`
      UPDATE contact SET display_name = 'renamed by A' WHERE org_id = ${orgB}`));

    const untouched = await db.execute(sql`
      SELECT count(*)::int AS n FROM contact WHERE display_name = 'belongs to B'`);
    expect((untouched as unknown as Array<{ n: number }>)[0]!.n).toBe(1);
  });
});

describe('the tenant does not outlive the transaction', () => {
  it('leaves no tenant set on the pooled connection afterwards', async () => {
    await asTenant(orgA)((tx) => tx.execute(sql`SELECT 1`));

    // `set_config(..., true)` is transaction-scoped on purpose. Setting it per connection
    // would hand the next borrower of that pooled connection somebody else's tenant, which is
    // worse than never setting it (packages/db/src/security-check.ts).
    const rows = await db.execute(sql`
      SELECT coalesce(current_setting('app.org_id', true), '') AS org`);
    expect((rows as unknown as Array<{ org: string }>)[0]!.org).toBe('');
  });

  it('restores the connecting role afterwards', async () => {
    const inside = await asTenant(orgA)((tx) => tx.execute(sql`SELECT current_user AS who`));
    const outside = await db.execute(sql`SELECT current_user AS who`);

    const within = (inside as unknown as Array<{ who: string }>)[0]!.who;
    const after = (outside as unknown as Array<{ who: string }>)[0]!.who;
    if (tenantRole !== null) expect(within).toBe(tenantRole);
    // Either way the pool is back to normal: `SET LOCAL ROLE` ends with its transaction, so
    // administrative work outside a request is unaffected by what a request did.
    expect(after).not.toBe(tenantRole === null ? 'nobody' : tenantRole);
  });
});

describe('through the HTTP API', () => {
  it('serves one tenant’s senders and not the other’s', async () => {
    await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgA}, 'baileys', 'A number', 'active'),
             (${orgB}, 'baileys', 'B number', 'active')`);

    const r = await request(app).get('/api/v1/senders').set('Authorization', `Bearer ${keyA}`);
    expect(r.status).toBe(200);
    expect((r.body.data as Array<{ label: string }>).map((s) => s.label)).toEqual(['A number']);
  });

  it('still answers a normal request end to end under the restricted role', async () => {
    // The role switch is not much use if it breaks the routes: this is the grant check. A
    // missing GRANT on a new table shows up here as a 500 rather than in production.
    const created = await request(app).post('/api/v1/senders')
      .set('Authorization', `Bearer ${keyA}`)
      .send({ label: 'made under rls', provider: 'baileys' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/v1/senders').set('Authorization', `Bearer ${keyA}`);
    expect((listed.body.data as Array<{ label: string }>).map((s) => s.label))
      .toContain('made under rls');
  });
});
