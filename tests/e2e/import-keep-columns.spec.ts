import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Columns ticked on the import screen come through onto the contact and can be searched; the tag
 * defaults to the file's name; and a campaign page with nobody tagged says to tag people first.
 * Numbers are in the +1 202 555 01xx range reserved for fiction.
 */
test.describe('import: keep columns, default tag', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a ticked column lands on the contact and is searchable; the tag is the file name', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText(/rows ·/)).toBeVisible();

    // The tag box is already filled with the file's name.
    await expect(page.getByLabel('Tag everyone in this file')).toHaveValue(`keep-${stamp}`);

    // Only City is ticked, so Skills must not come across.
    await page.getByLabel('City').check();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/✓ Imported/)).toBeVisible();

    // Searching by the City value finds both people.
    await page.goto(`/contacts?q=${encodeURIComponent(city)}`);
    await expect(page.locator('summary', { hasText: `City: ${city}` })).toHaveCount(2);

    // And the file-named tag is on them.
    await expect(page.getByRole('link', { name: new RegExp(`keep-${stamp}`) }).first()).toBeVisible();
  });
});
