import { test, expect } from '@playwright/test';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * The main pages render for a signed-in operator, and the segment builder's live count works — the
 * regression that guards it is real: the "Preview count" button once did nothing because a function
 * form action swallowed its GET submit, so it showed no count. This walks tag → segment → preview.
 */
test.describe('signed-in walkthrough', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('every main page renders', async ({ page }) => {
    await signIn(page);
    for (const [link, heading] of [
      ['Contacts', 'Contacts'],
      ['Import', 'Import contacts'],
      ['Campaigns', 'Campaigns'],
      ['Linked numbers', 'Linked numbers']
    ] as const) {
      await nav(page).getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('build a segment and preview its live count', async ({ page }) => {
    await signIn(page);

    // A fresh tag so the run does not depend on existing data.
    const tag = `e2e-${String(Date.now())}`;
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'New tag' }).click();
    await page.getByLabel('New tag name').fill(tag);
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Tag “${tag}” created.`)).toBeVisible();

    // Build a segment on that tag and preview the count.
    await page.goto('/segments');
    await page.locator('select[name="tagId"]').selectOption({ label: tag });
    await page.getByRole('button', { name: 'Preview count' }).click();

    // The regression guard: the GET must fire (query in the URL) and a count must show.
    await expect(page).toHaveURL(/tagId=/);
    await expect(page.getByText(/match now/)).toBeVisible();

    // And it can be saved, appearing in the list.
    const name = `Seg ${tag}`;
    await page.locator('input[name="name"]').fill(name);
    await page.getByRole('button', { name: 'Save segment' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });
});
