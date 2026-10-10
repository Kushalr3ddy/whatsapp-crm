import { expect, type Page } from '@playwright/test';

/** The dev test admin, from `.env` (loaded by the Playwright config). */
export const EMAIL = process.env.TEST_EMAIL ?? '';
export const PASSWORD = process.env.TEST_PASSWORD ?? '';

/** True when creds are missing — specs skip themselves rather than fail on a fresh clone. */
export const CREDS_MISSING = EMAIL === '' || PASSWORD === '';

/** The main navigation landmark. */
export const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

/** Signs in and waits until the app chrome (the nav) is on screen. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Scoped to the sidebar: the Overview page also has links whose text contains "Contacts".
  await expect(nav(page).getByRole('link', { name: 'Contacts', exact: true })).toBeVisible();
}

/** Opens a collapsed <details> by its summary text, leaving it alone if it is already open. */
export async function openDetails(page: Page, summary: string | RegExp): Promise<void> {
  const el = page.locator('summary', { hasText: summary }).first();
  const open = await el.evaluate((n) => (n.closest('details') as unknown as { open: boolean }).open);
  if (!open) await el.click();
}
