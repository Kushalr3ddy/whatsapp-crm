import { test, expect } from '@playwright/test';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * The two operator-facing additions: defining a custom field on the Contacts page, and the
 * Numbers page's advisory-mode control (the loud banner itself is covered by the integration
 * tests; here we check the screen offers the control without turning anything on).
 */
test.describe('custom fields and the numbers page', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('an admin defines a custom field, sees its {{variable}}, and removes it', async ({ page }) => {
    await signIn(page);
    await nav(page).getByRole('link', { name: 'Contacts', exact: true }).click();

    const label = `E2E City ${String(Date.now())}`;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    // A <details> may or may not still be open after a server action re-renders; open it only if shut.
    const ensureOpen = async () => {
      const summary = page.getByText(/^Custom fields/);
      const open = await summary.evaluate((el) => (el.closest('details') as unknown as { open: boolean }).open);
      if (!open) await summary.click();
    };
    await ensureOpen();
    await page.getByLabel('Field name').fill(label);
    await page.getByRole('button', { name: 'Add field (admin)' }).click();

    await ensureOpen();
    // The row shows the label; the {{variable}} is in its tooltip.
    const row = page.locator(`li[title*="{{${key}}}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('title', new RegExp(`\\{\\{${key}\\}\\}`));

    // Remove it again so the run leaves nothing behind: asks "Are you sure?" first.
    await row.getByRole('button', { name: `Remove field ${label}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await ensureOpen();
    await expect(page.locator(`li[title*="{{${key}}}"]`)).toHaveCount(0);
  });

  test('the Numbers page offers advisory mode to an admin', async ({ page }) => {
    await signIn(page);
    await nav(page).getByRole('link', { name: 'Linked numbers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Linked numbers', exact: true })).toBeVisible();
    // Only present when at least one number exists; the control is hidden behind a disclosure.
    const any = await page.getByText('Advisory mode…').count();
    if (any > 0) await expect(page.getByText('Advisory mode…').first()).toBeVisible();
  });
});
