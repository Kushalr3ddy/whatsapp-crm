import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/**
 * The Import screen: choosing a file reads it and checks it at once (nothing is saved), an empty file is explained, a file with two
 * columns of numbers asks which to message, and a finished import offers the next step. Numbers are in the +1 202 555 01xx range
 * reserved for fiction.
 */
test.describe('import: flow', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a file with no people in it is explained', async ({ page }) => {
    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `empty-${String(Date.now())}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob,Run${String(Date.now())}\n`)
    });
    await expect(page.getByText(/no rows to import/)).toBeVisible();
  });

  test('checks a file the moment it is chosen, imports it, and offers what to do next', async ({ page }) => {
    const stamp = String(Date.now());
    const n = Number(stamp.slice(-2)) % 30;
    const file = `flow-${stamp}.csv`;
    // 0300 to 0329: clear of the seeded people (0120-0139), see R-009.
    const csv = `Name,Mob,City\nFlow One,+1202555${String(300 + n).padStart(4, '0')},Pune${stamp}\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });

    // The check starts by itself: nothing is saved yet, and there is no Preview step.
    await expect(page.getByText('1 person ready to import')).toBeVisible();
    await expect(page.getByText('Nothing is saved yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
    await expect(page.getByText(file).first()).toBeVisible();
    // The tag is named after the file.
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue(`flow-${stamp}`);

    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible();
    await expect(page.getByRole('link', { name: /Start a campaign|Link a number first/ })).toBeVisible();

    // The way on: the file is under Earlier files, and Message them opens New campaign with it picked.
    await page.goto('/import');
    await page.locator('.im-it', { hasText: file }).getByRole('link', { name: 'Message them' }).click();
    await expect(page).toHaveURL(/\/broadcast\/new\?import=/);
    await expect(page.locator('.nc-chosen .nc-pill')).toHaveCount(1);
  });

  test('the tag is required: no import without a name for it, and the name is on the button row', async ({ page }) => {
    const stamp = String(Date.now());
    const n = Number(stamp.slice(-2)) % 30;
    // 0400 to 0429: clear of the other import specs' blocks.
    const csv = `Name,Mob,City
Tag One,+1202555${String(400 + n).padStart(4, '0')},Pune${stamp}
`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: `tag-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('1 person ready to import')).toBeVisible();

    // The tag is a card of its own, marked required, filled in from the file name and repeated next to the Import button.
    await expect(page.locator('.im-tagcard')).toContainText('required');
    const tag = page.getByLabel('Tag', { exact: true });
    await expect(tag).toHaveValue(`tag-${stamp}`);
    await expect(page.locator('.im-tagline')).toContainText(`tag-${stamp}`);
    await expect(page.getByRole('button', { name: 'Import 1 person' })).toBeEnabled();

    // Cleared: the import is blocked and the screen says why, in the card and next to the button.
    await tag.fill('   ');
    await expect(page.getByRole('button', { name: 'Import 1 person' })).toBeDisabled();
    await expect(page.locator('#im-tag-note')).toContainText('Give the tag a name before you import');
    await expect(page.locator('.im-tagline')).toContainText('Name the tag to import');

    // Named again: it can go.
    await tag.fill(`named-${stamp}`);
    await expect(page.getByRole('button', { name: 'Import 1 person' })).toBeEnabled();
    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible();
    await expect(page.getByText(`named-${stamp}`).first()).toBeVisible();
  });

  test('two columns of numbers: asks which to message, and joins a first and a last name', async ({ page }) => {
    const stamp = String(Date.now());
    // 0330 to 0389 (and +50, +100): clear of the seeded people (0120-0139), see R-009.
    const base = 330 + (Number(stamp.slice(-3)) % 60);
    const file = `join-${stamp}.csv`;
    const csv =
      'First Name,Last Name,Phone,Alt Phone,City,Date of Birth\n' +
      // The stamp is in the city so the file's bytes differ on every run: the server refuses a file it has seen before.
      `Anita,Sharma,+1202555${String(base).padStart(4, '0')},+1202555${String(base + 100).padStart(4, '0')},Pune ${stamp},1990-01-01\n` +
      `a,sharma,+1202555${String(base + 50).padStart(4, '0')},,Delhi ${stamp},1991-02-02\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv) });

    // Two columns hold numbers: nothing is checked until the person says which to message. Both is chosen for them.
    await expect(page.getByRole('heading', { name: 'This file has two phone columns' })).toBeVisible();
    await expect(page.getByLabel(/^Both/)).toBeChecked();
    // First and last name columns are found, to be joined.
    await expect(page.locator('#im-name option:checked')).toHaveText('First name + last name, joined');
    await page.getByRole('button', { name: 'Use these' }).click();

    await expect(page.getByText('2 people ready to import')).toBeVisible();
    // How the file was read: the joined name, both number columns, and every other column kept as it is (personal ones included).
    const read = page.locator('.im-read');
    await expect(read).toContainText('First Name + Last Name, joined');
    await expect(read).toContainText('Alt Phone');
    await expect(read).toContainText('2 columns come in as they are');
    await expect(read).toContainText('Date of Birth');
  });
});
