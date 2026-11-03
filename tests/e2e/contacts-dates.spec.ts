import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * Contacts: order by name, rows per page, and the two dates in the list (Imported and Last active). Reads only.
 */
test.describe('contacts: order, paging and dates', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('orders by name both ways, pages by 100, and shows when they were imported and last wrote', async ({ page }) => {
    await signIn(page);
    await page.goto('/contacts?sort=name_desc');
    await expect(page.getByRole('columnheader', { name: 'Imported' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Last active' })).toBeVisible();

    // The Name heading flips the order, and the address says which.
    await page.getByRole('button', { name: 'Sort by name' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await page.getByRole('button', { name: 'Sort by name' }).click();
    await expect(page).toHaveURL(/sort=name_desc/);

    // Rows per page is kept in the address too, and the footer counts from the first row.
    await page.getByLabel('Rows').selectOption('100');
    await expect(page).toHaveURL(/size=100/);
    await expect(page.getByText(/^Showing 1–\d+ of \d+ people?$/)).toBeVisible();
  });
});
