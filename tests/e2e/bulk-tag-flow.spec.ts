import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn, CREDS_MISSING, fillNewCampaign, createDraft , openContactsFile } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const CSV = readFileSync(new URL('../fixtures/import-contacts.csv', import.meta.url), 'utf8');

/**
 * The tagging story end to end, in the browser: import a CSV and tag everyone in it at import time,
 * mass-tag everyone matching a filter (preview, then confirm), tag one person by hand, then build a
 * broadcast from the mass tag and start it. Uses the dev test admin; names are unique per run and
 * the broadcast is cancelled at the end, so nothing is left running (the number is never linked, so
 * nothing could be sent anyway).
 */
test.describe('import, mass tag, individual tag, broadcast', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('the whole path', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = String(Date.now());
    const importTag = `e2e-import-${stamp}`;
    const massTag = `e2e-mass-${stamp}`;
    const handTag = `e2e-hand-${stamp}`;

    await signIn(page);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    // A number to send from (never linked), and two empty tags to apply by hand.
    const senders = (await (await page.request.get(`${API}/senders`, { headers })).json() as
      { data: Array<{ label: string }> }).data;
    if (!senders.some((s) => s.label === SENDER)) {
      await page.request.post(`${API}/senders`, { headers, data: { label: SENDER, provider: 'baileys' } });
    }
    for (const name of [massTag, handTag]) {
      await page.request.post(`${API}/tags`, { headers, data: { name } });
    }

    // 1. Import the fixture, tagging everyone in it. A per-run column makes the bytes unique, since
    //    an identical file is (rightly) refused as already imported.
    const lines = CSV.trimEnd().split('\n');
    const unique = [`${lines[0]},Batch`, ...lines.slice(1).map((l) => `${l},${stamp}`)].join('\n') + '\n';
    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: `contacts-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(unique)
    });
    await expect(page.getByText(/rows ·/)).toBeVisible();
    await page.getByLabel('Tag everyone in this file').fill(importTag);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/✓ Imported/)).toBeVisible();
    const summary = (await page.getByText(/tagged “/).textContent()) ?? '';
    const imported = Number(/(\d+) tagged/.exec(summary)?.[1] ?? '0');
    expect(imported).toBeGreaterThan(20);

    // 2. Everyone from the file is on the Contacts screen, picked as a source on the left.
    await openContactsFile(page, `contacts-${stamp}.csv`);
    await expect(page.getByLabel(/^Select /).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Showing 1–${imported} of ${imported} people`))).toBeVisible();

    // 3. Mass-tag everyone the file brought in: tick the page, add the tag, and the toast says how many.
    await page.getByLabel('Select everyone on this page').check();
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByLabel('Find a tag, or type a new name').fill(massTag);
    await page.locator('.ct-menu').getByRole('button', { name: new RegExp(`^${massTag}`) }).click();
    await expect(page.getByText(new RegExp(`Added “${massTag}” to ${imported} people`))).toBeVisible();

    // 4. Tag one person by hand.
    // The list reloads after a tag is added; wait for the ticks to clear before picking one person.
    await expect(page.getByLabel('Select everyone on this page')).not.toBeChecked();
    await page.getByLabel(/^Select (?!everyone)/).first().check();
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByLabel('Find a tag, or type a new name').fill(handTag);
    await page.locator('.ct-menu').getByRole('button', { name: new RegExp(`^${handTag}`) }).click();
    await expect(page.getByText(`Added “${handTag}” to 1 person.`)).toBeVisible();

    // 5. A broadcast from the mass tag: the dry run shows the audience, start, then cancel.
    await page.goto('/broadcast/new');
    const name = `E2E tag broadcast ${stamp}`;
    await fillNewCampaign(page, { name, body: 'Hi {{name}}, a tagged e2e message.', sender: SENDER, tag: massTag });
    await createDraft(page);
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByText(new RegExp(`${imported}`)).first()).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText(/Running/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible();
  });
});
