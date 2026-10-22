// Unlinks a sender and keeps its QR on screen until the number reconnects. Usage: node scripts/relink.mjs <senderId>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[a-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const id = process.argv[2];
const browser = await chromium.launch({ headless: false });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
await page.goto(`${base}/login`);
await page.locator('input[type="email"]').fill(env.email);
await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 });
await page.goto(`${base}/link`);
await page.waitForTimeout(3000);
const unlink = page.getByRole('button', { name: /Unlink \/ reset this number/ }).first();
await page.screenshot({ path: 'test-results/relink-before.png', fullPage: true });
await unlink.scrollIntoViewIfNeeded({ timeout: 15000 });
await unlink.click();
console.log('unlink clicked');
await page.waitForTimeout(6000);
await page.goto(`${base}/link?start=${id}`);
console.log('QR page open: scan it now');
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(2500);
  if (await page.getByText(/Linked\. If it stops receiving/).first().isVisible().catch(() => false)) { console.log('CONNECTED'); break; }
}
await page.screenshot({ path: 'test-results/relink-final.png' });
await browser.close();
