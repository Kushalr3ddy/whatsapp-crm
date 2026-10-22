import { test, expect } from '@playwright/test';
import { CREDS_MISSING, signIn, openDetails } from './helpers';

/**
 * R-008 (2026-10-22, area: web-ui, found by: flaky CI, repro loop)
 * What broke: a server action that redirects to the same page could leave the content blank on a production build. The root loading.tsx
 * (a Suspense boundary) plus a slow, heavy target page stalled Next's client router: the address changed but the page never drew.
 *
 * "Tag many at once" with "No tag" chosen is a same-page redirect (/contacts?bulkError=no_tag), so it is the probe: five tries in a row,
 * each must show the explanation within 8 seconds. It only means something on a production build (npm run regress), which is what @smoke runs on.
 */
test.skip(CREDS_MISSING, 'TEST_EMAIL / TEST_PASSWORD are not set');

test('[R-008] @smoke a same-page redirect from Contacts always shows its result on a production build', async ({ page }) => {
  await signIn(page);
  for (let i = 0; i < 5; i++) {
    await page.goto('/contacts');
    await page.waitForLoadState('networkidle');
    await openDetails(page, 'Tag many at once');
    await page.getByLabel('Tag to apply').selectOption({ label: 'No tag' });
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await expect(page.getByText(/You chose “No tag”/)).toBeVisible({ timeout: 8_000 });
  }
});
