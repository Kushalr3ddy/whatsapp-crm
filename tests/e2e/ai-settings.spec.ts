import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The AI settings tab inside the AI tab: choose the provider, enter the key, pick a model, test, and "Use this". This spec never saves, so it
 * cannot change the install's real settings: it checks the tab, the rules of the form, and the plain-words errors.
 */
test.describe('ai settings tab', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('the tab is there, and the form only lets a tested model be used', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai');
    // Two tabs inside the AI tab.
    const tabs = page.getByRole('navigation', { name: 'AI sections' });
    await expect(tabs.getByRole('link', { name: 'Assistant' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'AI settings' }).click();
    await expect(page).toHaveURL(/\/ai\/settings/);
    await expect(tabs.getByRole('link', { name: 'AI settings' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'In use now' })).toBeVisible();

    // The seven providers are offered.
    const provider = page.getByLabel('1. Provider');
    await expect(provider.locator('option')).toHaveCount(8);          // the placeholder plus seven
    await expect(provider).toContainText('Groq');
    await expect(provider).toContainText('OpenRouter');
    await expect(provider).toContainText('Ollama');

    // Nothing to test or use before a provider, key and model are given; Use this stays off until a test passes.
    await provider.selectOption('custom');
    await expect(page.getByRole('button', { name: 'Use this' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Test it/ })).toBeDisabled();
    await page.getByLabel('Address of the service').fill('https://nonexistent-host.invalid/v1');
    await page.getByLabel('2. API key').fill('not-a-real-key');
    await page.getByLabel('3. Model').fill('some-model');
    await expect(page.getByRole('button', { name: /Test it/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Use this' })).toBeDisabled();

    // A bad address is refused in words, and a private one before anything is called.
    await page.getByRole('button', { name: /Test it/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /could not be found|private network/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use this' })).toBeDisabled();
    await page.getByLabel('Address of the service').fill('http://example.com/v1');
    await page.getByRole('button', { name: /Test it/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /must start with https/ })).toBeVisible();

    // The key box hides what is typed.
    await expect(page.getByLabel('2. API key')).toHaveAttribute('type', 'password');
  });

  test('the Assistant tab says so when no model is set up', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai/settings');
    const inUse = page.getByRole('region', { name: 'In use now' });
    const notSet = await inUse.getByText(/No AI model is set up yet/).isVisible();
    await page.goto('/ai');
    const banner = page.getByText(/No AI model is set up, so nothing here can write yet/);
    if (notSet) { await expect(banner).toBeVisible(); await expect(page.getByRole('link', { name: 'Open AI settings' })).toBeVisible(); }
    else await expect(banner).toHaveCount(0);
  });
});
