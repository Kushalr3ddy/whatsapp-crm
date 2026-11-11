import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING, createDraft } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const TAG = 'e2e-new-campaign';
const STAMP = String(Date.now() % 10_000).padStart(4, '0');

/**
 * The New campaign screen: the review panel follows what is typed and picked, the fill-in table lists the columns of the chosen people,
 * a missing name reads "there", and the draft is made from the picks. A draft is made and left as it is (nothing is sent from a draft).
 */
test.describe('the new campaign screen, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('the review follows the picks, the fill-in table lists the columns, and the draft is created', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const get = async <T>(path: string): Promise<T> =>
      ((await (await page.request.get(`${API}${path}`, { headers })).json()) as { data: T }).data;

    const senders = await get<Array<{ label: string }>>('/senders');
    if (!senders.some((s) => s.label === SENDER)) {
      await page.request.post(`${API}/senders`, { headers, data: { label: SENDER, provider: 'baileys' } });
    }
    const tags = await get<Array<{ id: string; name: string }>>('/tags');
    let tagId = tags.find((t) => t.name === TAG)?.id;
    if (tagId === undefined) {
      tagId = ((await (await page.request.post(`${API}/tags`, { headers, data: { name: TAG } })).json()) as { data: { id: string } }).data.id;
    }
    for (const [i, name] of ['E2E Screen One', 'E2E Screen Two'].entries()) {
      const made = await page.request.post(`${API}/contacts`, { headers, data: { displayName: name, phone: `+1202555${STAMP.slice(0, 2)}${String(i)}${STAMP.slice(2)}`.slice(0, 12) } });
      const id = made.status() === 201
        ? ((await made.json()) as { data: { id: string } }).data.id
        : ((await made.json()) as { existingContactId: string }).existingContactId;
      await page.request.post(`${API}/contacts/${id}/tags`, { headers, data: { tagId } });
    }

    await page.goto('/broadcast/new');
    const review = page.getByRole('complementary', { name: 'Review' });
    await expect(review.getByText('Choose who it goes to').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    // Name and message; the preview shows the message as WhatsApp does, with the markers read.
    const name = `E2E new campaign ${String(Date.now())}`;
    await page.locator('#nc-nm').fill(name);
    await page.locator('#nc-body').fill('Hi {{name}}, *this* is _the_ new campaign e2e.');
    await expect(review.locator('.nc-who').first()).toContainText(name);

    // Pick a tag: the review counts the people, and the table under it lists the columns.
    await page.getByRole('button', { name: 'A tag', exact: true }).click();
    await page.locator('#nc-aq').click();
    await page.getByRole('option', { name: new RegExp(TAG) }).click();
    await expect(review.getByText('people it reaches')).toBeVisible();
    await expect(review.locator('b', { hasText: /E2E Screen/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Fill-ins from your file/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: '{{name}}' })).toBeVisible();
    await expect(review.locator('.nc-bub b', { hasText: 'this' })).toBeVisible();

    // A key that is not a column stops the draft and names the closest one.
    await page.locator('#nc-body').fill('Hi {{nam}}');
    await expect(page.getByText(/No column called/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    await page.locator('#nc-body').fill('Hi {{name}}, the new campaign e2e.');

    await page.locator('.nc-opt', { hasText: SENDER }).first().click();
    await createDraft(page);
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('a draft can be edited: Edit opens the screen with its values, and saving changes the same draft', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const get = async <T>(path: string): Promise<T> =>
      ((await (await page.request.get(`${API}${path}`, { headers })).json()) as { data: T }).data;
    const senders = await get<Array<{ id: string; label: string }>>('/senders');
    let sender = senders.find((s) => s.label === SENDER)?.id;
    if (sender === undefined) {
      sender = ((await (await page.request.post(`${API}/senders`, { headers, data: { label: SENDER, provider: 'baileys' } })).json()) as { data: { id: string } }).data.id;
    }
    const tags = await get<Array<{ id: string; name: string }>>('/tags');
    let tagId = tags.find((t) => t.name === TAG)?.id;
    if (tagId === undefined) {
      tagId = ((await (await page.request.post(`${API}/tags`, { headers, data: { name: TAG } })).json()) as { data: { id: string } }).data.id;
    }
    const made = await page.request.post(`${API}/contacts`, { headers, data: { displayName: 'E2E Edit Person', phone: `+1202555${STAMP.slice(0, 2)}9${STAMP.slice(2)}`.slice(0, 12) } });
    const contactId = made.status() === 201
      ? ((await made.json()) as { data: { id: string } }).data.id
      : ((await made.json()) as { existingContactId: string }).existingContactId;
    await page.request.post(`${API}/contacts/${contactId}/tags`, { headers, data: { tagId } });

    const name = `E2E edit ${String(Date.now())}`;
    const id = ((await (await page.request.post(`${API}/campaigns`, {
      headers, data: { name, body: 'Hi {{name}}, before the edit.', senderIdentityId: sender, targets: [{ kind: 'tag', id: tagId }] }
    })).json()) as { data: { id: string } }).data.id;

    await page.goto(`/broadcast/${id}`);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/broadcast/new[?]edit=${id}`));
    await expect(page.getByRole('heading', { name: 'Edit draft', level: 1 })).toBeVisible();
    await expect(page.locator('#nc-nm')).toHaveValue(name);
    await expect(page.locator('#nc-body')).toHaveValue('Hi {{name}}, before the edit.');
    await expect(page.locator('.nc-pill', { hasText: TAG })).toBeVisible();

    await page.locator('#nc-body').fill('Hi {{name}}, after the edit.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/broadcast/${id}`));
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(page.getByText('Hi {{name}}, after the edit.')).toBeVisible();
  });

  test('Draft with AI is gone: nothing on the screen offers it', async ({ page }) => {
    await signIn(page);
    await page.goto('/broadcast/new');
    await expect(page.getByLabel('Write with AI', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use a template' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Draft with AI|Write with AI/ })).toHaveCount(0);
  });
});
