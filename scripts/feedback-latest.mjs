// Picks up the file the browser tool saved to your Downloads folder and shows (or creates) the GitHub issues for it.
//   npm run feedback:latest                 shows what it would create (a dry run, nothing is created)
//   npm run feedback:latest -- --apply      creates the issues (never twice for the same problem)
//   npm run feedback:latest -- --file ~/Downloads/feedback-12Y8laRC.md --apply
// The browser tool is tools/feedback-doc-reader.js (paste into the console on the Google Doc's tab) or the bookmark in
// tools/feedback-doc-bookmarklet.txt; see docs/40. Reporter and batch come from the file itself.
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
let file = flag('file');
if (file === undefined) {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'downloads')].filter(existsSync);
  const found = dirs.flatMap((d) => readdirSync(d).filter((f) => /^feedback-[\w-]+\.md$/.test(f)).map((f) => join(d, f)))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  file = found[0];
}
if (file === undefined || !existsSync(file)) {
  console.error('No feedback-*.md file found in ~/Downloads. In the Google Doc tab, run the browser tool first (see docs/40), or pass --file <path>.');
  process.exit(1);
}
const text = readFileSync(file, 'utf8');
const reporter = /^# Feedback from (.+?):/m.exec(text)?.[1] ?? 'a tester';
const id8 = /feedback-([\w-]{8})/.exec(file)?.[1] ?? 'doc';
const local = `dev-feedback-gdoc-${id8}.md`;   // git-ignored (dev-feedback-*): the tester's words must not be committed
copyFileSync(file, local);
console.log(`using ${file} (reporter: ${reporter}) -> ${local}`);
const run = spawnSync(process.execPath, ['scripts/feedback-import.mjs', local, '--batch', `gdoc-${id8}`, '--reporter', reporter, ...(args.includes('--apply') ? ['--apply'] : [])], { stdio: 'inherit' });
process.exit(run.status ?? 1);
