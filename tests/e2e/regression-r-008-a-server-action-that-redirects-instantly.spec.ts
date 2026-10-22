import { test, expect } from '@playwright/test';
import { CREDS_MISSING, signIn } from './helpers';

/**
 * R-008 (2026-10-22, area: web-ui, found by: flaky CI, repro loop)
 * What broke: A server action that redirects instantly can hang on a production server (Next 15.5.25); workaround: Preview requires a tag
 *
 * Steps to reproduce: <fill in: what you click, what you expected, what happened>
 * Add @smoke to the title if this must also run on a production build in CI.
 */
test.skip(CREDS_MISSING, 'TEST_EMAIL / TEST_PASSWORD are not set');

// Remove `.fixme` once the steps below fail for the right reason, then fix the code and watch it go green.
test.fixme('[R-008] A server action that redirects instantly can hang on a production server (Next 15.5.25); workaround: Preview requires a tag', async ({ page }) => {
  await signIn(page);
  // 1. go to the screen   2. do the thing   3. expect what should happen
  await expect(page).toHaveURL(/./);
});
