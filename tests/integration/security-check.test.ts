import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, setTenant, type Database } from '@crm/db';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
let db: Database;

beforeAll(() => { db = createDatabase(url, { max: 2 }); });
afterAll(async () => { await db.$client.end(); });

describe('inspectDatabaseSecurity', () => {
  it('detects that the dev superuser bypasses tenant isolation', async () => {
    // The regression test for a bug in this very check: the probe originally used
    // `SET LOCAL app.org_id = $1`, which is a syntax error because SET cannot take a bind
    // parameter. It threw, and the error handling turned that into a false report that
    // isolation was working — the most dangerous possible outcome for a security check.
    const r = await inspectDatabaseSecurity(db);
    expect(r.isSuperuser).toBe(true);
    expect(r.isolationEffective).toBe(false);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.join(' ')).toMatch(/SUPERUSER/);
    expect(r.warnings.join(' ')).toMatch(/TENANT ISOLATION IS NOT IN EFFECT/);
  });

  it('leaves nothing behind, since the probe writes a row', async () => {
    await inspectDatabaseSecurity(db);
    const rows = await db.execute(sql`
      SELECT count(*)::int AS c FROM contact WHERE display_name = 'rls probe'`);
    expect((rows as unknown as Array<{ c: number }>)[0]!.c).toBe(0);
  });
});

describe('setTenant', () => {
  it('binds the org id safely, which SET LOCAL cannot do', async () => {
    // `SET LOCAL app.org_id = $1` is a syntax error in Postgres; set_config is a normal
    // function call and takes parameters. That matters because the alternative —
    // interpolating into SET — would be an injection point on the one setting that decides
    // which tenant's data is visible.
    const orgId = '00000000-0000-4000-8000-00000000abcd';
    await db.transaction(async (tx) => {
      await setTenant(tx, orgId);
      const rows = await tx.execute(sql`SELECT current_setting('app.org_id', true) AS v`);
      expect((rows as unknown as Array<{ v: string }>)[0]!.v).toBe(orgId);
    });
  });

  it('is transaction-scoped — it does not leak into the next transaction', async () => {
    await db.transaction(async (tx) => { await setTenant(tx, '00000000-0000-4000-8000-00000000abcd'); });
    const rows = await db.execute(sql`SELECT COALESCE(current_setting('app.org_id', true),'') AS v`);
    expect((rows as unknown as Array<{ v: string }>)[0]!.v).toBe('');
  });
});
