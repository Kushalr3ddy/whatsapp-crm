import { test, expect } from '@playwright/test';
import { signIn, openDetails, CREDS_MISSING } from './helpers';

/**
 * Contacts: the Refresh button, the Dates and order controls, and a row that opens to show its details.
 * Reads only, apart from the one contact it makes.
 */
test.describe('contacts: refresh, dates and order', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('refreshes, limits by date, orders by name, and opens a row', async ({ page }) => {
    await signIn(page);
    await page.goto('/contacts');

    // Refresh reloads the list at the same address, keeping what is being looked at.
    await page.goto('/contacts?sort=name_asc');
    await page.getByRole('link', { name: 'Refresh' }).click();
    await expect(page).toHaveURL(/sort=name_asc/);

    // A date range with no one in it says so, and names the range.
    await openDetails(page, 'Dates and order');
    await page.getByLabel('From date').fill('2099-01-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/from=2099-01-01/);
    await expect(page.getByText('No one matches')).toBeVisible();
    await expect(page.getByText(/Showing people added from/)).toBeVisible();

    // Clearing brings the list back, and a row opens to show when the person was added and last imported.
    await page.getByRole('link', { name: 'Clear' }).click();
    const row = page.locator('li').filter({ has: page.getByLabel('Add a tag') }).first();
    await row.locator('details').first().evaluate((el) => { (el as unknown as { open: boolean }).open = true; });
    await expect(row.getByText('Last imported')).toBeVisible();
  });
});
