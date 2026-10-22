// Samples this machine once a second while a live session runs, so slow steps can be matched to what the computer was doing.
//   node tests/live/resmon.mjs <output.csv>        (stop it with Ctrl-C or SIGTERM)
// Columns: epoch ms, cpu %, load1, memory used MB, memory available MB, swap used MB, then resident MB and cpu % for each part of the stack.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (out === undefined) throw new Error('usage: node resmon.mjs <output.csv>');
const PARTS = { web: /next-server|next\/dist\/bin\/next/, api: /apps\/api\/src\/server/, gateway: /apps\/gateway\/src/, postgres: /postgres:/, chromium: /chrom(e|ium)/i, claude: /claude/i };
writeFileSync(out, ['epoch_ms', 'cpu_pct', 'load1', 'mem_used_mb', 'mem_avail_mb', 'swap_used_mb', ...Object.keys(PARTS).flatMap((p) => [`${p}_rss_mb`, `${p}_cpu_pct`])].join(',') + '\n');

let last = null;
/** Total and idle CPU ticks from /proc/stat. */
function ticks() {
  const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  return { idle: f[3] + f[4], total: f.reduce((a, b) => a + b, 0) };
}
function sample() {
  const now = ticks();
  const cpu = last === null ? 0 : (1 - (now.idle - last.idle) / Math.max(1, now.total - last.total)) * 100;
  last = now;
  const mem = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => [l.split(':')[0], parseInt(l.split(':')[1], 10) / 1024]));
  const parts = Object.fromEntries(Object.keys(PARTS).map((p) => [p, { rss: 0, cpu: 0 }]));
  for (const line of execFileSync('ps', ['-eo', 'rss,pcpu,args', '--no-headers'], { encoding: 'utf8' }).split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    for (const [p, re] of Object.entries(PARTS)) if (re.test(m[3]) && !/resmon|ps -eo/.test(m[3])) { parts[p].rss += Number(m[1]) / 1024; parts[p].cpu += Number(m[2]); }
  }
  const row = [Date.now(), cpu.toFixed(1), readFileSync('/proc/loadavg', 'utf8').split(' ')[0], (mem.MemTotal - mem.MemAvailable).toFixed(0), mem.MemAvailable.toFixed(0), (mem.SwapTotal - mem.SwapFree).toFixed(0),
    ...Object.keys(PARTS).flatMap((p) => [parts[p].rss.toFixed(0), parts[p].cpu.toFixed(1)])];
  appendFileSync(out, row.join(',') + '\n');
}
sample();
const timer = setInterval(sample, 1000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(timer); process.exit(0); });
