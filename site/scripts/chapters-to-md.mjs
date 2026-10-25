// One-off helper: turns the chapters of the user tutorial (scripts/build-tutorial.mjs) into Markdown pages for this site.
//   node scripts/chapters-to-md.mjs
// The tutorial PDF and these pages started from the same words. After this runs, the Markdown pages are edited by hand and are the
// ones to keep up to date; run it again only on an empty folder, because it overwrites.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const src = readFileSync(join(root, 'scripts/build-tutorial.mjs'), 'utf8');
const body = src.slice(src.indexOf('const tip ='), src.indexOf('const css = `'));

// Tutorial helpers, re-created to emit plain HTML the converter understands (the originals read screenshots from disk).
const prelude = `
const chapters = [];
const fig = (file, caption) => '<figure><img data-file="' + file + '" alt="' + caption + '"></figure>';
`;
const tmp = join(here, '.chapters.tmp.mjs');
writeFileSync(tmp, prelude + body.replace("const chapters = [];", '') + '\nexport { chapters };\n');
const { chapters } = await import(pathToFileURL(tmp).href);
rmSync(tmp);

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
td.use(gfm);
td.addRule('figure', { filter: 'figure', replacement: (_c, node) => {
  const img = node.querySelector('img');
  return `\n\n![${img.getAttribute('alt')}](../../../assets/shots/${img.getAttribute('data-file')}.png)\n\n`;
} });
td.addRule('box', { filter: (n) => n.nodeName === 'DIV' && n.classList.contains('box'), replacement: (c, node) => {
  const kind = node.classList.contains('care') ? 'caution' : 'tip';
  const text = c.replace(/^\s*\*\*(Tip|Careful)\*\*\s*/, '').trim();
  return `\n\n:::${kind}\n${text}\n:::\n\n`;
} });
td.addRule('tag', { filter: (n) => n.nodeName === 'SPAN' && n.classList.contains('tag'), replacement: () => '*(admin only)*' });
td.addRule('markers', { filter: (n) => n.nodeName === 'OL' && n.classList.contains('markers'), replacement: (_c, node) =>
  '\n\n' + [...node.querySelectorAll(':scope > li')].map((li) => `${li.getAttribute('value')}. ${td.turndown(li.innerHTML).replace(/\n+/g, ' ')}`).join('\n') + '\n\n' });

// chapter title -> [folder/slug, page title]
const map = {
  'Before you start': ['start/what-is-it', 'What this is'],
  'Signing in and finding your way around': ['start/sign-in', 'Sign in and find your way'],
  'Overview: your day at a glance': ['start/overview', 'Overview page'],
  'Linked numbers: connecting WhatsApp': ['setup/link-a-number', 'Link a WhatsApp number'],
  'Importing contacts': ['guides/import', 'Import contacts'],
  'Contacts: your contact book': ['guides/contacts', 'Contacts'],
  'Inbox: answering customers': ['guides/inbox', 'Inbox'],
  'Campaigns: sending to many people': ['guides/campaigns', 'Campaigns'],
  'Team': ['guides/team', 'Team and roles'],
  'The AI assistant': ['guides/ai-assistant', 'The AI assistant'],
  'Security: encryption keys': ['guides/security', 'Security: encryption keys'],
  'Safety rules in plain words': ['concepts/safety', 'Safety rules in plain words'],
  'Troubleshooting and common questions': ['help/troubleshooting', 'Troubleshooting and FAQ'],
  'Glossary': ['help/glossary', 'Glossary']
};
const out = join(root, 'site/src/content/docs');
for (const [, title, html] of chapters) {
  const m = map[title];
  if (!m) { console.log('skipped', title); continue; }
  const md = td.turndown(html.replace(/<h3>/g, '<h2>').replace(/<\/h3>/g, '</h2>')).replace(/\n{3,}/g, '\n\n').trim();
  const first = (md.split('\n').find((l) => l.trim() !== '' && !l.startsWith('!') && !l.startsWith('#') && !l.startsWith(':')) ?? title)
    .replace(/[*_`\[\]]/g, '').replace(/\(.*?\)/g, '').trim().slice(0, 160);
  const file = join(out, `${m[0]}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\ntitle: ${JSON.stringify(m[1])}\ndescription: ${JSON.stringify(first)}\n---\n\n${md}\n`);
  console.log('wrote', m[0]);
}
