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
      name: `empty-${String(Date.now())}.csv`, mimeType: 'text/csv', buffer: Buffer.from('Name,Mob\n')
    });
    await expect(page.getByText(/no rows to import/)).toBeVisible();
  });

  test('uploads on choosing, explains the columns, and offers what to do next', async ({ page }) => {
    const stamp = String(Date.now());
    const n = Number(stamp.slice(-2)) % 30;
    const file = `flow-${stamp}.csv`;
    const csv = `Name,Mob,City\nFlow One,+1202555${String(100 + n).padStart(4, '0')},Pune${stamp}\n`;

    await signIn(page);
    await page.goto('/import');
    // No Upload button: the file goes up as soon as it is chosen, and the row count and file name show.
    await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText(/1 rows ·/).or(page.getByText(/\b1\b.*rows ·/))).toBeVisible();
    await expect(page.getByText(file).first()).toBeVisible();

    // The columns step says what its controls are for.
    await expect(page.getByRole('heading', { name: 'Select the columns to be stored' })).toBeVisible();
    await page.getByLabel('City').check();
    await expect(page.getByText(`Preview of all the columns you have selected from ${file}`)).toBeVisible();

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
});
