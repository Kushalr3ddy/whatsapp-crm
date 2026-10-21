import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Import screen feedback: pressing Import before Preview shows a loud notice right under the buttons,
 * a finished import does not linger when the page is left and revisited, and the wizard is wider than
 * the old narrow column. Numbers are in the +1 202 555 01xx range reserved for fiction.
 */
test.describe('import: notice under the buttons, clean after finishing, wider wizard', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('Import before Preview warns under the buttons; a finished import is gone on return', async ({ page }) => {
    const stamp = String(Date.now());
    const n = 100 + (Number(stamp.slice(-3)) % 90);
    const file = `notice-${stamp}.csv`;
    const csv = `Name,Mob\nNotice One,+1202555${String(n).padStart(4, '0')}\n`;

    await signIn(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();

    // Wider than the old 42rem (672px) column.
    const box = await page.getByRole('list', { name: 'Import steps' }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(700);

    // Import first: the notice shows in the button row's section, not at the top of the page.
    const importBtn = page.getByRole('button', { name: 'Import', exact: true });
    await importBtn.click();
    const notice = page.getByRole('alert').filter({ hasText: 'Click Preview first' });
    await expect(notice).toBeVisible();
    const importY = (await importBtn.boundingBox())?.y ?? 0;
    expect((await notice.boundingBox())?.y ?? 0).toBeGreaterThan(importY);

    // Preview clears it; then import for real.
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
    await expect(notice).toHaveCount(0);
    await importBtn.click();
    await expect(page.getByText(/✓ Imported/)).toBeVisible();

    // Leave and come back: the finished import is not on screen any more.
    await page.goto('/contacts');
    await page.goto('/import');
    await expect(page.getByText(/✓ Imported/)).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
  });
});
