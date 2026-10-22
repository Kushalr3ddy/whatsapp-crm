// Joins a session's step timings with the resource samples taken beside it, and writes report.md.
//   node tests/live/session-report.mjs <session-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
// timings.json is written at the end of a complete run; steps.jsonl is written as the run goes, so a stopped run can still be reported.
let rows, startedAt, totalMs;
try { ({ rows, startedAt, totalMs } = JSON.parse(readFileSync(join(dir, 'timings.json'), 'utf8'))); }
catch { rows = readFileSync(join(dir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); startedAt = rows[0].startedAt; totalMs = Date.now() - new Date(startedAt).getTime(); }
const lines = readFileSync(join(dir, 'resources.csv'), 'utf8').trim().split('\n');
const head = lines[0].split(',');
const samples = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], Number(v)])));
const within = (from, to) => samples.filter((s) => s.epoch_ms >= from - 1000 && s.epoch_ms <= to + 1000);
const max = (xs) => (xs.length === 0 ? 0 : Math.max(...xs));
const avg = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sec = (ms) => (ms / 1000).toFixed(2);

const out = [];
out.push('# Session audit report', '', `Started ${startedAt}. ${rows.length} steps in ${sec(totalMs)} s. ${rows.filter((r) => !r.ok).length} failed.`, '');

out.push('## Machine during the whole run', '', '| What | Lowest / average | Peak |', '|---|---|---|');
out.push(`| CPU used | avg ${avg(samples.map((s) => s.cpu_pct)).toFixed(0)} % | ${max(samples.map((s) => s.cpu_pct)).toFixed(0)} % |`);
out.push(`| Load average (1 min) | avg ${avg(samples.map((s) => s.load1)).toFixed(1)} | ${max(samples.map((s) => s.load1)).toFixed(1)} |`);
out.push(`| Memory used | lowest available ${Math.min(...samples.map((s) => s.mem_avail_mb)).toFixed(0)} MB | ${max(samples.map((s) => s.mem_used_mb)).toFixed(0)} MB used |`);
out.push(`| Swap used | | ${max(samples.map((s) => s.swap_used_mb)).toFixed(0)} MB |`);
for (const p of ['web', 'api', 'gateway', 'postgres', 'chromium']) out.push(`| ${p} | avg ${avg(samples.map((s) => s[`${p}_cpu_pct`])).toFixed(0)} % CPU | peak ${max(samples.map((s) => s[`${p}_rss_mb`])).toFixed(0)} MB memory, ${max(samples.map((s) => s[`${p}_cpu_pct`])).toFixed(0)} % CPU |`);
out.push('');

const areas = [...new Set(rows.map((r) => r.area))];
out.push('## Time per area', '', '| Area | Steps | Failed | Total | Slowest step |', '|---|---|---|---|---|');
for (const a of areas) {
  const r = rows.filter((x) => x.area === a);
  const slow = r.reduce((m, x) => (x.ms > m.ms ? x : m), r[0]);
  out.push(`| ${a} | ${r.length} | ${r.filter((x) => !x.ok).length} | ${sec(r.reduce((s, x) => s + x.ms, 0))} s | ${slow.name} (${sec(slow.ms)} s) |`);
}
out.push('');

out.push('## Every step', '', '| # | Area | Step | Time | Result | CPU peak | Memory avail | Note |', '|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const from = new Date(r.startedAt).getTime();
  const w = within(from, from + r.ms);
  out.push(`| ${r.n} | ${r.area} | ${r.name} | ${sec(r.ms)} s | ${r.ok ? 'ok' : '**FAILED**'} | ${max(w.map((s) => s.cpu_pct)).toFixed(0)} % | ${w.length ? Math.min(...w.map((s) => s.mem_avail_mb)).toFixed(0) : '?'} MB | ${r.note.replace(/\|/g, '/').slice(0, 230)} |`);
}
out.push('');

const slow = [...rows].filter((r) => r.ms > 1500 && !/settle|leave the gateway|Write the instructions|Test it|Find models|answers|queue/.test(r.name)).sort((a, b) => b.ms - a.ms).slice(0, 12);
out.push('## Slowest user-facing steps (waits for WhatsApp or the AI model left out)', '', '| Step | Time | Web CPU | API CPU | Free memory |', '|---|---|---|---|---|');
for (const r of slow) {
  const from = new Date(r.startedAt).getTime();
  const w = within(from, from + r.ms);
  out.push(`| ${r.area} / ${r.name} | ${sec(r.ms)} s | ${max(w.map((s) => s.web_cpu_pct)).toFixed(0)} % | ${max(w.map((s) => s.api_cpu_pct)).toFixed(0)} % | ${w.length ? Math.min(...w.map((s) => s.mem_avail_mb)).toFixed(0) : '?'} MB |`);
}
out.push('');
const failed = rows.filter((r) => !r.ok);
if (failed.length > 0) { out.push('## What failed', ''); for (const f of failed) out.push(`- **${f.area} / ${f.name}** (${sec(f.ms)} s): ${f.note}`); out.push(''); }
writeFileSync(join(dir, 'report.md'), out.join('\n'));
console.log(`wrote ${join(dir, 'report.md')}`);
