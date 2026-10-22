import { test, expect } from '@playwright/test';
import { signIn, openDetails, CREDS_MISSING } from './helpers';

/** The feedback fixes: Preview explained, Import only after Preview, a new tag says so, bulk Preview always answers. */
test.describe('feedback fixes', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('import: Preview is explained and Import appears only after it', async ({ page }) => {
    const stamp = String(Date.now());
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `fb-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob\nFeedback One,+1202555${stamp.slice(-4)}\n`)
    });
    await expect(page.getByText(/checks your file and shows who is new/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  });

  test('contacts: new tag shows a banner, bulk Preview says when no one matches', async ({ page }) => {
    const tag = `e2e-fb-${String(Date.now())}`;
    await signIn(page);
    await page.goto('/contacts');
    await openDetails(page, /^New tag/);
    await page.getByPlaceholder('New tag name…').fill(tag);
    await page.getByRole('button', { name: 'Add tag' }).click();
    await expect(page.getByText(`Tag “${tag}” is ready`)).toBeVisible();

    // A search nobody matches, then Preview a bulk add over "everyone matching".
    await page.goto('/contacts?q=zzz-nobody-matches-this');
    await openDetails(page, 'Tag many at once');
    await page.getByLabel('Tag to apply').selectOption({ label: tag });
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('No one matches, so nothing would change.')).toBeVisible();
  });
});
