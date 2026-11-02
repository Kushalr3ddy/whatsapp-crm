import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING, fillNewCampaign, createDraft } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const TAG = 'e2e-campaign-page';
const PERSON = 'E2E Page Person';
// Its own corner of the fiction range (0300 to 0399), so no other spec or seed shares the contact and its 14-day history.
const PHONE = `+1202555${String(300 + (Date.now() % 100)).padStart(4, '0')}`;
const BODY = 'Hi {{name}}, this is the campaign page e2e.';

/**
 * The campaign page after the redesign: the progress card, the status chips, and a recipient row that opens
 * that person's chat in a side panel without leaving the campaign.
 *
 * Nothing real is sent: the number made here is never linked, so the message just waits in the queue and the
 * campaign is cancelled at the end. Fixtures go in through the API with fixed names so a re-run reuses them.
 */
test.describe('the campaign page, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('progress, status chips and the chat side panel', async ({ page }) => {
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
      tagId = ((await (await page.request.post(`${API}/tags`, { headers, data: { name: TAG } })).json()) as
        { data: { id: string } }).data.id;
    }
    const made = await page.request.post(`${API}/contacts`, { headers, data: { displayName: PERSON, phone: PHONE } });
    const contactId = made.status() === 201
      ? ((await made.json()) as { data: { id: string } }).data.id
      : ((await made.json()) as { existingContactId: string }).existingContactId;
    await page.request.post(`${API}/contacts/${contactId}/tags`, { headers, data: { tagId } });

    // Make the draft and start it, through the screens a person would use.
    await page.goto('/broadcast/new');
    const name = `E2E campaign page ${String(Date.now())}`;
    await fillNewCampaign(page, { name, body: BODY, sender: SENDER, tag: TAG });
    await createDraft(page);
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText(/Running/i).first()).toBeVisible();

    // The header: a breadcrumb back to the list, the name, and the status pill.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Campaigns' })).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // The progress card says how many were reached, out of how many.
    const progress = page.getByRole('region', { name: 'Progress' });
    await expect(progress).toContainText('Reached');
    await expect(progress.getByRole('progressbar', { name: 'Campaign progress' })).toBeVisible();

    // The status chips filter the list below and mark the active one.
    const show = page.getByRole('group', { name: 'Show' });
    await expect(show.getByRole('link', { name: /^Everyone/ })).toHaveAttribute('aria-current', 'true');
    await show.getByRole('link', { name: /^Queued/ }).click();
    await expect(page).toHaveURL(/status=queued/);
    await expect(page.getByRole('group', { name: 'Show' }).getByRole('link', { name: /^Queued/ })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('group', { name: 'Show' }).getByRole('link', { name: /^Everyone/ }).click();
    await expect(page).not.toHaveURL(/status=/);

    // A recipient row opens their chat beside the list; the campaign page stays where it is.
    const campaignUrl = page.url();
    await page.getByRole('button', { name: new RegExp(PERSON) }).click();
    const panel = page.getByRole('dialog', { name: `Chat with ${PERSON}` });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('this is the campaign page e2e');
    await expect(panel.getByRole('textbox', { name: 'Write a reply' })).toBeVisible();
    expect(page.url()).toBe(campaignUrl);

    // Esc closes it at once and puts focus back on the row.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: new RegExp(PERSON) })).toBeFocused();

    // Leave nothing running.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible();
  });
});
