import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Before anything is imported, the check shows the sheet as a small read-only table. Ticking details narrows it to the people who
 * lack them (any or all), a search narrows it further, and one button downloads everyone it shows. Numbers are in the
 * +1 202 555 01xx range reserved for fiction, and nothing is written: the check is a dry run.
 */
test.describe('import: looking through the sheet', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('filters by several missing details at once and downloads everyone it shows', async ({ page }) => {
    const stamp = String(Date.now());
    // Sheet rows 2 to 7. No city: rows 3 (blank), 4 ("NA") and 7. No name: rows 6 and 7.
    const csv =
      'Name,Mobile,City,Batch\n' +
      `Asha Fiction,+12025550101,Pune,${stamp}\n` +
      `Bilal Fiction,+12025550102,,${stamp}\n` +
      `Chitra Fiction,+12025550103,NA,${stamp}\n` +
      `Dev Fiction,+12025550104,Surat,${stamp}\n` +
      `,+12025550105,Pune,${stamp}\n` +
      `,+12025550106,,${stamp}\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `sheet-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText('6 people ready to import')).toBeVisible();

    // Everyone, with the sheet's own row numbers (the first row is the column names).
    const rows = page.locator('.im-sheet tbody tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.first().locator('th')).toHaveText('2');
    await expect(rows.last().locator('th')).toHaveText('7');
    await expect(page.getByText('Showing 1–6 of 6')).toBeVisible();

    // One detail: the people with no city (a blank and an "NA" both count).
    await page.getByRole('checkbox', { name: /^City\b/ }).check();
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('Only the people who lack City.')).toBeVisible();

    // Two details: "any" by default, then "all".
    await page.getByRole('checkbox', { name: /^Name\b/ }).check();
    await expect(rows).toHaveCount(4);
    await page.getByRole('radio', { name: 'Lack all of these' }).check();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('th')).toHaveText('7');
    await page.getByRole('radio', { name: 'Lack any of these' }).check();
    await expect(rows).toHaveCount(4);

    // One download for everyone shown: the sheet's own columns and nothing added, so it can be filled in and imported again.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download 4 people' }).click()
    ]);
    expect(download.suggestedFilename()).toBe('people-missing-city-and-1-more.csv');
    expect(readFileSync(await download.path(), 'utf8').split('\n')).toEqual([
      '"Name","Mobile","City","Batch"',
      `"Bilal Fiction","+12025550102","",${JSON.stringify(stamp)}`,
      `"Chitra Fiction","+12025550103","NA",${JSON.stringify(stamp)}`,
      `"","+12025550105","Pune",${JSON.stringify(stamp)}`,
      `"","+12025550106","",${JSON.stringify(stamp)}`
    ]);

    // Show everyone again, then search any column.
    await page.getByRole('button', { name: 'Show everyone' }).click();
    await expect(rows).toHaveCount(6);
    await page.getByLabel('Search every column').fill('surat');
    await expect(rows).toHaveCount(1);
    await page.getByLabel('Search every column').fill('nobody has this');
    await expect(page.getByText('Nobody matches that search.')).toBeVisible();
  });
});
