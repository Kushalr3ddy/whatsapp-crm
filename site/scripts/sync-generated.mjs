// Copies the generated endpoint list (docs/generated/api-reference.md, made by `npm run api:docs` in the repo root) into this site as
// a page. Run before building so the page matches the code:   npm run sync-api
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let text = readFileSync(join(root, 'docs/generated/api-reference.md'), 'utf8');
text = text.replace(/^# .*\n+/, '')                                   // the page title comes from the front matter
  .replace(/\[`\.\.\/15-api\.md`\]\(\.\.\/15-api\.md\)/g, '[the API overview](../overview/)')
  .replace(/in `15-api\.md`/g, 'in the API overview');
const front = `---\ntitle: Endpoint reference\ndescription: Every endpoint of the API, who may call it, and what it does. Generated from the code.\n---\n\n`;
const out = join(root, 'site/src/content/docs/api/endpoints.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, front + text);
console.log('wrote', out);
