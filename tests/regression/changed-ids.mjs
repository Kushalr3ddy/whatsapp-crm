// Which regression bugs does this change touch?   node tests/regression/changed-ids.mjs <base ref> [head ref]
// Reads the diff between the two refs and prints, comma separated, every R-number that
//   - appears in the TITLE of a test line that was added or changed ([R-012] in test('…'), it('…'), describe('…')), or
//   - is on a registry row that was added or changed.
// Used by the bug-fix gate (a fix must add or change a tagged test) and by the production-build run for the PR's own R-numbers.
import { execFileSync } from 'node:child_process';

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base) { console.error('usage: changed-ids.mjs <base ref> [head ref]'); process.exit(2); }
const diff = execFileSync('git', ['diff', '-U0', `${base}...${head}`, '--', 'tests', 'packages', 'apps'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const inTests = new Set(); const inRegistry = new Set();
let file = '';
for (const line of diff.split('\n')) {
  const f = /^\+\+\+ b\/(.+)$/.exec(line); if (f) { file = f[1]; continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (file === 'tests/regression/REGISTRY.md') { const m = /^\+\| (R-\d{3}) \|/.exec(line); if (m) inRegistry.add(m[1]); continue; }
  if (/\.(test|spec)\.ts$/.test(file)) { const m = /(?:test|it|describe)(?:\.[a-z]+)?\(\s*['"`][^'"`]*\[(R-\d{3})\]/.exec(line); if (m) inTests.add(m[1]); }
}
if (process.argv.includes('--tests-only')) console.log([...inTests].sort().join(','));
else console.log([...new Set([...inTests, ...inRegistry])].sort().join(','));
