// Sends ONE plain test message from a sender to LIVE_SEND_TO, then polls its status. Usage: node scripts/send-one.mjs <senderId>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_a-z]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const base = 'http://localhost:3001', API = 'http://localhost:3000/api/v1';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.locator('input[type="email"]').fill(env.email);
await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 });
const h = async () => ({ 'x-csrf-token': (await ctx.cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '', 'content-type': 'application/json' });
const r = await page.request.post(`${API}/messages`, { headers: await h(), data: { to: process.argv[3] ?? env.LIVE_SEND_TO, senderId: process.argv[2], body: `Relink test ${new Date().toISOString()}: please ignore.` } });
const j = await r.json(); console.log('queued', r.status());
const cid = j.data.conversationId;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  const m = (await (await page.request.get(`${API}/conversations/${cid}/messages`, { headers: await h() })).json()).data.filter((x) => x.direction === 'outbound');
  console.log(new Date().toISOString(), m.map((x) => x.status).join(','));
  if (m.at(-1)?.status === 'delivered' || m.at(-1)?.status === 'read') break;
}
await browser.close();
