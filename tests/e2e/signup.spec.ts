import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const BOOTSTRAP = process.env.API_KEY ?? '';

/**
 * Self-service signup and the payment gate, through the real UI: sign up → held on Billing (unpaid) →
 * an operator waives payment (the beta-tester override) → "Check again" lets them into the app.
 *
 * Needs the API started with `SIGNUP_ENABLED=true` and the bootstrap `API_KEY` in `.env`; it skips
 * itself otherwise. Each run signs up a brand-new org, so nothing is shared with other specs.
 */
test.describe('signup and the billing gate', () => {
  test('a new account is held on Billing until an operator waives payment', async ({ page, request }) => {
    const cfg = await request.get(`${API}/auth/config`).then((r) => r.json()).catch(() => null) as
      { data?: { signupEnabled?: boolean } } | null;
    test.skip(cfg?.data?.signupEnabled !== true, 'start the API with SIGNUP_ENABLED=true');
    test.skip(BOOTSTRAP === '', 'API_KEY (the bootstrap key) must be in .env');

    const stamp = String(Date.now());
    const email = `signup-${stamp}@example.test`;

    // The sign-in page offers it, and the form validates before it calls the API.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByLabel('Organisation name').fill(`Signup Org ${stamp}`);
    await page.getByLabel('Your name').fill('Sign Up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
    await page.getByLabel('Confirm password').fill('a-different-password-x');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();

    // A valid signup lands on Billing, unpaid.
    // The names survive the failed submit; the passwords are asked for again.
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
    await page.getByLabel('Confirm password').fill('a-long-enough-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/billing/);
    await expect(page.getByRole('status')).toContainText('Payment is required');

    // Anywhere else in the app bounces back to Billing.
    await page.goto('/contacts');
    await expect(page).toHaveURL(/\/billing/);

    // The operator waives payment for this org (found by the admin's own email → org).
    const me = await page.request.get(`${API}/auth/me`, {
      headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') }
    });
    const orgId = ((await me.json()) as { data: { orgId: string } }).data.orgId;
    const waived = await request.put(`${API}/admin/orgs/${orgId}/billing`, {
      headers: { Authorization: `Bearer ${BOOTSTRAP}` },
      data: { status: 'exempt', note: 'e2e beta tester' }
    });
    expect(waived.status()).toBe(200);

    // Now they are let in.
    await page.getByRole('link', { name: 'Check again' }).click();
    await expect(page.getByRole('status')).toContainText('without payment');
    await page.getByRole('link', { name: 'Continue to the app' }).click();
    await page.goto('/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
