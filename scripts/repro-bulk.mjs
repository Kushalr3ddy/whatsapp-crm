import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const log = []; page.on('console', (m) => { if (m.type() === 'error') log.push('console: ' + m.text().slice(0, 200)); }); page.on('pageerror', (e) => log.push('pageerror: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400) log.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const t00 = Date.now(); page.on('requestfinished', async (r) => { if (r.url().includes('bulkError')) console.log(`FIN t+${((Date.now()-t00)/1000).toFixed(1)}s ${r.method()} ${r.url().slice(-45)} rsc=${r.headers()['rsc']} size=${(await r.sizes()).responseBodySize}`); });
  page.on('request', (r) => { if (r.url().includes('bulkError')) console.log(`REQ2 t+${((Date.now()-t00)/1000).toFixed(1)}s ${r.method()} ${r.url().slice(-45)} rsc=${r.headers()['rsc']}`); if (r.method() === 'POST') console.log(`REQ t+${((Date.now()-t00)/1000).toFixed(1)}s POST ${r.url().slice(-50)} ${(r.postData() || '').slice(0, 80)}`); }); page.on('response', async (r) => { if (r.request().method() === 'POST' && r.url().endsWith('/contacts')) { console.log('POST HEADERS:', JSON.stringify(r.headers()).slice(0, 700)); console.log('REQ HEADERS:', JSON.stringify(r.request().headers()).slice(0, 600)); console.log('BODY:', (await r.text().catch((e) => 'ERR ' + e.message)).slice(0, 200)); } if (r.url().includes('bulkError')) console.log(`RES2 t+${((Date.now()-t00)/1000).toFixed(1)}s ${r.status()} ${r.request().method()} ${r.url().slice(-45)} ${r.headers()['content-type']}`); if (r.request().method() === 'POST') console.log(`RES t+${((Date.now()-t00)/1000).toFixed(1)}s ${r.status()} ${r.url().slice(-50)} ${JSON.stringify(r.headers()['x-action-redirect'] ?? '')}`); });
await page.goto('http://localhost:3001/login');
await page.locator('input[type="email"]').fill(env.email); await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.includes('login'));
await page.goto('http://localhost:3001/contacts'); await page.waitForTimeout(1500);
await page.locator('summary', { hasText: 'Tag many at once' }).click();
await page.screenshot({ path: 'test-results/repro-1-open.png' });
await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
const t0 = Date.now(); let last = '';
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('form button')].find((x) => /Preview|Counting/.test(x.textContent || '')); return b ? b.textContent.trim() : 'none'; }).catch(() => 'navigating');
  const st = `${btn} | ${page.url().slice(-40)}`;
  if (st !== last) { console.log(`t+${((Date.now() - t0) / 1000).toFixed(2)}s  ${st}`); last = st; }
  if (i > 100 && /Preview \|/.test(st)) break;
}
console.log('MAIN chars at end:', await page.evaluate(() => document.querySelector('main')?.innerText.length ?? -1));
await b.close();
