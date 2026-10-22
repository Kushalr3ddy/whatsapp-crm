/**
 * Turns the testers' Google Doc into a markdown file the importer reads (D-92).
 *
 *   npm run feedback:gdoc -- <doc link or id> --out dev-feedback-gdoc.md [--reporter Mikhil]
 *   npm run feedback:gdoc -- --file saved-doc.txt --out dev-feedback-gdoc.md     (a doc you saved as text)
 *
 * Then: npm run feedback:import -- dev-feedback-gdoc.md --batch gdoc-<name> --reporter Mikhil           (dry run), add --apply to create the issues.
 * Reading a private doc needs GOOGLE_SERVICE_ACCOUNT_JSON (and the doc shared with that account); a link-shared doc needs nothing.
 * Screenshots are never downloaded: the doc is private and this repository is public.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { docIdFrom, fetchDocText, splitProblems, toImporterMarkdown } from './lib/gdoc.js';

/** Reads `--name value` from the arguments. */
function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Runs the conversion. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = flag(args, 'file');
  const out = flag(args, 'out') ?? 'dev-feedback-gdoc.md';
  const reporter = flag(args, 'reporter') ?? 'a tester';
  const target = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
  if (file === undefined && target === undefined) {
    process.stderr.write('usage: npm run feedback:gdoc -- <doc link or id> --out file.md [--reporter Name]   or   --file saved.txt\n');
    process.exit(2);
  }
  const docId = target !== undefined ? docIdFrom(target) : 'saved-file-0000000000';
  const text = file !== undefined ? readFileSync(file, 'utf8') : await fetchDocText(docId);
  const items = splitProblems(text);
  if (items.length === 0) { process.stderr.write('no problems found: a problem starts at a heading or a numbered line (1. 2. 3.)\n'); process.exit(1); }
  writeFileSync(out, toImporterMarkdown(items, { reporter, docId, date: new Date().toISOString().slice(0, 10) }));
  process.stdout.write(`${out}: ${String(items.length)} problem(s), ${String(items.reduce((n, i) => n + i.images, 0))} screenshot marker(s)\n${items.map((i) => `  ${String(i.n)}. ${i.title}`).join('\n')}\n`);
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
