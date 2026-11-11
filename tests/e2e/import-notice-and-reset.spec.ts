import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Import screen: a finished import does not linger when the page is left and revisited, and a check left half way is still there when
 * the person comes back. Numbers are in the +1 202 555 01xx range reserved for fiction.
 */
test.describe('import: clean after finishing, remembered while unfinished', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a finished import is gone on return', async ({ page }) => {
    const stamp = String(Date.now());
    // 0490 to 0579: clear of the seeded people (0120-0139), see R-009.
    const n = 490 + (Number(stamp.slice(-3)) % 90);
    const file = `notice-${stamp}.csv`;
    const csv = `Name,Mob\nNotice One,+1202555${String(n).padStart(4, '0')}\n`;

    await signIn(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('1 person ready to import')).toBeVisible();

    // Wider than the old 42rem (672px) column.
    const box = await page.locator('.im-card').first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(700);

    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible();

    // Leave and come back: the finished import is not on screen any more.
    await page.goto('/contacts');
    await page.goto('/import');
    await expect(page.getByText('1 person is in your contacts')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
  });

  test('an unfinished check is still there when the person comes back', async ({ page }) => {
    const stamp = String(Date.now());
    const n = 580 + (Number(stamp.slice(-3)) % 90);
    const csv = `Name,Mob\nHalf Way,+1202555${String(n).padStart(4, '0')}\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: `half-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('1 person ready to import')).toBeVisible();

    await page.goto('/contacts');
    await page.goto('/import');
    await expect(page.getByText('1 person ready to import')).toBeVisible();
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue(`half-${stamp}`);
  });
});
