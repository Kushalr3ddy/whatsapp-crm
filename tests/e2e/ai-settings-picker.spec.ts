import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The model picker on the AI settings tab: a searchable list in the app's own style (not the browser's plain suggestion list).
 * Needs the stub provider and an API started with LLM_ALLOW_PRIVATE_BASE_URL=true (see tests/fixtures/llm-stub-provider.mjs), so it runs only when asked for.
 * Nothing is saved.
 */
test.describe('ai settings model picker', () => {
  test.skip(CREDS_MISSING || process.env.E2E_LLM_STUB === undefined, 'run with E2E_LLM_STUB=1 and the stub provider (tests/fixtures/llm-stub-provider.mjs)');

  test('search, choose by keyboard, and type a name that is not in the list', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai/settings');
    await page.getByLabel('1. Provider').selectOption('custom');
    await page.getByLabel('Address of the service').fill('http://127.0.0.1:4545/v1');
    await page.getByLabel('2. API key').fill('stub-key');
    await page.getByRole('button', { name: 'Find models' }).click();
    await expect(page.getByText(/63 models found/)).toBeVisible();

    // Opening the list shows a bounded, styled list with a footer, not an unbounded browser list.
    const model = page.getByLabel('3. Model');
    await model.click();
    const list = page.getByRole('listbox', { name: 'Models' });
    await expect(list.getByRole('option')).toHaveCount(40);
    await expect(page.getByText('Showing 40 of 63')).toBeVisible();

    // Typing narrows it, with the provider's display name shown beside the id.
    await model.fill('gemini-2');
    await expect(list.getByRole('option')).toHaveCount(3);                 // two models, plus "use as typed"
    await expect(list.getByRole('option').first()).toContainText('gemini-2.5-flash');

    // Arrow keys and Enter choose one and close the list.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(model).toHaveValue('gemini-2.5-pro');
    await expect(list).toHaveCount(0);

    // A name that is not in the list can be used as typed, and Test it stays reachable.
    await model.fill('my-own-model');
    await expect(list.getByRole('option', { name: /Use “my-own-model” as typed/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(model).toHaveValue('my-own-model');
    await page.getByRole('button', { name: /Test it/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /It works|answered/ })).toBeVisible({ timeout: 20000 });
  });
});
