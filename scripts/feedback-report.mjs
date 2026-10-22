// Builds the triage document for a feedback batch from GitHub and the regression registry (nothing is typed by hand):
//   npm run feedback:report -- --batch 2026-10-22-prod        writes docs/feedback/2026-10-22-prod.md
// One row per issue: severity, area, status (reported / triaged / reproduced / fixed / verified), R-number, PR, and the regression guard.
// Status is read from the issue: open + needs-triage = reported; has S-label = triaged; has an R-number in the registry = reproduced; closed (or its
// R-number is guarded) = fixed; label `verified` = verified. Needs `gh` signed in. Titles and statuses only: no tester text, no screenshots.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fb) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fb; };
const batch = flag('batch', '');
if (batch === '') { console.error('usage: npm run feedback:report -- --batch <name>'); process.exit(2); }

const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'alpha-feedback', '--state', 'all', '--limit', '300',
  '--json', 'number,title,state,labels,body,url,closedByPullRequestsReferences'], { encoding: 'utf8' }))
  .filter((i) => (i.body ?? '').includes(`<!-- feedback:${batch}#`))
  .map((i) => ({ ...i, item: Number(/<!-- feedback:[^#]+#(\d+) -->/.exec(i.body)?.[1] ?? 0) }))
  .sort((a, b) => a.item - b.item);
if (issues.length === 0) { console.error(`no issues carry the batch marker "${batch}". Did you run feedback:import --apply?`); process.exit(3); }

const registry = existsSync('tests/regression/REGISTRY.md') ? readFileSync('tests/regression/REGISTRY.md', 'utf8') : '';
const rows = [...registry.matchAll(/^\| (R-\d{3}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| ([a-z]+) \|([^|]*)\|([^|]*)\|/gm)]
  .map((m) => ({ id: m[1], status: m[6].trim(), fix: m[7].trim(), issue: Number(/#(\d+)/.exec(m[8])?.[1] ?? 0) }));

const sev = (i) => i.labels.map((l) => l.name).find((n) => /^S[1-4]$/.test(n)) ?? '–';
const area = (i) => i.labels.map((l) => l.name).filter((n) => n.startsWith('area:')).map((n) => n.slice(5)).join(', ') || '–';
const out = [];
const stats = { reported: 0, triaged: 0, reproduced: 0, fixed: 0, verified: 0 };
const table = issues.map((i) => {
  const names = i.labels.map((l) => l.name);
  const r = rows.find((x) => x.issue === i.number);
  const prs = (i.closedByPullRequestsReferences ?? []).map((p) => `#${p.number}`);
  if (r?.fix) for (const f of r.fix.match(/#\d+/g) ?? []) if (!prs.includes(f)) prs.push(f);
  let status = names.includes('verified') ? 'verified' : (i.state === 'CLOSED' || r?.status === 'guarded') ? 'fixed' : r ? 'reproduced' : sev(i) !== '–' ? 'triaged' : 'reported';
  stats[status] += 1;
  return `| ${i.item} | [#${i.number}](${i.url}) ${i.title.replace(/\|/g, '/')} | ${sev(i)} | ${area(i)} | ${status} | ${r ? r.id : '–'} | ${prs.join(', ') || '–'} | ${r ? (r.status === 'guarded' ? '✅ test guards it' : r.status) : '–'} |`;
});
out.push(`# Feedback batch \`${batch}\``, '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run feedback:report\` from GitHub issues and \`tests/regression/REGISTRY.md\`. Do not edit by hand; titles and statuses only (the testers' own words and screenshots stay in the issues and locally).`, '',
  `**${issues.length} items:** ${stats.reported} reported · ${stats.triaged} triaged · ${stats.reproduced} reproduced · ${stats.fixed} fixed · ${stats.verified} verified`, '',
  '| # | Issue | Sev | Area | Status | R-number | PR | Regression guard |', '|---|---|---|---|---|---|---|---|', ...table, '',
  '**Status legend:** reported (nobody has looked) → triaged (severity set) → reproduced (R-number and a failing test) → fixed (merged) → verified (the reporter confirmed).');
mkdirSync('docs/feedback', { recursive: true });
writeFileSync(`docs/feedback/${batch}.md`, out.join('\n') + '\n');
console.log(`docs/feedback/${batch}.md written: ${issues.length} items (${Object.entries(stats).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')})`);
