// Writes docs/generated/api-reference.md: every HTTP endpoint of the API, read from the route files, so the list cannot drift from the code.
//
//   npm run api:docs
//
// For each route: the method, the full path (the router's mount point from apps/api/src/app.ts plus the route's own path), who may call it
// (`requireScope('x')` = a signed-in person or an API key with that scope, `requireRole('admin')` = admins only, otherwise any signed-in
// person), and the first sentence of the comment written above it. Request and response shapes live in docs/15-api.md and in the code.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'apps/api/src');
const app = readFileSync(join(src, 'app.ts'), 'utf8');

// Mount points: api.use('/ai', aiRouter(...)) -> aiRouter is mounted at /api/v1/ai; messagesRouter is mounted at '/'.
const mounts = new Map();
for (const m of app.matchAll(/api\.use\(\s*'([^']+)'\s*,\s*(\w+)\(/g)) mounts.set(m[2], m[1] === '/' ? '' : m[1]);
// Which router function lives in which file.
const files = readdirSync(join(src, 'routes')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const rows = [];
for (const f of files) {
  const text = readFileSync(join(src, 'routes', f), 'utf8');
  const fn = text.match(/export function (\w+Router)\(/)?.[1];
  const prefix = fn !== undefined && mounts.has(fn) ? mounts.get(fn) : '';
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/\b(?:router)\.(get|post|put|patch|delete)\(\s*'([^']*)'/);
    if (!m) return;
    // The call spans a few lines (middleware, then the handler): read until the handler's arrow function starts.
    const call = lines.slice(i, i + 4).join(' ');
    const head = call.split('=>')[0] ?? call;
    const scope = head.match(/requireScope\('([^']+)'\)/)?.[1];
    const role = head.match(/requireRole\(([^)]*)\)/)?.[1]?.replace(/['\s]/g, '');
    const open = f === 'auth.ts' && /'\/(login|bootstrap)'/.test(call);
    const who = open ? 'nobody (open)' : role !== undefined ? `role: ${role}` : scope !== undefined ? `scope: ${scope}` : 'signed in';
    // The comment block directly above (JSDoc or // lines), first sentence.
    let j = i - 1; const doc = [];
    while (j >= 0 && /^\s*(\*|\/\*\*|\/\/|\*\/)/.test(lines[j] ?? '')) { doc.unshift((lines[j] ?? '').replace(/^\s*(\/\*\*|\*\/|\*|\/\/)\s?/, '')); j--; }
    const text1 = doc.join(' ').replace(/\s+/g, ' ').trim();
    const first = (text1.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? text1).slice(0, 220);
    rows.push({ group: f.replace('.ts', ''), method: m[1].toUpperCase(), path: `/api/v1${prefix}${m[2] === '/' ? '' : m[2]}`.replace(/\/$/, '') || '/api/v1', who, first });
  });
}
// Routes mounted straight in app.ts.
for (const m of app.matchAll(/app\.(get|post)\('([^']+)'/g)) {
  if (m[2].startsWith('/api/v1/') && /express\.raw/.test(app.slice(m.index ?? 0, (m.index ?? 0) + 160))) continue; // body parsers, not routes
  rows.push({ group: 'app', method: m[1].toUpperCase(), path: m[2], who: m[2] === '/health' || m[2] === '/ready' ? 'nobody (open)' : 'signed in', first: m[2] === '/health' ? 'Liveness: the process is up.' : m[2] === '/ready' ? 'Readiness: the database answers.' : '' });
}
// Two uploads are routed by the messages/campaign routers but need a raw body parser registered in app.ts.
rows.sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const by = new Map();
for (const r of rows) by.set(r.group, [...(by.get(r.group) ?? []), r]);
const stamp = new Date().toISOString().slice(0, 10);
let md = `# API reference (generated)\n\nGenerated from the route files on ${stamp} by \`npm run api:docs\`. **Do not edit by hand**; change the route or its comment and regenerate.\n`;
md += `For how to sign in, errors, rate limits and examples see [\`../15-api.md\`](../15-api.md).\n\n**${rows.length} endpoints.** "Who" is \`scope: x\` (a signed-in person or an API key holding scope x), \`role: admin\` (admins only), or \`signed in\` (any signed-in person); every route except \`/health\`, \`/ready\` and \`/api/v1/auth/*\` needs one of them, and every write from a browser session also needs the CSRF header.\n`;
md += `Paths with \`:id\` take a UUID. A route's request body and response are described by the code beside it (zod schemas) and, for the main ones, in \`15-api.md\`.\n\n`;
md += `| Group | Endpoints |\n|---|---|\n` + [...by].map(([g, r]) => `| [${g}](#${g}) | ${r.length} |`).join('\n') + '\n\n';
for (const [g, r] of by) {
  md += `## ${g}\n\n| Method | Path | Who | What it does |\n|---|---|---|---|\n`;
  for (const x of r) md += `| ${x.method} | \`${x.path}\` | ${x.who} | ${x.first.replace(/\|/g, '\\|') || ' '} |\n`;
  md += '\n';
}
writeFileSync(join(root, 'docs/generated/api-reference.md'), md);
console.log(`wrote docs/generated/api-reference.md: ${rows.length} endpoints in ${by.size} groups`);
