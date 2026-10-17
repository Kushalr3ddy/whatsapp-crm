import { test, expect } from '@playwright/test';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * The two things an admin used to need a terminal for: adding a WhatsApp number, and managing the
 * team. Both done through the screens alone. Everything created is named `e2e-…` so it is obvious
 * test data.
 */
test.describe('add a number and manage the team, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('an admin adds a number from the Numbers page and gets a Link button for it', async ({ page }) => {
    const label = `e2e-number-${String(Date.now())}`;
    await signIn(page);
    await nav(page).getByRole('link', { name: 'Linked numbers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Linked numbers', exact: true })).toBeVisible();
    // No terminal command is asked of anyone any more.
    await expect(page.getByText('npm run gateway')).toHaveCount(0);

    // With numbers already present the button sits in the header; on a fresh install the form is open.
    const open = page.getByRole('button', { name: 'Add a number', exact: true });
    const form = page.getByRole('form', { name: 'Add a number' });
    await expect(open.or(form)).toBeVisible();
    if (await open.isVisible()) await open.click();
    await form.getByLabel('Name').fill(label);
    await form.getByRole('button', { name: 'Add number' }).click();

    const card = page.locator('li', { hasText: label });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Link this number' })).toBeVisible();
  });

  test('a number needs a name, and a phone must carry its country code', async ({ page }) => {
    await signIn(page);
    await page.goto('/link');
    const open = page.getByRole('button', { name: 'Add a number', exact: true });
    const form = page.getByRole('form', { name: 'Add a number' });
    await expect(open.or(form)).toBeVisible();
    if (await open.isVisible()) await open.click();
    await form.getByLabel('Name').fill(`e2e-bad-${String(Date.now())}`);
    await form.getByLabel('Phone number (optional)').fill('98765');
    await form.getByRole('button', { name: 'Add number' }).click();
    await expect(form.getByRole('alert')).toContainText('country code');
  });

  test('an admin adds a person, sees the sign-in details once, then disables and re-enables them', async ({ page }) => {
    const stamp = String(Date.now());
    const name = `e2e-person-${stamp}`;
    const email = `e2e-person-${stamp}@example.test`;
    await signIn(page);
    await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add a person' }).click();
    const form = page.getByRole('form', { name: 'Add a person' });
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Email').fill(email);
    await form.getByRole('button', { name: 'Add person' }).click();

    // The generated password is shown once, with the email, for the admin to pass on.
    const notice = page.getByRole('status').filter({ hasText: 'sign-in details' });
    await expect(notice).toContainText(email);
    await expect(notice).toContainText('Password:');
    await notice.getByRole('button', { name: 'Done' }).click();
    await expect(notice).toHaveCount(0);

    const row = page.locator('li', { hasText: email });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Disable' }).click();
    await expect(row.getByText('Disabled')).toBeVisible();
    await row.getByRole('button', { name: 'Enable' }).click();
    await expect(row.getByText('Disabled')).toHaveCount(0);
  });

  test('your own row can pick a role (the server decides) but cannot disable you', async ({ page }) => {
    await signIn(page);
    await page.goto('/team');
    const me = page.locator('li', { hasText: '(you)' });
    await expect(me).toBeVisible();
    await expect(me.getByRole('button', { name: 'Disable' })).toBeDisabled();
    // Not disabled any more: demoting yourself is allowed while another admin remains, and refused with a
    // message when you are the last one. Not exercised here, because succeeding would demote the test admin.
    await expect(me.getByRole('combobox')).toBeEnabled();
  });
});
