import { test, expect } from '@playwright/test';

/**
 * The sign-up screen is front end only for now. These checks keep it honest: it is reachable without signing in, it
 * checks what it can in the browser, and it says plainly that nothing was created.
 */
test.describe('sign-up screen (front end only)', () => {
  test('is reachable signed out, and linked from sign-in', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('checks the fields, then says it is not connected yet', async ({ page }) => {
    await page.goto('/signup');
    const form = page.getByRole('form', { name: 'Create your account' });
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.getByRole('alert')).toContainText('name and your organisation');

    await form.getByLabel('Your name').fill('Test Person');
    await form.getByLabel('Organisation').fill('Test Org');
    await form.getByLabel('Work email').fill('test.person@example.test');
    await form.getByLabel('Password', { exact: true }).fill('short');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.getByRole('alert')).toContainText('at least 12 characters');

    await form.getByLabel('Password', { exact: true }).fill('a-long-enough-pass-1');
    await form.getByLabel('Confirm password').fill('a-long-enough-pass-2');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.getByRole('alert')).toContainText('do not match');

    await form.getByLabel('Confirm password').fill('a-long-enough-pass-1');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.getByRole('status')).toContainText('not connected to the server yet');
  });
});
