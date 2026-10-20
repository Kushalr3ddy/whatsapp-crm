import { test, expect } from '@playwright/test';
import { signIn, nav, CREDS_MISSING } from './helpers';

/**
 * The two things an admin used to need a terminal for: adding a WhatsApp number, and managing the
 * team. Both done through the screens alone. Everything created is named `e2e-…` so it is obvious
 * test data.
 */
test.describe('add a number and manage the team, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('an admin adds a number by name only and its link starts straight away', async ({ page }) => {
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
    // Only a name is asked for: the phone is picked up when the QR is scanned.
    await expect(form.getByLabel('Phone number (optional)')).toHaveCount(0);
    await form.getByLabel('Name').fill(label);
    await form.getByRole('button', { name: 'Add number' }).click();

    // The page reopens with this number's link already started (no second click on "Link this number").
    await expect(page).toHaveURL(/\/link\?start=/);
    await expect(page.locator('li', { hasText: label })).toBeVisible();
  });

  test('linking with a code asks for the number with a country list and digits only', async ({ page }) => {
    const label = `e2e-code-${String(Date.now())}`;
    await signIn(page);
    await page.goto('/link');
    const open = page.getByRole('button', { name: 'Add a number', exact: true });
    const form = page.getByRole('form', { name: 'Add a number' });
    await expect(open.or(form)).toBeVisible();
    if (await open.isVisible()) await open.click();
    await form.getByLabel('Name').fill(label);
    await form.getByRole('button', { name: 'Add number' }).click();
    await expect(page).toHaveURL(/\/link\?start=/);

    // Open the same card again without the auto-start and choose the code method.
    await page.goto('/link');
    const card = page.locator('li', { hasText: label });
    await card.getByRole('button', { name: 'Type a code' }).click();
    const phone = card.locator('input[inputmode="tel"]');
    await phone.fill('98a-76 b5');
    await expect(phone).toHaveValue('98765');
    await phone.fill('+63 917 123 4567');
    await expect(card.getByLabel('Country code')).toHaveValue('PH');
    await expect(phone).toHaveValue('9171234567');
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
