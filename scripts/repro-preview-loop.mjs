// Clicks "Tag many at once" -> Preview with no tag chosen N times and counts how often it fails to answer in 6 s. node scripts/repro-preview-loop.mjs [N] [base]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const N = Number(process.argv[2] ?? 30); const base = process.argv[3] ?? 'http://localhost:3101';
const b = await chromium.launch(); const page = await (await b.newContext()).newPage();
await page.goto(`${base}/login`); await page.locator('input[type="email"]').fill(env.TEST_EMAIL ?? 'e2e@test.local'); await page.locator('input[type="password"]').fill(env.TEST_PASSWORD ?? 'E2eTest!pass99');
await page.getByRole('button', { name: /sign in/i }).click(); await page.waitForURL((u) => !u.pathname.includes('login'));
let fail = 0; const detail = []; let log = [];
page.on('request', (r) => { if (r.url().includes('/contacts') && (r.method() === 'POST' || r.url().includes('_rsc'))) log.push(`REQ ${r.method()} ${r.url().slice(-38)} rsc=${r.headers()['rsc'] ?? ''} action=${r.headers()['next-action'] ? 'y' : 'n'}`); });
page.on('response', async (r) => { if (r.url().includes('_rsc') && r.url().includes('/contacts')) { const t = await r.text().catch(() => ''); log.push(`RSCBODY ${t.length}B has_msg=${t.includes('Choose a tag first')} has_bulkError=${t.includes('pick_tag')} cache=${r.headers()['x-nextjs-cache'] ?? '-'} cc=${r.headers()['cache-control'] ?? '-'}`); } if (r.url().includes('/contacts') && (r.request().method() === 'POST' || r.url().includes('_rsc'))) log.push(`RES ${r.status()} redirect=${r.headers()['x-action-redirect'] ?? '-'}`); });
for (let i = 0; i < N; i++) {
  log = [];
  await page.goto(`${base}/contacts`); if (process.argv[4] !== 'nowait') await page.waitForLoadState('networkidle');
  await page.locator('summary', { hasText: 'Tag many at once' }).click();
  if (process.argv[5] === 'withtag') await page.locator('select[name="bulkTag"]').selectOption({ index: 1 });
  if (process.argv[5] === 'notag') await page.getByLabel('Tag to apply').selectOption({ label: 'No tag' });
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  const expected = process.argv[5] === 'notag' ? page.getByText(/You chose “No tag”/) : process.argv[5] === 'withtag' ? page.getByText(/would change|No one matches|people would|would be/i).first() : page.getByText('Choose a tag first.');
  const ok = await expected.waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  if (!ok) { fail += 1; detail.push(`#${i}: url=${page.url().slice(-32)} counting=${await page.getByRole('button', { name: /Counting/ }).count()} text=${await page.getByText('Choose a tag first.').count()} | ${log.join(' ; ')}`); }
}
console.log(`${fail} of ${N} clicks got no answer in 6 s`); console.log(detail.slice(0, 6).join('\n')); await b.close();
