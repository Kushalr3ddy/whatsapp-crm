// Keeps tests/regression/REGISTRY.md and the tests in step: node tests/regression/check-registry.mjs
//  - every row marked `guarded` has at least one test whose title carries its [R-nnn] tag;
//  - every [R-nnn] tag in a test names a row in the registry;
//  - no row stays `fixed` (fixed but still unguarded) and no id appears twice.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const registry = readFileSync('tests/regression/REGISTRY.md', 'utf8');
const rows = [...registry.matchAll(/^\| (R-\d{3}) \| ([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| ([a-z]+) \|/gm)]
  .map((m) => ({ id: m[1], status: m[6].trim() }));
const ids = new Map();
const problems = [];
for (const r of rows) { if (ids.has(r.id)) problems.push(`${r.id} is listed twice`); ids.set(r.id, r.status); }

const files = [];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); } else if (/\.(test|spec)\.ts$/.test(f)) files.push(p); } };
for (const d of ['tests', 'packages', 'apps']) { try { walk(d); } catch { /* folder absent */ } }

const used = new Map();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/(?:test|it|describe)(?:\.[a-z]+)?\(\s*['"`][^'"`]*\[(R-\d{3})\]/g)) {
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(f);
  }
}
for (const [id, status] of ids) {
  if (status === 'fixed') problems.push(`${id} is fixed but has no passing test yet: write one and mark it guarded`);
  if (status === 'guarded' && !used.has(id)) problems.push(`${id} is marked guarded but no test title contains [${id}]`);
}
for (const [id, where] of used) if (!ids.has(id)) problems.push(`[${id}] is used in ${where[0]} but is not in tests/regression/REGISTRY.md`);

const guarded = [...ids].filter(([, s]) => s === 'guarded').length;
console.log(`registry: ${ids.size} bugs, ${guarded} guarded, ${[...ids].filter(([, s]) => s === 'open').length} open; ${used.size} tagged in tests`);
if (problems.length > 0) { console.error('\n' + problems.map((p) => `  ✗ ${p}`).join('\n') + '\n'); process.exit(1); }
