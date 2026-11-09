import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * AI templates: say what it is for, the AI writes it, the template cannot be saved without the person who gets the chat, then it is
 * on the Templates home, can be duplicated and deleted. Needs the assistant switched on (the ai-assistant spec does that) and a model
 * configured; with either missing it skips instead of failing.
 */
test.describe('ai templates', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('write, save, find it on the home, duplicate and delete', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page);
    await page.goto('/ai/new');
    const box = page.getByLabel('What is this template for');
    test.skip(!(await box.isVisible()), 'the assistant is off in this organisation');

    const stamp = String(Date.now());
    await box.fill(`I run a small bakery called Crumb ${stamp}. Message people about the new sourdough on Friday and answer questions about opening hours, 8 to 6.`);
    await page.getByRole('button', { name: 'Write my template' }).click();

    // Either the editor appears with the AI warning, or the page says no model is set up (CI has none): then there is nothing to test.
    const written = page.getByText('Written by AI.');
    const noModel = page.getByRole('alert').filter({ hasText: /No AI model is configured|switched off/ });
    await expect(written.or(noModel).first()).toBeVisible({ timeout: 90_000 });
    test.skip(await noModel.first().isVisible(), 'no AI model is configured on this server');

    // The template is not complete until the person who gets the chat, and their number, are filled in.
    const name = `E2E bakery ${stamp}`;
    await page.getByLabel('Template name').fill(name);
    await expect(page.getByText(/This isn.t filled in/)).toBeVisible();
    await page.getByLabel(/Who gets the chat/).selectOption({ index: 1 });
    await page.getByLabel(/Their number/).fill('+91 90000 11111');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // Unanswered questions ask once more; carry on without answering.
    const anyway = page.getByRole('button', { name: 'Save anyway' });
    await anyway.waitFor({ state: 'visible', timeout: 3_000 }).then(() => anyway.click()).catch(() => undefined);
    // A new template is saved and stays open in the editor, under its own address.
    await expect(page).toHaveURL(/\/ai\/t\/[0-9a-f-]{36}/);

    // It is a card on the Templates home. Duplicate adds a copy.
    await page.goto('/ai');
    const card = page.getByRole('article', { name });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    const copy = page.getByRole('article', { name: `${name} (copy)` });
    await expect(copy).toBeVisible();

    // Clean up so the run leaves nothing behind: Delete asks first and moves each to Deleted.
    for (const title of [`${name} (copy)`, name]) {
      const c = page.getByRole('article', { name: title });
      await c.getByRole('button', { name: `More actions for ${title}` }).click();
      await page.getByRole('menuitem', { name: /Delete/ }).click();
      await page.getByRole('alertdialog', { name: 'Delete template' }).getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('article', { name: title })).toHaveCount(0);
    }
  });
});
