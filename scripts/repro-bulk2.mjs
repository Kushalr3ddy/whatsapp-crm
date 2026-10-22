import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const log = []; page.on('console', (m) => { if (m.type() === 'error') log.push('console: ' + m.text().slice(0, 200)); }); page.on('pageerror', (e) => log.push('pageerror: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400) log.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
await page.goto('http://localhost:3001/login');
await page.locator('input[type="email"]').fill(env.email); await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.includes('login'));
for (const q of ['bulkError=pick_tag', 'bulkError=no_tag', 'bulkTag=x&bulkAction=add&bulkScope=matching&bulkCount=3']) {
  log.length = 0;
  const r = await page.goto('http://localhost:3001/contacts?' + q); await page.waitForTimeout(1500);
  console.log(q, '| status', r?.status(), '| main chars', (await page.locator('main').innerText().catch(() => '')).length, '| body chars', (await page.locator('body').innerText()).length, '|', log.join(' ; ').slice(0, 300));
}
await b.close();
