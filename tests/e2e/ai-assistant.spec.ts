import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The AI assistant's settings page: it cannot be switched on until the data-sharing note is accepted, and once
 * on, the assistant appears on the Team page (so a conversation can be assigned to it) without edit controls.
 */
test.describe('ai assistant settings', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('needs the consent, then shows up in the team as the AI', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible();

    const consent = page.getByLabel(/contact messages are shared with the AI provider/);
    const on = page.getByLabel('AI assistant is on');
    // The first run starts with the note unaccepted and the switch locked; later runs keep what was saved.
    if (!(await consent.isDisabled())) {
      await expect(on).toBeDisabled();
      await consent.check();
    }
    await expect(on).toBeEnabled();
    await on.check();
    await page.getByLabel('What it may talk about, and how').fill('Answer questions about jobs.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto('/team');
    const row = page.getByRole('listitem').filter({ hasText: 'AI assistant' });
    await expect(row.getByText('AI', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Reset password' })).toHaveCount(0);
  });
});
