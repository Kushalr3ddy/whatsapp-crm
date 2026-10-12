import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase, TABLE_NOTES } from '@crm/db';

/**
 * The schema visualizer (`npm run db:docs`) explains every table from `TABLE_NOTES`. This keeps
 * that list honest: a new table must say what it is for, and a dropped table must not linger.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const db = createDatabase(url, { max: 1 });
afterAll(async () => { await db.$client.end(); });

/** The public tables that exist after migrations, excluding drizzle's own bookkeeping. */
async function liveTables(): Promise<string[]> {
  const rows = await db.$client.unsafe(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_%'
    ORDER BY tablename`) as unknown as Array<{ tablename: string }>;
  return rows.map((r) => r.tablename);
}

describe('table notes', () => {
  it('has a note for every table', async () => {
    const missing = (await liveTables()).filter((t) => TABLE_NOTES[t] === undefined);
    expect(missing, `add to packages/db/src/table-notes.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no note for a table that no longer exists', async () => {
    const live = new Set(await liveTables());
    const stale = Object.keys(TABLE_NOTES).filter((t) => !live.has(t));
    expect(stale).toEqual([]);
  });

  it('gives every note a group and a real sentence', () => {
    for (const [name, note] of Object.entries(TABLE_NOTES)) {
      expect(note.group, name).not.toBe('');
      expect(note.purpose.length, name).toBeGreaterThan(30);
    }
  });
});
