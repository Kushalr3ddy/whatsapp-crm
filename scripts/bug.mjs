// Reports a bug into the regression registry and scaffolds its test:
//   npm run bug -- "Create draft hangs in production" --found "Mikhil, prod" --layer e2e --area broadcast
// Adds the next R-nnn row (status open) to tests/regression/REGISTRY.md and writes a stub test that is skipped (`fixme`) until you fill
// in the steps. The workflow: report -> write the failing test (remove `fixme`) -> fix the code -> mark the row `guarded` with the PR.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const title = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!title) { console.error('usage: npm run bug -- "what broke, in plain words" [--found "who/where"] [--layer e2e|integration] [--area name]'); process.exit(2); }
const layer = flag('layer', 'e2e'); const found = flag('found', 'unknown'); const area = flag('area', 'general');
if (!['e2e', 'integration'].includes(layer)) { console.error('--layer must be e2e or integration'); process.exit(2); }

const regPath = 'tests/regression/REGISTRY.md';
const reg = readFileSync(regPath, 'utf8');
const last = Math.max(0, ...[...reg.matchAll(/^\| R-(\d{3}) \|/gm)].map((m) => Number(m[1])));
const id = `R-${String(last + 1).padStart(3, '0')}`;
const date = new Date().toISOString().slice(0, 10);
const row = `| ${id} | ${date} | ${title.replace(/\|/g, '/')} | ${found.replace(/\|/g, '/')} | ${layer} | open | |\n`;
writeFileSync(regPath, reg.replace(/\n*$/, '\n') + row);

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
mkdirSync('tests/regression/bugs', { recursive: true });
const file = layer === 'e2e' ? `tests/e2e/regression-${id.toLowerCase()}-${slug}.spec.ts` : `tests/integration/regression-${id.toLowerCase()}-${slug}.test.ts`;
if (!existsSync(file)) {
  writeFileSync(file, layer === 'e2e'
? `import { test, expect } from '@playwright/test';
import { CREDS_MISSING, signIn } from './helpers';

/**
 * ${id} (${date}, area: ${area}, found by: ${found})
 * What broke: ${title}
 *
 * Steps to reproduce: <fill in: what you click, what you expected, what happened>
 * Add @smoke to the title if this must also run on a production build in CI.
 */
test.skip(CREDS_MISSING, 'TEST_EMAIL / TEST_PASSWORD are not set');

// Remove \`.fixme\` once the steps below fail for the right reason, then fix the code and watch it go green.
test.fixme('[${id}] ${title.replace(/'/g, "\\'")}', async ({ page }) => {
  await signIn(page);
  // 1. go to the screen   2. do the thing   3. expect what should happen
  await expect(page).toHaveURL(/./);
});
`
: `import { describe, it } from 'vitest';

/**
 * ${id} (${date}, area: ${area}, found by: ${found})
 * What broke: ${title}
 * Model it on a neighbouring file in tests/integration (database set-up, API key, request helpers).
 */
describe('${id}', () => {
  // Change \`it.todo\` to \`it\` once the steps fail for the right reason, then fix the code and watch it go green.
  it.todo('[${id}] ${title.replace(/'/g, "\\'")}');
});
`);
}
console.log(`${id} added to ${regPath}\n  test stub: ${file}\n\nNext: 1) write the failing test  2) fix the code  3) set the row to "guarded" and fill in the PR.`);
