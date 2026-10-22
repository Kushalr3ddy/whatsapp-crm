// Builds regression-report.md from the run's result files: node tests/regression/report.mjs
//   test-results/regress/playwright.json   (browser tests)        test-results/regress/vitest.json (unit + integration, local runs)
//   test-results/regress/budgets-run.json  (click-to-ready times) tests/regression/budgets.json + REGISTRY.md
// Exit code 1 when a test failed (or, with REGRESS_STRICT_BUDGETS=1, when a time is over budget).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dir = 'test-results/regress';
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const tests = []; // { layer, title, status }

const pw = read(`${dir}/playwright.json`);
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    const results = (spec.tests ?? []).flatMap((t) => t.results ?? []);
    const flaky = spec.tests?.some((t) => t.status === 'flaky');
    const status = flaky ? 'flaky' : spec.tests?.some((t) => t.status === 'skipped') && results.every((r) => r.status === 'skipped') ? 'skipped' : spec.ok ? 'passed' : 'failed';
    tests.push({ layer: 'browser', title: spec.title, file: spec.file, status, ms: results.reduce((n, r) => n + (r.duration ?? 0), 0), error: results.find((r) => r.error)?.error?.message?.split('\n')[0] ?? '' });
  }
  for (const s of suite.suites ?? []) walk(s);
};
for (const s of pw?.suites ?? []) walk(s);
const vt = read(`${dir}/vitest.json`);
for (const f of vt?.testResults ?? []) for (const a of f.assertionResults ?? []) tests.push({ layer: 'unit/integration', title: a.fullName ?? a.title, file: f.name, status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped', ms: a.duration ?? 0, error: (a.failureMessages ?? [])[0]?.split('\n')[0] ?? '' });

const count = (s) => tests.filter((t) => t.status === s).length;
const failed = tests.filter((t) => t.status === 'failed');
const lines = [`# Regression report`, '', `${new Date().toISOString()} · ${tests.length} tests: **${count('passed')} passed**, **${failed.length} failed**, ${count('flaky')} flaky (passed only on retry), ${count('skipped')} skipped`, ''];

// Known bugs and whether their guard passed.
const registry = existsSync('tests/regression/REGISTRY.md') ? readFileSync('tests/regression/REGISTRY.md', 'utf8') : '';
const bugs = [...registry.matchAll(/^\| (R-\d{3}) \| ([^|]*)\|([^|]*)\|/gm)].map((m) => ({ id: m[1], what: m[3].trim() }));
lines.push('## Known bugs: is each still guarded?', '', '| bug | what | guard |', '|---|---|---|');
for (const b of bugs) {
  const guards = tests.filter((t) => t.title.includes(`[${b.id}]`));
  const state = guards.length === 0 ? 'not run in this pass' : guards.every((g) => g.status === 'passed' || g.status === 'flaky') ? (guards.some((g) => g.status === 'flaky') ? '⚠ passed only on retry (flaky)' : '✅ passed') : guards.some((g) => g.status === 'failed') ? '❌ **FAILED: this bug is back**' : 'skipped';
  lines.push(`| ${b.id} | ${b.what.slice(0, 90)} | ${state} |`);
}

// Speed budgets.
const run = read(`${dir}/budgets-run.json`);
const budgets = read('tests/regression/budgets.json');
let over = 0;
if (run && budgets) {
  lines.push('', '## Speed (click to the page showing)', '', '| screen | ms | budget | |', '|---|---:|---:|---|');
  for (const [name, ms] of Object.entries(run.ms)) {
    const budget = budgets.steps[name] ?? budgets.default;
    const bad = ms > budget; if (bad) over += 1;
    lines.push(`| ${name} | ${ms} | ${budget} | ${bad ? '⚠ over budget' : 'ok'} |`);
  }
}
const flakyOnes = tests.filter((t) => t.status === 'flaky');
if (flakyOnes.length > 0) { lines.push('', '## Flaky this run (passed only on the retry)', ''); for (const t of flakyOnes) lines.push(`- ${t.title} (${t.file ?? ''})`); lines.push('', 'Tag a test `@flaky` in its title to take it out of the blocking checks while it is fixed (it still runs in the nightly).'); }
if (failed.length > 0) { lines.push('', '## Failures', ''); for (const t of failed) lines.push(`- **${t.title}** (${t.layer}, ${t.file ?? ''}): ${t.error}`); }
const strict = process.env.REGRESS_STRICT_BUDGETS === '1';
lines.push('', over > 0 ? `${String(over)} screen(s) over budget (${strict ? 'strict mode: counts as a failure' : 'warning only'}).` : 'All timed screens are within budget.');
writeFileSync('regression-report.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(failed.length > 0 || (strict && over > 0) ? 1 : 0);
