import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, verifySchema, type Database } from '@crm/db';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
let db: Database;

beforeAll(() => { db = createDatabase(url, { max: 2 }); });
afterAll(async () => { await db.$client.end(); });

describe('verifySchema', () => {
  it('passes against a fully migrated database', async () => {
    const r = await verifySchema(db);
    expect(r.ok).toBe(true);
    expect(r.problem).toBeNull();
    expect(r.missingTables).toEqual([]);
    expect(r.applied).toBe(r.expected);
    expect(r.expected).toBeGreaterThan(0);
  });

  it('counts the migrations that actually shipped with this code', async () => {
    // Guards against the journal being unreadable and silently counting zero, which would
    // make the "database is ahead of the code" branch fire on a healthy database.
    const r = await verifySchema(db);
    const rows = await db.execute(sql`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`);
    expect(r.applied).toBe((rows as unknown as Array<{ c: number }>)[0]!.c);
    expect(r.expected).toBeGreaterThanOrEqual(7);
  });
});
