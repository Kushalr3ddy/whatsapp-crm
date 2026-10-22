// Turns a tester's feedback file into GitHub issues, one per "## issue-N: title" section.
//   npm run feedback:import -- dev-feedback-prod-issues.md --batch 2026-10-22-prod            (dry run: prints what it would create)
//   npm run feedback:import -- dev-feedback-prod-issues.md --batch 2026-10-22-prod --apply    (creates them)
// The same item is never created twice (a hidden marker in the issue body identifies batch + item number).
// PRIVACY: this repository is public. Phone numbers and e-mail addresses are masked in the issue text, and screenshots are NEVER uploaded or committed:
// the issue only names the local file. Names can still appear in the tester's own words: READ the dry run before using --apply.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !(args[args.indexOf(a) - 1] ?? '').startsWith('--'));
const flag = (name, fb) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fb; };
if (!file) { console.error('usage: npm run feedback:import -- <feedback.md> [--batch name] [--reporter Name] [--redact "word,word"] [--apply]'); process.exit(2); }
const batch = flag('batch', basename(file, '.md'));
const reporter = flag('reporter', 'a tester');
const apply = args.includes('--apply');
// Words to blank out as well (a contact's name, say): --redact "priya sharma,shivaraman"
const redact = flag('redact', '').split(',').map((w) => w.trim()).filter(Boolean);

/** Masks phone numbers and e-mail addresses. */
const mask = (t) => redact.reduce((acc, w) => acc.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[name]'), t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\+?\d[\d ()-]{7,}\d/g, '[number]'));
/** Splits the file into items. */
const text = readFileSync(file, 'utf8');
const parts = text.split(/^(?=## issue-\d+:)/m).filter((p) => /^## issue-\d+:/.test(p));
if (parts.length === 0) { console.error('no "## issue-N: title" sections found in that file'); process.exit(2); }

const items = parts.map((p) => {
  const [, n, title] = /^## issue-(\d+):\s*(.+)$/m.exec(p);
  const shots = [...p.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => basename(m[1]));
  const original = (/\*\*Original text[^*]*\*\*\s*([\s\S]*?)(?=\*\*Summary)/.exec(p)?.[1] ?? '').split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, '')).join('\n').trim();
  const summary = (/\*\*Summary:\*\*\s*([\s\S]*?)(?=\n---|\n## |$)/.exec(p)?.[1] ?? '').trim();
  return { n: Number(n), title: title.replace(/^[A-Za-z ]+:\s*/, (m) => m).trim(), shots, original: mask(original), summary: mask(summary) };
});

let existing = [];
if (apply) {
  try { existing = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'alpha-feedback', '--state', 'all', '--limit', '300', '--json', 'number,body'], { encoding: 'utf8' })); }
  catch { console.error('could not list existing issues (is `gh` signed in?)'); process.exit(3); }
}
let made = 0;
for (const it of items) {
  const marker = `<!-- feedback:${batch}#${String(it.n)} -->`;
  const body = [
    marker,
    `**Reported by ${reporter}** · feedback batch \`${batch}\`, item ${String(it.n)}`,
    '',
    '### In their words',
    it.original === '' ? '_(none)_' : it.original.split('\n').map((l) => `> ${l}`).join('\n'),
    '',
    '### What it means',
    it.summary === '' ? '_(to be written at triage)_' : it.summary,
    '',
    it.shots.length > 0 ? `### Screenshots\nKept locally, **not committed** (the repository is public): ${it.shots.map((s) => `\`${s}\``).join(', ')}` : '',
    '',
    '_Triage next: add a severity (S1 to S4) and an `area:` label; then `npm run bug -- "<title>" --issue <this number>` once it is reproduced._'
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  if (!apply) { console.log(`\n--- would create: ${it.title}\n${body}\n`); continue; }
  if (existing.some((e) => (e.body ?? '').includes(marker))) { console.log(`  = item ${String(it.n)} already has an issue: ${it.title}`); continue; }
  const url = execFileSync('gh', ['issue', 'create', '--title', it.title, '--body', body, '--label', 'bug,alpha-feedback,needs-triage'], { encoding: 'utf8' }).trim();
  console.log(`  + ${url}  (${it.title})`); made += 1;
}
console.log(apply ? `\n${String(made)} issue(s) created, ${String(items.length - made)} already existed.` : `\nDry run: ${String(items.length)} item(s) found. Nothing was created. Add --apply after reading the text above.`);
