import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * AI templates: describe in plain words, the AI writes the instructions, review (locked until edited by hand, with the
 * always-on rules shown), save, and pick the template again. Needs the assistant switched on (the ai-assistant spec does that)
 * and a model configured; with either missing it skips instead of failing.
 */
test.describe('ai templates', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('describe, review, save, and pick it again', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await page.goto('/ai');
    const box = page.getByLabel('Your description');
    test.skip(!(await box.isVisible()), 'the assistant is off in this organisation');

    const stamp = String(Date.now());
    await box.fill(`I run a small bakery called Crumb ${stamp}. Message people about the new sourdough on Friday and answer questions about opening hours, 8 to 6.`);
    await page.getByRole('button', { name: 'Write the instructions' }).click();

    // Either the review section appears, or the page says no model is set up (CI has none): then there is nothing to test.
    const written = page.getByText(/Written by AI/);
    const noModel = page.getByRole('alert').filter({ hasText: /No AI model is configured|switched off/ });
    await expect(written.or(noModel).first()).toBeVisible({ timeout: 90_000 });
    test.skip(await noModel.first().isVisible(), 'no AI model is configured on this server');

    // The review section shows the AI warning, locked instructions and the always-on rules.
    await expect(written).toBeVisible();
    const instructions = page.getByLabel(/Instructions for the AI/);
    await expect(instructions).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Always added automatically')).toContainText('untrusted');

    // Editing by hand asks first.
    await page.getByRole('button', { name: 'Edit by hand' }).click();
    await expect(page.getByText(/behave differently from what you described/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep it locked' }).click();
    await expect(instructions).toHaveAttribute('readonly', '');

    // A changed description stops saving until the instructions are written again.
    await box.fill(`${await box.inputValue()} Also open Sundays.`);
    await expect(page.getByRole('button', { name: 'Save as a template' })).toBeDisabled();
    await expect(page.getByText(/Write the instructions again before saving/)).toBeVisible();
    await box.fill((await box.inputValue()).replace(' Also open Sundays.', ''));
    await expect(page.getByRole('button', { name: 'Save as a template' })).toBeEnabled();

    const name = `E2E bakery ${stamp}`;
    await page.getByLabel('Template name').fill(name);
    await page.getByRole('button', { name: 'Save as a template' }).click();
    // Saving moves to the template's own page, which has "What next?".
    await expect(page).toHaveURL(/\/ai\/t\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: 'What next?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Let it answer all chats' })).toBeVisible();

    // "Message a group": the audience is a search whose people get a new, editable, auto-named tag; a draft is made, never started.
    await page.getByRole('button', { name: 'Message a group with this' }).click();
    const group = page.getByRole('region', { name: 'Message a group' });
    await expect(group).toBeVisible();
    await group.getByLabel('Campaign name').fill(`E2E group ${stamp}`);
    await group.getByLabel('First message').fill('Hi {{name}}, fresh sourdough on Friday.');
    await group.getByLabel('Send from').selectOption({ index: 1 });
    await group.getByLabel('Everyone a search finds (they get a new tag)').check();
    // The tag name is offered with the template's name, a number and the date, and can be changed.
    const tagInput = group.getByLabel(/Tag for these people/);
    await expect(tagInput).toHaveValue(new RegExp(`^E2E bakery ${stamp}-1 \\(`));
    const tagName = `e2e group tag ${stamp}`;
    await tagInput.fill(tagName);
    await group.getByLabel('Search', { exact: true }).fill('Farhan');
    await expect(group.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    await group.getByRole('button', { name: 'Check how many' }).click();
    await expect(group.getByRole('status')).toBeVisible();
    if (!(await group.getByText('No one matches.').isVisible())) {
      await group.getByRole('button', { name: 'Create draft' }).click();
      await expect(group.getByText(/Draft created/)).toBeVisible();
      await group.getByRole('link', { name: 'Open it' }).click();
      await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    }

    // It is in the saved list, and opening it puts both boxes back.
    await page.goto('/ai');
    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByLabel('Your description')).toHaveValue(new RegExp(`Crumb ${stamp}`));

    // Clean up so the run leaves nothing behind.
    page.once('dialog', (d) => { void d.accept(); });
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  });
});
