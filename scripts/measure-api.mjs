// Times API calls the Contacts page makes, from a signed-in browser context: node scripts/measure-api.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const API = 'http://localhost:3000/api/v1';
const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto('http://localhost:3001/login'); await page.locator('input[type="email"]').fill(env.email); await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.includes('login'));
const h = async () => ({ 'x-csrf-token': (await ctx.cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '' });
const tags = (await (await page.request.get(`${API}/tags`, { headers: await h() })).json()).data;
const big = tags.sort((a, b) => (b.contactCount ?? 0) - (a.contactCount ?? 0))[0];
const calls = [['contacts (first 50)', '/contacts?limit=50'], ['contacts search "a"', '/contacts?limit=50&q=a'], ['contacts search "Bengaluru"', '/contacts?limit=50&q=Bengaluru'], [`contacts tag "${big.name.slice(0, 20)}" (${big.contactCount})`, `/contacts?limit=50&tagId=${big.id}`], ['tags list', '/tags'], ['custom fields', '/custom-fields'], ['senders', '/senders'], ['campaigns', '/campaigns']];
for (const [label, path] of calls) {
  const ms = [];
  for (let i = 0; i < 5; i++) { const t = Date.now(); const r = await page.request.get(API + path, { headers: await h() }); await r.body(); ms.push(Date.now() - t); }
  console.log(`${label.padEnd(44)} ${ms.sort((a, b) => a - b).join(' ')} ms (status ${(await page.request.get(API + path, { headers: await h() })).status()})`);
}
await b.close();
