import { test, expect } from '@playwright/test';
import { signIn, openDetails, CREDS_MISSING } from './helpers';

/**
 * Contacts tag handling from the alpha-testing feedback: a tag chip (a small rounded label with the tag's name) filters and says where to go next, "No tag"
 * explains itself, and removing a tag asks first. Numbers are in the +1 202 555 02xx range reserved for fiction.
 */
test.describe('contacts: tags', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('filter by a tag, be offered a campaign, confirm before removing, and explain "No tag"', async ({ page }) => {
    const stamp = String(Date.now());
    const tag = `chip-${stamp}`;
    const n = Number(stamp.slice(-2)) % 45;
    const csv = `Name,Mob\nChip One,+1202555${String(290 - n).padStart(4, '0')}\n`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: `${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText(/rows ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/✓ Imported/)).toBeVisible();

    // 1. The chip filters, is marked as current, and a campaign is offered.
    await page.goto('/contacts');
    await page.getByRole('link', { name: new RegExp(tag) }).first().click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByRole('link', { name: new RegExp(tag) }).first()).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('region', { name: 'Next step' })).toContainText('Ready to message');
    await page.getByRole('link', { name: 'Start a new campaign' }).click();
    await expect(page).toHaveURL(/\/broadcast\/new\?tag=/);
    await expect(page.locator('select[name="fromTagId"]')).not.toHaveValue('');

    // 2. Removing the tag asks first; "Keep it" leaves it, "Yes, remove" takes it off.
    await page.goBack();
    const chip = page.getByRole('button', { name: new RegExp(`^${tag}`) }).first();
    await chip.click();
    await expect(page.getByText(/Are you sure\?/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(chip).toBeVisible();
    await chip.click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByText('Chip One').first()).toBeHidden();

    // 3. "No tag" writes nothing and says what that means.
    await page.goto('/contacts');
    await openDetails(page, 'Tag many at once');
    await page.getByLabel('Tag to apply').selectOption({ label: 'No tag' });
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/You chose “No tag”/)).toBeVisible();
  });
});
