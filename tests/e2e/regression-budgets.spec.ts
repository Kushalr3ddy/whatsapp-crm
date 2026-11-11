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
  // Timings mean something only on a production build: `npm run regress` sets REGRESS=1. In the plain dev-server e2e run (first visits compile) it is skipped.
  test.skip(process.env.REGRESS !== '1', 'timings are only measured by npm run regress (production build)');

  test('time the main screens from a click to the page showing', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const out: Record<string, number> = {};
    // Each click is timed until the address changes (the new page has been fetched and shown) and the page's own heading (not a loading placeholder) is there.
    const screens: Array<[string, RegExp]> = [
      ['Inbox', /\/inbox/], ['Contacts', /\/contacts/], ['Linked numbers', /\/link/], ['Import', /\/import/], ['Campaigns', /\/broadcast/],
      ['Team', /\/team/], ['AI assistant', /\/ai(\/|$)/], ['Security', /\/security/], ['Overview', /localhost:\d+\/?$/]
    ];
    await page.goto('/security');
    for (const [label, address] of screens) {
      const t0 = Date.now();
      await nav(page).getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL(address);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      out[label] = Date.now() - t0;
    }
    // The new Contacts screen: its own search field, a person opening in the side panel, and a search settling.
    await nav(page).getByRole('link', { name: 'Contacts', exact: true }).click();
    const search = page.getByLabel('Search', { exact: true });
    await expect(search).toBeVisible();
    const first = page.locator('button[data-open]').first();
    await expect(first).toBeVisible();
    const t1 = Date.now();
    await first.click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    out['open a contact row'] = Date.now() - t1;
    await page.keyboard.press('Escape');
    const t2 = Date.now();
    await search.fill('a');
    await page.waitForURL(/q=a/);
    // Settled: the table has been drawn for the new search (the frame is no longer busy and says how many people match).
    await expect(page.locator('.ct-frame[aria-busy="false"]')).toBeVisible();
    await expect(page.getByText(/^Showing /)).toBeVisible();
    out['Contacts search'] = Date.now() - t2;
    mkdirSync('test-results/regress', { recursive: true });
    writeFileSync('test-results/regress/budgets-run.json', JSON.stringify({ at: new Date().toISOString(), ms: out }, null, 2));
  });
});
