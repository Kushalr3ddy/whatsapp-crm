import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING, openContactsFile } from './helpers';

/**
 * Every column of the sheet comes through onto the person and can be searched (there are no tick boxes: nothing is left behind),
 * and the tag defaults to the file's name. Numbers are in the +1 202 555 01xx range reserved for fiction.
 */
test.describe('import: every column is kept, default tag', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('every column lands on the person and is searchable; the tag is the file name', async ({ page }) => {
    const stamp = String(Date.now());
    const city = `Keepville${stamp}`;
    // Numbers vary per run (inside the reserved 0200-0289 block) so an earlier run's contacts, which keep their
    // own names, are not picked up again.
    const n = Number(stamp.slice(-2)) % 45;
    const csv =
      'Name,Mob,City,Skills\n' +
      `Keep One,+1202555${String(200 + n * 2).padStart(4, '0')},${city},welding\n` +
      `Keep Two,+1202555${String(201 + n * 2).padStart(4, '0')},${city},NA\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `keep-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText('2 people ready to import')).toBeVisible();

    // The tag box is already filled with the file's name, and says the tag is new.
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue(`keep-${stamp}`);
    await expect(page.getByText(/New tag: it is created when you import/)).toBeVisible();
    // No tick boxes for columns: every other column is kept, and the screen says so.
    await expect(page.getByText('2 columns come in as they are, as extra details.')).toBeVisible();

    await page.getByRole('button', { name: 'Import 2 people' }).click();
    await expect(page.getByText('2 people are in your contacts')).toBeVisible();

    // The file is a source on the left; both its columns are offered in Columns and show their values.
    await openContactsFile(page, `keep-${stamp}.csv`);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByLabel('City', { exact: true }).check();
    await page.getByLabel('Skills', { exact: true }).check();
    await expect(page.getByRole('cell', { name: city })).toHaveCount(2);
    // "NA" is a blank, never a value: only the one real skill shows.
    await expect(page.getByRole('cell', { name: 'welding' })).toHaveCount(1);

    // The file-named tag is on them.
    await expect(page.getByRole('cell', { name: `keep-${stamp}` }).first()).toBeVisible();
  });

  test('every column is kept, personal ones included', async ({ page }) => {
    const stamp = String(Date.now());
    const city = `Allville${stamp}`;
    // Inside the reserved block, at the end that the other test above does not use.
    const n = Number(stamp.slice(-1));
    const csv =
      'Name,Mob,City,Gender\n' +
      `All One,+1202555${String(290 + n).padStart(4, '0')},${city},female\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `all-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.getByText('1 person ready to import')).toBeVisible();

    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible();

    await openContactsFile(page, `all-${stamp}.csv`);
    await page.getByRole('button', { name: 'All One' }).click();
    const panel = page.getByRole('dialog', { name: /All One/ });
    await expect(panel.getByText(city)).toBeVisible();
    await expect(panel.getByText('female')).toBeVisible();
  });
});
