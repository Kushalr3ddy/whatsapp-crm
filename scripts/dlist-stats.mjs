// Counts the pins in docs/21-deferred.md by status and writes the totals into the block between
// <!-- stats:start --> and <!-- stats:end --> at the top of that file.   npm run dlist:stats
// A pin's status is the last cell of its row in the "Status at a glance" table:
//   starts with ✅ = done · contains ◐ = partly built · ▶ = being worked on · 🔺 = priority · ⏸ = parked · anything else = not started.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'docs/21-deferred.md');
const text = readFileSync(file, 'utf8');
const rows = [...text.matchAll(/^\| \[(D-\w+)\]\([^)]*\) \| (.*) \| ([^|]*) \|$/gm)].map((m) => ({ id: m[1], what: m[2], status: m[3].trim() }));
const done = rows.filter((r) => r.status.startsWith('✅'));
const rest = rows.filter((r) => !r.status.startsWith('✅'));
const partly = rest.filter((r) => r.status.includes('◐'));
const notStarted = rest.filter((r) => !r.status.includes('◐'));
const later = notStarted.filter((r) => /not required|duplicate|later/i.test(r.status + r.what) && !r.status.includes('🔺'));
const priority = rest.filter((r) => r.status.includes('🔺'));
const working = rest.filter((r) => r.status.includes('▶'));
const parked = rest.filter((r) => r.status.includes('⏸'));
const pct = (n) => `${Math.round((n / rows.length) * 100)}%`;
const ids = (list) => list.map((r) => r.id).join(', ');
const stamp = new Date().toISOString().slice(0, 10);

const block = `<!-- stats:start -->
**Scoreboard (${stamp}, \`npm run dlist:stats\`): ${rows.length} live pins** (struck-out pins such as D-2, D-12 and D-16 belong to another project and are not counted).

| | Pins | Share |
|---|---|---|
| ✅ **Done** | **${done.length}** | ${pct(done.length)} |
| ◐ **Partly built** | **${partly.length}** | ${pct(partly.length)} |
| 📌 **Not started** (pinned) | **${notStarted.length}** | ${pct(notStarted.length)} |
| **Remaining** (partly built + not started) | **${rest.length}** | ${pct(rest.length)} |

Overlapping flags (a pin can be in a row above and one of these): 🔺 **priority ${priority.length}** (${ids(priority)}) · ▶ **being worked on ${working.length}** (${ids(working)}) · ⏸ **parked ${parked.length}** (${ids(parked)}).
<!-- stats:end -->`;

let out;
if (text.includes('<!-- stats:start -->')) out = text.replace(/<!-- stats:start -->[\s\S]*?<!-- stats:end -->/, block);
else out = text.replace('## Status at a glance', `## Status at a glance`).replace(/(## Status at a glance[^\n]*\n\n)/, `$1${block}\n\n`);
writeFileSync(file, out);
console.log(`done ${done.length} · partly ${partly.length} · not started ${notStarted.length} · total ${rows.length} (priority ${priority.length}, working ${working.length}, parked ${parked.length}, closed-as-later ${later.length})`);
