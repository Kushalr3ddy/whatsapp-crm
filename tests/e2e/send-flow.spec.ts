import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * A broadcast that really goes through the engine and out the other side.
 *
 * Needs the gateway running with `GATEWAY_CHANNEL=fake` and the seeded number
 * (`npm run local:seed`): the fake channel "sends" in memory, so nothing real leaves the machine,
 * but pacing, gates, dispatch and the status round-trip all run. It skips itself when that number is
 * not connected, so a stack without the fake gateway still passes.
 *
 * Run the gateway with the day/night and typing behaviours off so the test does not depend on the
 * clock: `SEND_CIRCADIAN=false SEND_RECIPIENT_TIMEZONE=false SEND_TYPING_SIMULATION=false`
 * and `GATEWAY_SWEEP_SECONDS=3` so the dispatch and reconcile sweeps do not each wait a minute.
 * One brand-new person per run: a stranger counts against the number's new-contact allowance (5 a day
 * until people reply), so `npm run local:seed -- --reset` then a re-seed starts a clean day.
 */
test.describe('sending, end to end on the fake number', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('a started broadcast is delivered to a new contact', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const json = async <T>(r: Awaited<ReturnType<typeof page.request.get>>): Promise<T> =>
      ((await r.json()) as { data: T }).data;

    const senders = await json<Array<{ id: string; label: string; connectionState: string | null }>>(
      await page.request.get(`${API}/senders`, { headers }));
    const seeded = senders.find((s) => s.label === 'Seed number');
    test.skip(seeded === undefined || seeded.connectionState !== 'open',
      'needs the seeded number connected: run the gateway with GATEWAY_CHANNEL=fake after `npm run local:seed`');

    // One brand-new contact, so the duplicate-campaign / cooldown gates have no history to block on.
    const phone = `+1202555${String(180 + (Date.now() % 20)).padStart(4, '0')}`;
    const made = await page.request.post(`${API}/contacts`, {
      headers, data: { displayName: 'E2E Send Person', phone }
    });
    // The fiction range is small, so a re-run can land on a number already used: reuse that contact.
    expect([201, 409]).toContain(made.status());
    const contactId = made.status() === 201
      ? (await json<{ id: string }>(made)).id
      : ((await made.json()) as { existingContactId: string }).existingContactId;

    const campaign = await json<{ id: string }>(await page.request.post(`${API}/campaigns`, {
      headers, data: {
        name: `E2E send ${String(Date.now())}`, body: '{Hi|Hello} {{name}}, an end-to-end test.',
        senderIdentityId: seeded!.id, explicitContactIds: [contactId]
      }
    }));
    const started = await page.request.post(`${API}/campaigns/${campaign.id}/start`, { headers, data: {} });
    expect(started.status()).toBeLessThan(300);

    // Dispatch, send and reconcile happen on the gateway's sweeps; wait for the recipient to settle.
    await expect.poll(async () => {
      const rows = await json<Array<{ status: string }>>(
        await page.request.get(`${API}/campaigns/${campaign.id}/recipients`, { headers }));
      return rows[0]?.status ?? 'none';
    }, { timeout: 90_000, intervals: [2_000] }).toMatch(/^(sent|delivered|read)$/);

    // And the page agrees.
    await page.goto(`/broadcast/${campaign.id}`);
    await expect(page.getByText('E2E Send Person').first()).toBeVisible();
  });
});
