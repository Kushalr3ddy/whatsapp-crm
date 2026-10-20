import { test, expect } from '@playwright/test';
import { signIn, EMAIL, CREDS_MISSING } from './helpers';

/**
 * Authentication end to end: a wrong password is refused, a right one gets in, and signing out both
 * returns to the login screen and drops the session (a protected page then bounces back to it).
 */
test.describe('authentication', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('the password can be shown and hidden while typing', async ({ page }) => {
    await page.goto('/login');
    const box = page.getByLabel('Password', { exact: true });
    await box.fill('typed-by-hand-1');
    await expect(box).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(box).toHaveAttribute('type', 'text');
    await expect(box).toHaveValue('typed-by-hand-1');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(box).toHaveAttribute('type', 'password');
  });

  test('refuses a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Still on login, and the app nav never appears.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('link', { name: 'Contacts' })).toHaveCount(0);
  });

  test('signs in and signs out, and the session is really gone', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    // A protected page now bounces to login rather than rendering.
    await page.goto('/contacts');
    await expect(page).toHaveURL(/\/login/);
  });
});
