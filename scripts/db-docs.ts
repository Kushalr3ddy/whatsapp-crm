import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDatabase, TABLE_NOTES } from '@crm/db';

/**
 * Reads the live database and writes one self-contained HTML page that explains it: a diagram
 * of how tables point at each other, and for every table its columns, keys, indexes,
 * row-level-security policy, triggers, and a plain-English purpose from `TABLE_NOTES`.
 *
 * Generated from the database itself, not from the schema file, so it describes what is really
 * there (including hand-written SQL in migrations that the schema file cannot see).
 *   npm run db:docs [-- --out path/to/schema.html]
 */
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg >= 0 ? process.argv[outArg + 1]! : 'docs/generated/schema.html');
const url = process.env.DATABASE_URL;
if (url === undefined || url === '') throw new Error('DATABASE_URL is not set (see .env)');

/** One column of one table, as the page needs it. */
interface Col { name: string; type: string; nullable: boolean; default: string | null; pk: boolean }
/** A foreign key from one table's columns to another's. */
interface Fk { from: string; cols: string[]; to: string; toCols: string[]; onDelete: string }

const db = createDatabase(url, { max: 1 });
/** Runs a query and returns its rows as plain objects. */
async function q<T>(text: string): Promise<T[]> {
  return (await db.$client.unsafe(text)) as unknown as T[];
}

const tableRows = await q<{ name: string; rls: boolean; forced: boolean; rows: number }>(`
  SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
         COALESCE(s.n_live_tup, 0)::int AS rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE '\\_\\_%'
  ORDER BY c.relname`);

const colRows = await q<{ t: string; name: string; type: string; nullable: boolean; def: string | null }>(`
  SELECT table_name AS t, column_name AS name,
         CASE WHEN data_type = 'ARRAY' THEN udt_name || '[]' ELSE data_type END AS type,
         is_nullable = 'YES' AS nullable, column_default AS def
  FROM information_schema.columns WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position`);

const pkRows = await q<{ t: string; col: string }>(`
  SELECT c.relname AS t, a.attname AS col
  FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
  WHERE i.indisprimary AND n.nspname = 'public'`);

const fkRows = await q<{ from: string; cols: string[]; to: string; tocols: string[]; del: string }>(`
  SELECT cl.relname AS "from", ft.relname AS "to",
         ARRAY(SELECT a.attname FROM unnest(k.conkey) u(n) JOIN pg_attribute a
               ON a.attrelid = k.conrelid AND a.attnum = u.n) AS cols,
         ARRAY(SELECT a.attname FROM unnest(k.confkey) u(n) JOIN pg_attribute a
               ON a.attrelid = k.confrelid AND a.attnum = u.n) AS tocols,
         k.confdeltype AS del
  FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid
  JOIN pg_class ft ON ft.oid = k.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE k.contype = 'f' AND n.nspname = 'public'`);

const idxRows = await q<{ t: string; name: string; def: string }>(`
  SELECT tablename AS t, indexname AS name, indexdef AS def
  FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`);

const polRows = await q<{ t: string; name: string; cmd: string; roles: string; qual: string | null; chk: string | null }>(`
  SELECT tablename AS t, policyname AS name, cmd, array_to_string(roles, ', ') AS roles,
         qual, with_check AS chk
  FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`);

const trgRows = await q<{ t: string; name: string; def: string }>(`
  SELECT c.relname AS t, g.tgname AS name, pg_get_triggerdef(g.oid) AS def
  FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY c.relname, g.tgname`);

const fnRows = await q<{ name: string; def: string }>(`
  SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' ORDER BY p.proname`);

await db.$client.end();

const DELETE_RULE: Record<string, string> = {
  a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default'
};
const pk = new Set(pkRows.map((r) => `${r.t}.${r.col}`));
const tables = tableRows.map((t) => ({
  name: t.name,
  group: TABLE_NOTES[t.name]?.group ?? 'Uncategorised',
  purpose: TABLE_NOTES[t.name]?.purpose ?? 'No note written yet. Add one to packages/db/src/table-notes.ts.',
  rows: t.rows,
  rls: t.rls, forced: t.forced,
  cols: colRows.filter((c) => c.t === t.name).map((c): Col => ({
    name: c.name, type: c.type, nullable: c.nullable, default: c.def, pk: pk.has(`${t.name}.${c.name}`)
  })),
  fks: fkRows.filter((f) => f.from === t.name).map((f): Fk => ({
    from: f.from, cols: f.cols, to: f.to, toCols: f.tocols, onDelete: DELETE_RULE[f.del] ?? f.del
  })),
  indexes: idxRows.filter((i) => i.t === t.name).map((i) => ({ name: i.name, def: i.def })),
  policies: polRows.filter((p) => p.t === t.name),
  triggers: trgRows.filter((g) => g.t === t.name)
}));

const model = {
  generatedAt: new Date().toISOString(),
  tables,
  functions: fnRows,
  counts: {
    tables: tables.length, policies: polRows.length, triggers: trgRows.length,
    functions: fnRows.length, foreignKeys: fkRows.length
  }
};

const PAGE = readFileSync(new URL('./db-docs.template.html', import.meta.url), 'utf8');
mkdirSync(dirname(OUT), { recursive: true });
// `<` is escaped so a SQL default or definition containing "</script>" cannot end the data block.
const data = JSON.stringify(model).replace(/</g, '\\u003c');
writeFileSync(OUT, PAGE.replace('__DATA__', () => data));
process.stdout.write(`wrote ${OUT}\n  ${String(model.counts.tables)} tables, ${String(model.counts.foreignKeys)} foreign keys, `
  + `${String(model.counts.policies)} policies, ${String(model.counts.triggers)} triggers, `
  + `${String(model.counts.functions)} function\n`);
