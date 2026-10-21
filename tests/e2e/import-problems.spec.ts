import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The import screen reads the phone column from the values, not just the header, and lists the rows
 * it could not use. Numbers are in the +1 202 555 01xx range reserved for fiction, and the run is
 * only previewed (a dry run), so no contact is written.
 */
test.describe('import: column suggestion and rows to fix', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('picks the phone column by its values and lists the rows that need fixing', async ({ page }) => {
    const stamp = String(Date.now());
    // The header is "Mob", which only a value-based guess would call the phone column. Row 3 has a
    // number that cannot be read; row 2 has a good number plus a junk second one.
    const csv =
      'Name,Mob,Batch\n' +
      `Asha Fiction,+12025550101,${stamp}\n` +
      `Bilal Fiction,"+12025550102, 1111111111",${stamp}\n` +
      `Chitra Fiction,not-a-phone,${stamp}\n` +
      `Dev Fiction,+12025550104,${stamp}\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `problems-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText(/rows ·/)).toBeVisible();

    // Chosen by what is in the column, and said so.
    await expect(page.getByRole('checkbox', { name: /Mob/ })).toBeChecked();
    await expect(page.getByText(/of the values look like phone numbers/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Preview' }).click();
    const box = page.getByRole('alert', { name: 'Rows to fix' });
    await expect(box).toBeVisible();
    // Sheet rows: the header is row 1, so Chitra is row 4 and Bilal is row 3.
    await expect(box).toContainText('1 row couldn’t be imported');
    await expect(box).toContainText('Row 4');
    await expect(box).toContainText('not-a-phone');
    await expect(box).toContainText('1 row would be imported without one of its numbers');
    await expect(box).toContainText('Row 3');
    await expect(box).toContainText('1111111111');
  });

  test('warns when the chosen column hardly looks like phone numbers', async ({ page }) => {
    const stamp = String(Date.now());
    const csv =
      'Name,Mob,Remarks\n' +
      `Asha Fiction,+12025550111,called ${stamp}\n` +
      `Bilal Fiction,+12025550112,no answer\n`;
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `warn-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText(/rows ·/)).toBeVisible();
    // Swap the suggested column for one that is not phone numbers: the note says so.
    await page.getByRole('checkbox', { name: /Mob/ }).uncheck();
    await page.getByLabel('Add another column that holds phone numbers').selectOption('Remarks');
    await expect(page.getByText(/only \d+% look like phone numbers/)).toBeVisible();
  });
});
