import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * Click-to-ready timings for the screens a person uses most, written to test-results/regress/budgets-run.json for
 * tests/regression/report.mjs to compare with tests/regression/budgets.json. It never fails on speed (CI runners are noisy):
 * the report warns, and `REGRESS_STRICT_BUDGETS=1` turns a warning into a failure there.
 */
test.describe('speed probe', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('time the main screens from a click to the page showing', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const out: Record<string, number> = {};
    // Each click is timed until the address changes (the new page has been fetched and shown) and the page's own <main> is there.
    const screens: Array<[string, RegExp]> = [
      ['Inbox', /\/inbox/], ['Contacts', /\/contacts/], ['Linked numbers', /\/link/], ['Import', /\/import/], ['Campaigns', /\/broadcast/],
      ['Team', /\/team/], ['AI assistant', /\/ai(\/|$)/], ['Security', /\/security/], ['Overview', /localhost:\d+\/?$/]
    ];
    await page.goto('/security');
    for (const [label, address] of screens) {
      const t0 = Date.now();
      await nav(page).getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL(address);
      await expect(page.locator('main').first()).toBeVisible();
      out[label] = Date.now() - t0;
    }
    await nav(page).getByRole('link', { name: 'Contacts', exact: true }).click();
    await expect(page.getByLabel('Search contacts')).toBeVisible();
    const row = page.locator('summary').filter({ has: page.getByLabel(/^Select /) }).first();
    if (await row.count() > 0) {
      const t1 = Date.now();
      await row.click();
      await expect(page.getByLabel('Add a tag').first()).toBeVisible();
      out['open a contact row'] = Date.now() - t1;
    }
    const t2 = Date.now();
    await page.getByLabel('Search contacts').fill('a');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL(/q=a/);
    await expect(page.getByLabel('Search contacts')).toBeVisible();
    out['Contacts search'] = Date.now() - t2;
    mkdirSync('test-results/regress', { recursive: true });
    writeFileSync('test-results/regress/budgets-run.json', JSON.stringify({ at: new Date().toISOString(), ms: out }, null, 2));
  });
});
