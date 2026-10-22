import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const base = 'http://localhost:3001';
const b = await chromium.launch({ headless: false });
const page = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await page.goto(`${base}/login`);
await page.locator('input[type="email"]').fill(env.email);
await page.locator('input[type="password"]').fill(env.password);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 90000 });
await page.goto(`${base}/broadcast/new`, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'test-results/pr106/1-new.png', fullPage: true });

await page.getByPlaceholder(/October Pune/).fill('PR106 test draft');
await page.getByPlaceholder(/What every recipient/).fill('Hi {{name}}, PR106 browser test, please ignore.');

await page.locator('select', { hasText: 'test-numbers-import' }).selectOption({ label: 'test-numbers-import · 3 contacts' });
await page.locator('select', { hasText: 'Choose a number' }).selectOption({ index: 1 });
const create = page.getByRole('button', { name: /Create draft|Creating/ });
await create.scrollIntoViewIfNeeded();
await create.dblclick();
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/pr106/4-after-click.png' });
await page.waitForURL(/broadcast\/[0-9a-f-]{36}/, { timeout: 60000 });
await page.waitForTimeout(2500);
console.log('landed', page.url());
await page.screenshot({ path: 'test-results/pr106/5-draft.png', fullPage: true });
const ov = page.getByRole('button', { name: /overrides/i }).first();
if (await ov.count()) { await ov.scrollIntoViewIfNeeded(); await ov.click(); await page.waitForTimeout(800); await page.screenshot({ path: 'test-results/pr106/6-overrides.png' }); }
await page.goto(`${base}/broadcast`);
await page.screenshot({ path: 'test-results/pr106/7-list.png', fullPage: true });
await b.close();
