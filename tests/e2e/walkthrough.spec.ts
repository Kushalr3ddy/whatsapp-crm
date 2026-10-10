import { test, expect } from '@playwright/test';
import { signIn, nav, openDetails, CREDS_MISSING } from './helpers';

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
      ['Broadcast', 'Broadcast'],
      ['Numbers', 'Numbers']
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
    await openDetails(page, /^New tag/);
    await page.getByPlaceholder('New tag name…').fill(tag);
    await page.getByRole('button', { name: 'Add tag' }).click();
    // The tag chip's accessible name also carries its contact count, so match by substring.
    await expect(page.getByRole('link', { name: tag })).toBeVisible();

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
