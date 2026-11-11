import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/** The feedback fixes: Preview explained, Import only after Preview, a new tag says so, bulk Preview always answers. */
test.describe('feedback fixes', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('import: the check says nothing is saved yet, and there is no Preview step', async ({ page }) => {
    const stamp = String(Date.now());
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `fb-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob\nFeedback One,+1202555${stamp.slice(-4)}\n`)
    });
    await expect(page.getByText('Nothing is saved yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import 1 person' })).toBeEnabled();
  });

  test('contacts: a new tag says so, and a search nobody matches says so', async ({ page }) => {
    const tag = `e2e-fb-${String(Date.now())}`;
    await signIn(page);
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'New tag' }).click();
    await page.getByLabel('New tag name').fill(tag);
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Tag “${tag}” created.`)).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${tag}`) })).toBeVisible();

    await page.goto('/contacts?q=zzz-nobody-matches-this');
    await expect(page.getByText('No people match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.getByText('No people match')).toHaveCount(0);
  });
});
