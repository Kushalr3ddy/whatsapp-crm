import { test, expect } from '@playwright/test';
import { signIn, nav, CREDS_MISSING, fillNewCampaign, createDraft } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const TAG = 'e2e-flow';
// A rotating corner of the fiction range (0200 to 0299) that no other spec or seed uses. One fixed
// contact eventually has history, and the 14-day cooldown gate then skips it on start: the campaign
// completes by itself and there is nothing left to cancel. A recipient with no history never is.
const PHONE = `+1202555${String(200 + (Date.now() % 100)).padStart(4, '0')}`;

/**
 * Sign in → create a broadcast in the UI → start it → see it running → cancel it.
 *
 * Nothing real can be sent: the number made here is never linked, so the gateway has no socket to
 * send through and anything queued just waits (and is cancelled at the end). The fixtures it needs
 * — a number, a tag, one contact — go in through the API with fixed names, so a re-run reuses them
 * instead of piling up rows.
 */
test.describe('the broadcast flow, in the browser', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('create a broadcast from a tag, start it, then cancel it', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const get = async <T>(path: string): Promise<T> =>
      ((await (await page.request.get(`${API}${path}`, { headers })).json()) as { data: T }).data;

    // Fixtures, idempotent.
    const senders = await get<Array<{ id: string; label: string }>>('/senders');
    if (!senders.some((s) => s.label === SENDER)) {
      await page.request.post(`${API}/senders`, { headers, data: { label: SENDER, provider: 'baileys' } });
    }
    const tags = await get<Array<{ id: string; name: string }>>('/tags');
    let tagId = tags.find((t) => t.name === TAG)?.id;
    if (tagId === undefined) {
      tagId = ((await (await page.request.post(`${API}/tags`, { headers, data: { name: TAG } })).json()) as
        { data: { id: string } }).data.id;
    }
    const made = await page.request.post(`${API}/contacts`, {
      headers, data: { displayName: 'E2E Flow Person', phone: PHONE }
    });
    const contactId = made.status() === 201
      ? ((await made.json()) as { data: { id: string } }).data.id
      : ((await made.json()) as { existingContactId: string }).existingContactId;
    await page.request.post(`${API}/contacts/${contactId}/tags`, { headers, data: { tagId } });

    // The flow itself, through the UI.
    await nav(page).getByRole('link', { name: 'Campaigns', exact: true }).click();
    await page.goto('/broadcast/new');
    const name = `E2E flow ${String(Date.now())}`;
    // Option labels carry suffixes (phone, status, contact count), so match on the visible text.
    await fillNewCampaign(page, { name, body: 'Hi {{name}}, this is an e2e test.', sender: SENDER, tag: TAG });
    await createDraft(page);

    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText(/Draft/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText(/Running/i).first()).toBeVisible();

    // Leave nothing running.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible();
  });
});
