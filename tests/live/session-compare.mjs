// Compares two session-audit runs step by step: node tests/live/session-compare.mjs <older run folder> <newer run folder> [out.md]
// Reads steps.jsonl from each, matches steps by area + name, and writes a table of time changes plus the steps that are new, gone, or changed from ok to FAILED (or back).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [oldDir, newDir, outFile] = process.argv.slice(2);
if (!oldDir || !newDir) { console.error('usage: session-compare.mjs <older run folder> <newer run folder> [out.md]'); process.exit(2); }
const load = (dir) => {
  const f = join(dir, 'steps.jsonl');
  if (!existsSync(f)) throw new Error(`no steps.jsonl in ${dir}`);
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const key = (r) => `${r.area} / ${r.name}`.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, '<time>').replace(/session-import-[a-z]+-[\d-]+/g, '<tag>');
const a = load(oldDir); const b = load(newDir);
const am = new Map(a.map((r) => [key(r), r])); const bm = new Map(b.map((r) => [key(r), r]));
const sec = (ms) => (ms / 1000).toFixed(2);
const out = [];
out.push(`# Session audit comparison\n\n- older: \`${oldDir}\` (${a.length} steps, ${a.filter((r) => !r.ok).length} failed, ${sec(a.reduce((t, r) => t + r.ms, 0))} s of step time)`);
out.push(`- newer: \`${newDir}\` (${b.length} steps, ${b.filter((r) => !r.ok).length} failed, ${sec(b.reduce((t, r) => t + r.ms, 0))} s of step time)\n`);

const both = [...bm.keys()].filter((k) => am.has(k));
const rows = both.map((k) => ({ k, o: am.get(k), n: bm.get(k) }));
const sum = (xs) => xs.reduce((t, r) => t + r, 0);
out.push(`## Totals on the ${rows.length} steps both runs have\n\nolder ${sec(sum(rows.map((r) => r.o.ms)))} s, newer ${sec(sum(rows.map((r) => r.n.ms)))} s.\n`);

out.push('## Time per step (sorted by the biggest change)\n\n| step | older s | newer s | change |\n|---|---:|---:|---:|');
for (const r of [...rows].sort((x, y) => Math.abs(y.n.ms - y.o.ms) - Math.abs(x.n.ms - x.o.ms))) {
  const d = r.n.ms - r.o.ms;
  out.push(`| ${r.k.replace(/\|/g, '/')} | ${sec(r.o.ms)} | ${sec(r.n.ms)} | ${d >= 0 ? '+' : ''}${sec(d)} |`);
}
const flips = rows.filter((r) => r.o.ok !== r.n.ok);
out.push(`\n## Steps whose result changed (${flips.length})\n`);
for (const r of flips) out.push(`- **${r.k}**: ${r.o.ok ? 'ok' : 'FAILED'} → ${r.n.ok ? 'ok' : 'FAILED'}${r.n.ok ? '' : `: ${r.n.note}`}`);
const added = [...bm.keys()].filter((k) => !am.has(k)); const gone = [...am.keys()].filter((k) => !bm.has(k));
out.push(`\n## New steps in the newer run (${added.length})\n`);
for (const k of added) { const r = bm.get(k); out.push(`- ${r.ok ? 'ok' : '**FAILED**'} ${sec(r.ms)} s · ${k}${r.ok ? '' : `: ${r.note}`}`); }
out.push(`\n## Steps only in the older run (${gone.length})\n`);
for (const k of gone) out.push(`- ${k}`);
const noisy = b.filter((r) => /browser reported:/.test(r.note));
out.push(`\n## Steps where the browser reported errors (${noisy.length})\n`);
for (const r of noisy) out.push(`- ${r.area} / ${r.name}: ${r.note.split('browser reported:')[1].trim()}`);
const text = out.join('\n') + '\n';
if (outFile) writeFileSync(outFile, text); else process.stdout.write(text);
