import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The import screen from the alpha-testing feedback: choosing a file uploads it at once, an empty file is
 * explained, the columns step says what the dropdowns and tick boxes are for, and a finished import offers
 * the next step. Numbers are in the +1 202 555 01xx range reserved for fiction.
 */
test.describe('import: flow', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a file with no people in it is explained', async ({ page }) => {
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `empty-${String(Date.now())}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob,Run${String(Date.now())}\n`)
    });
    await expect(page.getByText(/no rows to import/)).toBeVisible();
  });

  test('uploads on choosing, explains the columns, and offers what to do next', async ({ page }) => {
    const stamp = String(Date.now());
    const n = Number(stamp.slice(-2)) % 30;
    const file = `flow-${stamp}.csv`;
    // 0300 to 0329: clear of the seeded people (0120-0139), see R-009.
    const csv = `Name,Mob,City\nFlow One,+1202555${String(300 + n).padStart(4, '0')},Pune${stamp}\n`;

    await signIn(page);
    await page.goto('/import');
    // No Upload button: the file goes up as soon as it is chosen, and the row count and file name show.
    await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText(/1 rows ·/).or(page.getByText(/\b1\b.*rows ·/))).toBeVisible();
    await expect(page.getByText(file).first()).toBeVisible();

    // The columns step says what its controls are for.
    await expect(page.getByRole('heading', { name: 'Columns to be stored' })).toBeVisible();
    await page.getByLabel('Choose columns').check();
    await page.getByLabel('City').check();
    await expect(page.getByText(`From ${file}.`)).toBeVisible();

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/✓ Imported/)).toBeVisible();

    // Suggestions after the import, never forced.
    await expect(page.getByRole('link', { name: /View the \d+ imported contacts/ })).toBeVisible();
    await page.getByRole('link', { name: 'Message these people' }).click();
    await expect(page).toHaveURL(/\/broadcast\/new\?import=/);
    await expect(page.locator('select[name="fromImportRunId"]')).not.toHaveValue('');
  });

  test('several phone columns, a joined name and personal columns', async ({ page }) => {
    const stamp = String(Date.now());
    // 0330 to 0389 (and +50, +100): clear of the seeded people (0120-0139), see R-009.
    const base = 330 + (Number(stamp.slice(-3)) % 60);
    const file = `join-${stamp}.csv`;
    const csv =
      'First Name,Last Name,Phone,Alt Phone,City,Date of Birth\n' +
      // The stamp is in the city so the file's bytes differ on every run: the server refuses a file it has seen before.
      `Anita,Sharma,+1202555${String(base).padStart(4, '0')},+1202555${String(base + 100).padStart(4, '0')},Pune ${stamp},1990-01-01\n` +
      `a,sharma,+1202555${String(base + 50).padStart(4, '0')},,Delhi ${stamp},1991-02-02\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText(/2 rows ·/)).toBeVisible();

    // First and last name columns are found, and joined without shortening: Anita Sharma, and a.sharma for a one-letter first name.
    await expect(page.locator('#import-name')).toHaveValue('__join__');
    await expect(page.getByRole('cell', { name: 'Anita Sharma' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'a.sharma' })).toBeVisible();

    // A second phone column can be ticked and is tried after the first.
    await page.getByRole('checkbox', { name: /^[–\d] Alt Phone/ }).check();
    await expect(page.getByRole('columnheader', { name: 'Phone 2' })).toBeVisible();

    // A personal-looking column is labelled but is no longer locked: it can be ticked in "Choose columns" mode.
    await page.getByLabel('Choose columns').check();
    const dob = page.getByRole('checkbox', { name: /Date of Birth/ });
    await expect(dob).toBeEnabled();
    await dob.check();

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
  });
});
