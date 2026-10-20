import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Uploading the same file twice is refused with a reason, and the screen offers to upload it anyway
 * (it used to be a dead end: the server said "use force" but the screen had no way to). Numbers are in the
 * +1 202 555 01xx range reserved for fiction; nothing is imported, only uploaded.
 */
test.describe('import: the same file again', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('is refused with a reason, then "Upload anyway" starts a fresh import', async ({ page }) => {
    const stamp = String(Date.now());
    const file = { name: `again-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob\nAgain One,+12025550130\nBatch,${stamp}\n`) };

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(/rows ·/)).toBeVisible();

    // Back to the picker, then the very same bytes again.
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(/already uploaded/)).toBeVisible();

    await page.getByRole('button', { name: 'Upload anyway' }).click();
    await expect(page.getByText(/rows ·/)).toBeVisible();
  });
});
