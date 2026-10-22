// Measures the Contacts page: size, element counts, and the time from click to a loaded page. Usage: node scripts/measure-contacts.mjs [path]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const base = 'http://localhost:3001';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
await page.goto(`${base}/login`); await page.locator('input[type="email"]').fill(env.email); await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.includes('login'));
const path = process.argv[2] ?? '/contacts';
const times = []; let html = '';
for (let i = 0; i < 5; i++) { const t = Date.now(); const r = await page.request.get(base + path); html = await r.text(); times.push(Date.now() - t); }
const count = (re) => (html.match(re) ?? []).length;
console.log(`${path}: ${(html.length / 1024).toFixed(0)} KB html; server render (5 runs) ms: ${times.join(', ')}`);
console.log(`  <form ${count(/<form/g)}  <input ${count(/<input/g)}  <option ${count(/<option/g)}  <details ${count(/<details/g)}  <button ${count(/<button/g)}  <li ${count(/<li/g)}`);
const rsc = (html.match(/self\.__next_f\.push\(\[1,"(?:[^"\\]|\\.)*"\]\)/g) ?? []).reduce((n, s) => n + s.length, 0);
console.log(`  RSC payload inside the html: ${(rsc / 1024).toFixed(0)} KB (${((rsc / html.length) * 100).toFixed(0)}%)`);
const t = Date.now(); await page.goto(base + path, { waitUntil: 'load' }); const nav = Date.now() - t;
const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
console.log(`  full browser load ${nav} ms; DOM nodes ${dom}`);

const side = (l) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: l, exact: true });
let rscStart = 0, rscEnd = 0, rscBytes = 0;
page.on('request', (r) => { if (r.url().includes('_rsc') && r.url().includes('/contacts')) rscStart = Date.now(); });
page.on('requestfinished', async (r) => { if (r.url().includes('_rsc') && r.url().includes('/contacts')) { rscEnd = Date.now(); rscBytes = (await r.sizes()).responseBodySize; } });
for (let i = 0; i < 4; i++) {
  await side('Overview').click(); await page.getByRole('heading', { level: 1 }).first().waitFor(); await page.waitForTimeout(800);
  rscStart = 0; rscEnd = 0;
  const t0 = Date.now(); await side('Contacts').click();
  await page.getByRole('heading', { name: 'Contacts' }).first().waitFor(); const shown = Date.now() - t0;
  const paint = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now())))));
  console.log(`  click -> heading ${shown} ms | RSC request ${rscStart ? rscStart - t0 : '?'}..${rscEnd ? rscEnd - t0 : '?'} ms after click, ${(rscBytes / 1024).toFixed(0)} KB`);
}
await b.close();