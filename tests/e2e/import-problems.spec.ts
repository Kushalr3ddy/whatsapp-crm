import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The import screen reads the phone column from the values, not just the header, and says which rows it left out and why. Numbers are
 * in the +1 202 555 01xx range reserved for fiction, and nothing is written: the check is a dry run.
 */
test.describe('import: column suggestion and skipped rows', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('picks the phone column by its values and lists the rows it left out', async ({ page }) => {
    const stamp = String(Date.now());
    // The header is "Mob", which only a value-based guess would call the phone column. Row 4 has a number that cannot be read.
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

    // Chosen by what is in the column, and said so in "How the file was read".
    await expect(page.getByText('3 people ready to import')).toBeVisible();
    await expect(page.locator('.im-read')).toContainText('Mob');

    // The row it left out, grouped by why, with the row to find it on (the sheet's first row is the column names).
    await expect(page.getByText('Why 1 was skipped')).toBeVisible();
    await page.getByRole('button', { name: 'Show rows' }).click();
    await expect(page.getByText('Row 4, Chitra Fiction (not-a-phone)')).toBeVisible();
  });

  test('says so when nobody in the file has a number it can use', async ({ page }) => {
    const stamp = String(Date.now());
    const csv =
      'Name,Mobile,Remarks\n' +
      `Asha Fiction,call me,${stamp}\n` +
      `Bilal Fiction,no answer,${stamp}\n`;
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `warn-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText('Nobody in this file has a mobile number we can use.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import \d+ people?$/ })).toBeDisabled();
  });

  test('a file with no mobile column is explained, in plain words', async ({ page }) => {
    const stamp = String(Date.now());
    const csv = `Name,Email,City,Company\nAsha Fiction,asha${stamp}@example.test,Pune,Acme\n`;
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `nocol-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText(/has no mobile number column/)).toBeVisible();
    await expect(page.getByText('Its columns are Name, Email, City and Company.', { exact: false })).toBeVisible();
  });
});
