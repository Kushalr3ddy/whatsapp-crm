import { test, expect } from '@playwright/test';
import { signIn, openContactsFile, CREDS_MISSING } from './helpers';

/**
 * Contacts tag handling: tick people and put a tag on them, look at the tag as a source, see it on the person, and start a campaign
 * aimed at it. Numbers are in the +1 202 555 02xx range reserved for fiction.
 */
test.describe('contacts: tags', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('tag people from the bar, filter by the tag, find it on the person, and aim a campaign at it', async ({ page }) => {
    const stamp = String(Date.now());
    const file = `chip-${stamp}`;
    const tag = `own-${stamp}`;
    const n = Number(stamp.slice(-2)) % 45;
    // A per-run column keeps the bytes unique: the same file twice is (rightly) refused as already imported.
    const csv = `Name,Mob,Batch
Chip One,+1202555${String(290 - n).padStart(4, '0')},${stamp}
`;

    await signIn(page);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({ name: `${file}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('1 person ready to import')).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 person' }).click();
    await expect(page.getByText('1 person is in your contacts')).toBeVisible();

    // The Import screen's own link opens the file's people.
    await page.getByRole('link', { name: /View them in Contacts/ }).click();
    await expect(page.getByText('Showing 1–1 of 1 person')).toBeVisible();

    // 1. Tick the person, make a tag on the way, and see it on the left with one person.
    await openContactsFile(page, `${file}.csv`);
    await page.getByLabel('Select Chip One').check();
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByLabel('Find a tag, or type a new name').fill(tag);
    await page.getByRole('button', { name: new RegExp(`Create tag “${tag}”`) }).click();
    await expect(page.getByText(`Added “${tag}” to 1 person.`)).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${tag}`) }).click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByText('Showing 1–1 of 1 person')).toBeVisible();
    const tagId = new URL(page.url()).searchParams.get('tag') ?? '';

    // 2. The person's panel lists the file's tag first, then theirs.
    await page.getByRole('button', { name: 'Chip One' }).click();
    const panel = page.getByRole('dialog', { name: /Chip One/ });
    await expect(panel.getByText(`${file}, ${tag}`)).toBeVisible();
    await page.keyboard.press('Escape');

    // 3. A campaign can still be aimed at the tag: it is already picked as the audience.
    await page.goto(`/broadcast/new?tag=${tagId}`);
    await expect(page.locator('.nc-chosen .nc-pill')).toHaveCount(1);

    // 4. Taking the tag away asks first.
    await page.goto(`/contacts?tag=${tagId}`);
    await page.getByRole('button', { name: `Delete tag ${tag}` }).click();
    await expect(page.getByRole('alertdialog')).toContainText('It comes off 1 person.');
    await page.getByRole('button', { name: 'Delete tag', exact: true }).click();
    await expect(page.getByText(`Deleted tag “${tag}”.`)).toBeVisible();
  });
});
