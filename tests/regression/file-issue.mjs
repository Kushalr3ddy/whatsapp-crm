// Opens, updates or closes ONE GitHub issue per title, so a nightly problem does not create a new issue every night.
//   node tests/regression/file-issue.mjs --title "Nightly regression failed" --label regression-nightly --body-file regression-report.md     (open or add a comment)
//   node tests/regression/file-issue.mjs --title "Nightly regression failed" --label regression-nightly --close "Green again."                 (comment and close if open)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const title = flag('title'); const label = flag('label') ?? 'bug'; const bodyFile = flag('body-file'); const closeNote = flag('close');
if (!title) { console.error('usage: file-issue.mjs --title T [--label L] (--body-file F | --close "note")'); process.exit(2); }
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const open = JSON.parse(gh('issue', 'list', '--state', 'open', '--label', label, '--limit', '50', '--json', 'number,title')).find((i) => i.title === title);
if (closeNote !== undefined) {
  if (open) { gh('issue', 'comment', String(open.number), '--body', closeNote); gh('issue', 'close', String(open.number), '--reason', 'completed'); console.log(`closed #${open.number}`); }
  else console.log('nothing open to close');
  process.exit(0);
}
const body = bodyFile ? readFileSync(bodyFile, 'utf8') : '(no report attached)';
if (open) { gh('issue', 'comment', String(open.number), '--body', body); console.log(`commented on #${open.number}`); }
else console.log(gh('issue', 'create', '--title', title, '--label', label, '--body', body));
