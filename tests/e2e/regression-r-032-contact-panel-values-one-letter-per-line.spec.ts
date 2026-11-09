import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * R-032: a person imported from a Naukri export (whose columns are long screening questions) opened in the Contacts side panel with
 * every value drawn one letter per line, because the long question took the whole width of the "From <file>" list.
 * Numbers are in the +1 202 555 06xx range reserved for fiction.
 */
test.describe('[R-032] contact panel with long file columns', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('every value in "From <file>" stays readable when the column names are long questions', async ({ page }) => {
    const stamp = String(Date.now());
    const tag = `r032-${stamp}`;
    const question = 'Ans(Are you currently residing in Bengaluru or willing to relocate to Bengaluru?)';
    const phone = `+1202555${String(600 + (Number(stamp.slice(-3)) % 100)).padStart(4, '0')}`;
    const csv = `Name,Mob,Job Title,"${question}"\nLong Header ${stamp},${phone},Purchase Manager,Yes I can relocate\n`;

    await signIn(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: `${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('1 person ready to import')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible({ timeout: 30_000 });

    await page.goto('/contacts');
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await page.getByRole('button', { name: new RegExp(`Long Header ${stamp}`) }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(`Long Header ${stamp}`) });
    await expect(panel.getByText(`From ${tag}.csv`)).toBeVisible();

    // Each value gets a real column, not one letter's width (it was about 10 px wide, 210 px tall); wrapping by words is fine.
    for (const value of ['Never replied', 'Purchase Manager', 'Yes I can relocate']) {
      const box = await panel.getByText(value, { exact: true }).boundingBox();
      expect(box, `"${value}" is not on the panel`).not.toBeNull();
      expect(box!.width, `"${value}" is ${String(box!.width)} px wide: drawn one letter per line`).toBeGreaterThan(100);
    }
    await expect(panel.getByText('Never replied', { exact: true })).toHaveCSS('white-space', 'normal');
    const short = await panel.getByText('Never replied', { exact: true }).boundingBox();
    expect(short!.height, 'a two-word value should fit on one line').toBeLessThan(30);
  });
});
