import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING, fillNewCampaign, createDraft } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const TAG = 'e2e-campaigns-list';
const PHONE = `+1202555${String(400 + (Date.now() % 100)).padStart(4, '0')}`;

/**
 * The Campaigns list after the redesign: campaigns in groups, each row with its date, how many people, the sending number and the
 * start of the message, and a row opening that campaign.
 *
 * A draft is made and left as it is (nothing is sent from a draft), so a re-run only adds one more draft to the list.
 */
test.describe('the campaigns list, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a draft is listed in its group, with a readable date, and opens its campaign', async ({ page }) => {
    test.setTimeout(60_000);
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
      tagId = ((await (await page.request.post(`${API}/tags`, { headers, data: { name: TAG } })).json()) as
        { data: { id: string } }).data.id;
    }
    const made = await page.request.post(`${API}/contacts`, { headers, data: { displayName: 'E2E List Person', phone: PHONE } });
    const contactId = made.status() === 201
      ? ((await made.json()) as { data: { id: string } }).data.id
      : ((await made.json()) as { existingContactId: string }).existingContactId;
    await page.request.post(`${API}/contacts/${contactId}/tags`, { headers, data: { tagId } });

    await page.goto('/broadcast/new');
    const name = `E2E campaigns list ${String(Date.now())}`;
    await fillNewCampaign(page, { name, body: 'Hi {{name}}, this is the campaigns list e2e.', sender: SENDER, tag: TAG });
    await createDraft(page);
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);

    await page.goto('/broadcast');
    await expect(page.getByRole('heading', { name: 'Campaigns', level: 1 })).toBeVisible();
    const drafts = page.getByRole('region', { name: 'Drafts' });
    const row = drafts.getByRole('link', { name: new RegExp(`^${name}`) });
    await expect(row).toBeVisible();

    // The meta line: a date with the month as a word and no seconds, the people count and the sending number.
    await expect(row).toContainText(/Created \d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (am|pm)/);
    await expect(row).toContainText(/\d+\s+(person|people)/);
    await expect(row).toContainText(`from ${SENDER}`);
    // The fill-in in the message start is a chip, not raw brackets.
    await expect(row).not.toContainText('{{');

    // A draft has its own Edit link on the row, to the screen with the draft's values.
    const edit = drafts.getByRole('link', { name: `Edit ${name}` });
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page).toHaveURL(/\/broadcast\/new[?]edit=[0-9a-f-]{36}/);
    await expect(page.locator('#nc-nm')).toHaveValue(name);
    await page.goBack();

    await row.click();
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });
});
