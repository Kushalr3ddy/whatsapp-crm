import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * The pages that had no browser coverage — inbox, contacts, import, numbers, saved audiences —
 * driven against the working set `npm run local:seed` creates (CI runs the seed before this).
 * Everything that changes state puts it back, so a re-run starts from the same place.
 */
test.describe('seeded pages', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('[R-009] inbox: filters, opening a thread, a note, resolve and reopen', async ({ page }) => {
    await signIn(page);
    await page.goto('/inbox');
    // Thread links, found by their href so the locator survives the list changing under a filter.
    const thread = (name: RegExp) => page.locator('a[href^="/inbox/"]').filter({ hasText: name });

    // Open view: the unread and the assigned thread; the closed one is archived.
    await expect(thread(/Asha Rao/)).toBeVisible();
    await expect(thread(/Bilal Khan/)).toBeVisible();
    await expect(thread(/Chitra Nair/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Closed', exact: true }).click();
    await expect(thread(/Chitra Nair/)).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    // "Mine" is the seed admin's own assigned thread only.
    await page.getByRole('button', { name: 'Mine', exact: true }).click();
    await expect(thread(/Bilal Khan/)).toBeVisible();
    await expect(thread(/Asha Rao/)).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // Open the unread thread: the message is there, and a note is kept for the team.
    await thread(/Asha Rao/).click();
    await expect(page.getByText('unread thread — are you open tomorrow?')).toBeVisible();
    await page.getByRole('button', { name: 'Note', exact: true }).click();
    const note = `e2e note ${String(Date.now())}`;
    await page.getByPlaceholder('Add an internal note').fill(note);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText(note)).toBeVisible();

    // An admin brings a colleague onto the chat and takes them off again.
    // Relative, not absolute, so a participant left behind by an earlier interrupted run cannot
    // make this fail forever: pick one person, see exactly one more, then remove that same person.
    const adder = page.getByLabel('Add participant');
    const person = (await adder.locator('option').nth(1).textContent())?.trim() ?? '';
    expect(person).not.toBe('');
    const removeButtons = page.getByRole('button', { name: /^Remove / });
    const before = await removeButtons.count();
    await adder.selectOption({ label: person });
    await expect(removeButtons).toHaveCount(before + 1);
    await page.getByRole('button', { name: `Remove ${person}`, exact: true }).click();
    await expect(removeButtons).toHaveCount(before);

    // Resolve, then put it back.
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
  });

  test('[R-009] contacts: search narrows the list', async ({ page }) => {
    await signIn(page);
    await page.goto('/contacts');
    await page.getByLabel('Search contacts').fill('Farhan');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=Farhan/);
    await expect(page.getByText('Farhan Ali').first()).toBeVisible();
    await expect(page.getByText('Gita Iyer')).toHaveCount(0);
  });

  test('import: a file uploads, maps itself, and previews without writing', async ({ page }) => {
    await signIn(page);
    await page.goto('/import');
    // The server refuses the same bytes twice (content-hash dedup), so each run adds one unique row.
    const csv = readFileSync(resolve('tests/fixtures/import-contacts.csv'), 'utf8').trimEnd();
    const unique = `\nUnique ${String(Date.now())},+9198${String(Date.now()).slice(-8)},u@example.test,Pune\n`;
    await page.locator('input[type="file"]').setInputFiles({
      name: 'import-contacts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv + unique)
    });

    // The phone column is guessed from "Mobile"; the preview reports without committing.
    await expect(page.getByText(/columns/)).toBeVisible();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByText('Preview (nothing written yet)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  });

  test('numbers: the seeded number is listed, with no risk panel', async ({ page }) => {
    await signIn(page);
    await nav(page).getByRole('link', { name: 'Linked numbers', exact: true }).click();
    await expect(page.getByText('Seed number').first()).toBeVisible();
    await expect(page.getByText(/^(Linked|Linking…|Not linked)$/).first()).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Risk score' })).toHaveCount(0);
  });

  test('saved audiences: the seeded audience is listed', async ({ page }) => {
    await signIn(page);
    await page.goto('/segments');
    await expect(page.getByRole('heading', { name: 'Saved audiences' })).toBeVisible();
    await expect(page.getByText('Seed — replied').first()).toBeVisible();
  });
});
