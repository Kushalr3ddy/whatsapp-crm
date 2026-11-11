import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Uploading the same file twice is explained in plain words, and the screen offers to import it again (it used to be a dead end: the
 * server said "use force" but the screen had no way to). Numbers are in the +1 202 555 01xx range reserved for fiction; nothing is
 * imported, only uploaded and checked.
 */
test.describe('import: the same file again', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('is explained, then "Import it again" starts a fresh check', async ({ page }) => {
    const stamp = String(Date.now());
    const file = { name: `again-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob\nAgain One,+12025550600\nBatch,${stamp}\n`) };

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(/ready to import/)).toBeVisible();

    // Back to the drop box, then the very same bytes again.
    await page.getByRole('button', { name: 'Choose another file' }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(/You uploaded this exact file before/)).toBeVisible();

    await page.getByRole('button', { name: 'Import it again' }).click();
    await expect(page.getByText(/ready to import/)).toBeVisible();
  });
});
