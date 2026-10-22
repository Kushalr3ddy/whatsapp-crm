// The bug-fix gate: a pull request that fixes a bug must add (or change) a test carrying that bug's [R-nnn] tag, and the bug must be `guarded`.
//   BRANCH=fix/R-012-x LABELS='["bug"]' node tests/regression/bug-gate.mjs <base ref>
// It applies to a branch named `fix/…` or a PR labelled `bug`. Escape hatch for a fix that genuinely cannot have a test (say, a copy change): label the PR
// `no-regression-test` and say why in the description. Everything else is held to the rule.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
const branch = process.env.BRANCH ?? '';
const labels = JSON.parse(process.env.LABELS ?? '[]');
const isFix = branch.startsWith('fix/') || labels.includes('bug');
if (!isFix) { console.log('Not a bug-fix PR (branch is not fix/… and no `bug` label): nothing to check.'); process.exit(0); }
if (labels.includes('no-regression-test')) { console.log('Label `no-regression-test` is set: the author says this fix cannot have a test. Make sure the description says why.'); process.exit(0); }

const ids = execFileSync('node', ['tests/regression/changed-ids.mjs', base, 'HEAD', '--tests-only'], { encoding: 'utf8' }).trim().split(',').filter(Boolean);
const registry = readFileSync('tests/regression/REGISTRY.md', 'utf8');
const problems = [];
if (ids.length === 0) problems.push('this is a bug-fix PR but no test with an [R-nnn] tag in its title was added or changed. Run `npm run bug -- "what broke" --issue N`, make the test fail for the right reason, then fix the code (see tests/regression/README.md). If it truly cannot have a test, add the label `no-regression-test` and explain why in the description.');
for (const id of ids) {
  const row = new RegExp(`^\\| ${id} \\|(?:[^|]*\\|){4} ([a-z]+) \\|`, 'm').exec(registry);
  if (!row) problems.push(`${id} is tagged in a test but has no row in tests/regression/REGISTRY.md.`);
  else if (row[1] !== 'guarded') problems.push(`${id} has a test but its registry row is "${row[1]}": set it to "guarded" and fill in the PR number in the Fix column.`);
}
if (problems.length > 0) { console.error('\nBug-fix gate failed:\n' + problems.map((p) => `  ✗ ${p}`).join('\n') + '\n'); process.exit(1); }
console.log(`Bug-fix gate passed: ${ids.join(', ')} guarded by a test in this PR.`);
