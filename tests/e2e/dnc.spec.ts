import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const PHONE = '+12025550102';
const NAME = 'E2E DNC Person';

/** Flagging a contact do-not-contact from the Contacts page, and clearing it again. */
test.describe('do-not-contact', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('an operator flags a contact, sees the badge, and clears it', async ({ page }) => {
    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const made = await page.request.post(`${API}/contacts`, { headers, data: { displayName: NAME, phone: PHONE } });
    const id = made.status() === 201
      ? ((await made.json()) as { data: { id: string } }).data.id
      : ((await made.json()) as { existingContactId: string }).existingContactId;
    // Start from a known state, whatever a previous run left.
    await page.request.put(`${API}/contacts/${id}/do-not-contact`, { headers, data: { value: false } });

    await page.goto(`/contacts?q=${encodeURIComponent(PHONE)}`);
    const row = page.locator('li', { hasText: NAME });
    await row.getByRole('button', { name: 'Do not contact', exact: true }).click();
    await expect(page.locator('li', { hasText: NAME }).getByText('do not contact', { exact: true })).toBeVisible();

    await page.locator('li', { hasText: NAME }).getByRole('button', { name: 'Allow contact' }).click();
    await expect(page.locator('li', { hasText: NAME }).getByRole('button', { name: 'Do not contact', exact: true })).toBeVisible();
  });
});
