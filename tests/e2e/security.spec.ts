import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The key rotation wizard (D-31). The verify stack runs one key and everything on it, so the
 * page should say so and the spot check should pass. Rotating for real is covered by the
 * integration tests, which can change the key ring; a browser test cannot restart the stack.
 */
test.describe('encryption keys page', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('shows where the keys stand and verifies a sample', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Security', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Encryption keys' })).toBeVisible();
    await expect(page.getByText('Current key', { exact: true })).toBeVisible();
    await expect(page.getByText('Make a new key')).toBeVisible();

    await page.getByRole('button', { name: 'Verify with the new key' }).click();
    await expect(page.getByText(/sampled value/)).toBeVisible();
    await expect(page.getByText(/could not be read/)).toHaveCount(0);
  });
});
