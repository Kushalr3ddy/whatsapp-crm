import { expect, type Page } from '@playwright/test';

/** The dev test admin, from `.env` (loaded by the Playwright config). */
export const EMAIL = process.env.TEST_EMAIL ?? '';
export const PASSWORD = process.env.TEST_PASSWORD ?? '';

/** True when creds are missing — specs skip themselves rather than fail on a fresh clone. */
export const CREDS_MISSING = EMAIL === '' || PASSWORD === '';

/** Signs in and waits until the app chrome (the nav) is on screen. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Contacts' })).toBeVisible();
}
