import { test, expect, type Page } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * Contacts, as designed: pick a file, search, Filters with chips and a live count, tick people, Select all N, Add tag
 * (including Create tag), Undo, delete a tag of your own, Save as a list and open it, Columns, and open a person.
 * Numbers are in the +1 202 555 03xx range reserved for fiction. Each run makes its own file, so it can count exactly.
 */
test.describe('contacts screen', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  /** Imports a file of `n` people named "<tag> Person i" and returns its name. */
  async function importFile(page: Page, tag: string, n: number): Promise<void> {
    const stamp = Number(String(Date.now()).slice(-4));
    const rows = Array.from({ length: n }, (_, i) =>
      `${tag} Person ${String(i + 1).padStart(2, '0')},+1202555${String((stamp + i) % 10000).padStart(4, '0')},${i % 2 === 0 ? `p${String(i)}@${tag}.test` : ''},${i % 3 === 0 ? 'Pune' : 'Mumbai'}`);
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Name,Mob,Email,City\n${rows.join('\n')}\n`)
    });
    // The check starts by itself; the tag is already named after the file, and the import needs it.
    await expect(page.getByText(`${String(n)} people ready to import`)).toBeVisible();
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue(tag);
    await page.getByRole('button', { name: `Import ${String(n)} people` }).click();
    await expect(page.getByText(`${String(n)} people are in your contacts`)).toBeVisible();
  }

  test('a file is a source: pick it, search, filter with a live count, and tag everyone with Select all', async ({ page }) => {
    const tag = `cs-${String(Date.now())}`;
    await signIn(page);
    await importFile(page, tag, 12);

    await page.goto('/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts', level: 1 })).toBeVisible();
    // The file is on the left, with how many people it brought in.
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await expect(page).toHaveURL(/file=/);
    await expect(page.getByText('Showing 1–12 of 12 people')).toBeVisible();
    await expect(page.getByText(`They all carry the tag “${tag}”.`)).toBeVisible();

    // Search covers name, phone and email.
    await page.getByLabel('Search', { exact: true }).fill('Person 03');
    await expect(page.getByText('Showing 1–1 of 1 person')).toBeVisible();
    await page.getByRole('button', { name: 'Remove Search: Person 03' }).click();
    await expect(page.getByText('Showing 1–12 of 12 people')).toBeVisible();

    // A filter shows its live count, becomes a chip, and comes off again.
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('group', { name: 'Email' }).getByRole('button', { name: 'Has one' }).click();
    await expect(page.getByText('6 people match')).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('button', { name: 'Remove Email: has one' })).toBeVisible();
    await expect(page.getByText('Showing 1–6 of 6 people')).toBeVisible();

    // Tick the page, then "Select all 6" tags the filtered set only; Create tag makes the tag on the way.
    await page.getByLabel('Select everyone on this page').check();
    const own = `own-${String(Date.now())}`;
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByLabel('Find a tag, or type a new name').fill(own);
    await page.getByRole('button', { name: new RegExp(`Create tag “${own}”`) }).click();
    await expect(page.getByText(`Added “${own}” to 6 people.`)).toBeVisible();

    // The new tag shows on the left with exactly those 6; Undo takes it off exactly them.
    await page.getByRole('button', { name: new RegExp(`^${own}`) }).click();
    await expect(page.getByText('Showing 1–6 of 6 people')).toBeVisible();
    // Filters stay when the source changes, so clear the email filter to see the whole file.
    await page.locator('.ct-chips').getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await expect(page.getByText('Showing 1–12 of 12 people')).toBeVisible();
    await page.getByLabel('Select everyone on this page').check();
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByLabel('Find a tag, or type a new name').fill(own);
    await page.locator('.ct-menu').getByRole('button', { name: new RegExp(`^${own}`) }).click();
    await expect(page.getByText(`Added “${own}” to 12 people (6 already had it).`)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText(/Took “.*” off 6 people/)).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${own}`) }).click();
    await expect(page.getByText('Showing 1–6 of 6 people')).toBeVisible();

    // Deleting your own tag asks first and says how many people it comes off.
    await page.getByRole('button', { name: `Delete tag ${own}` }).click();
    await expect(page.getByRole('alertdialog')).toContainText('It comes off 6 people.');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: `Delete tag ${own}` }).click();
    await page.getByRole('button', { name: 'Delete tag', exact: true }).click();
    await expect(page.getByText(`Deleted tag “${own}”.`)).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${own}`) })).toHaveCount(0);

    // A file’s own tag has no delete button.
    await expect(page.getByRole('button', { name: new RegExp(`Delete (tag|list) ${tag}`) })).toHaveCount(0);
  });

  test('Save as a list, open it, then a person opens in a side panel with their file and Open chat', async ({ page }) => {
    const tag = `ls-${String(Date.now())}`;
    const listName = `Has email ${tag}`;
    await signIn(page);
    await importFile(page, tag, 6);

    await page.goto('/contacts');
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('group', { name: 'Email' }).getByRole('button', { name: 'Has one' }).click();
    await page.getByRole('button', { name: 'Save as a list' }).first().click();
    await page.getByLabel('List name').fill(listName);
    await page.getByRole('button', { name: 'Save list' }).click();
    await expect(page.getByText(`Saved the list “${listName}”`)).toBeVisible();
    await expect(page).toHaveURL(/list=/);

    // Changing a filter leaves the list: the filter stays, the list no longer describes it.
    await page.getByRole('button', { name: 'Remove Email: has one' }).click();
    await expect(page).not.toHaveURL(/list=/);
    await page.getByRole('button', { name: new RegExp(`^${listName}`) }).click();
    await expect(page).toHaveURL(/list=/);
    await expect(page.getByRole('button', { name: 'Remove Email: has one' })).toBeVisible();

    // A saved list is a filter, not a file: it shows everyone it matches. Go back to the file to find the person.
    await page.locator('.ct-chips').getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await expect(page.getByText('Showing 1–6 of 6 people')).toBeVisible();
    // Open a person: the source file with every column, and Open chat (disabled: nobody has written yet).
    await page.getByRole('button', { name: new RegExp(`${tag} Person 01`) }).click();
    const panel = page.getByRole('dialog', { name: /Person 01/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(`From ${tag}.csv`)).toBeVisible();
    await expect(panel.getByText('Never messaged')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'No chat yet' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Deleting the list says the people stay.
    await page.getByRole('button', { name: `Delete list ${listName}` }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Only the saved filter is deleted.');
    await page.getByRole('button', { name: 'Delete list', exact: true }).click();
    await expect(page.getByText(`Deleted list “${listName}”.`)).toBeVisible();
  });

  test('Columns shows the file’s own columns, hidden until ticked', async ({ page }) => {
    const tag = `cl-${String(Date.now())}`;
    await signIn(page);
    await importFile(page, tag, 4);
    await page.goto('/contacts');
    await page.getByRole('button', { name: new RegExp(`^${tag}.csv`) }).click();
    await expect(page.getByRole('columnheader', { name: 'City' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await expect(page.getByText('Kept from your file, hidden')).toBeVisible();
    await page.getByLabel('City', { exact: true }).check();
    await expect(page.getByRole('columnheader', { name: 'City' })).toBeVisible();
  });

  test('the API refuses to delete a file’s tag', async ({ page }) => {
    const tag = `ft-${String(Date.now())}`;
    await signIn(page);
    await importFile(page, tag, 2);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const tags = await (await page.request.get(`${API}/tags`)).json() as { data: Array<{ id: string; name: string }> };
    const id = tags.data.find((t) => t.name === tag)?.id;
    expect(id).toBeDefined();
    const r = await page.request.delete(`${API}/tags/${String(id)}`, { headers: { 'x-csrf-token': csrf } });
    expect(r.status()).toBe(409);
  });
});
