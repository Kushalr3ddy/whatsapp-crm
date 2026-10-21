import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn, openDetails, CREDS_MISSING } from './helpers';

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

    // 2. Everyone with the import tag is on the contacts page (filter chip).
    await page.goto('/contacts');
    await page.getByRole('link', { name: new RegExp(importTag) }).first().click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByLabel(/^Select /).first()).toBeVisible();

    // 3. Mass-tag everyone matching that filter: preview shows the real count, confirm applies it.
    await openDetails(page, 'Tag many at once');
    await page.getByLabel('Add or remove').first().selectOption('add');
    await page.getByLabel('Tag to apply').selectOption({ label: massTag });
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(new RegExp(`Add tag ${massTag} to ${imported} people`))).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(new RegExp(`Done — ${imported} people added`))).toBeVisible();

    // 4. Tag one person by hand.
    await page.goto('/contacts');
    const rowWithTagPicker = () => page.locator('li').filter({ has: page.getByLabel('Add a tag') }).first();
    const firstRow = rowWithTagPicker();
    await firstRow.locator('summary').click();   // the add-a-tag box is inside the opened row
    await firstRow.getByLabel('Add a tag').fill(handTag);
    await firstRow.getByRole('button', { name: 'Add', exact: true }).click();
    // Whichever row now carries the chip. The list is not in a stable order (tagging touches the
    // person, and many rows share a timestamp), so "the first row again" is not the same person.
    await expect(
      page.locator('li').filter({ has: page.getByRole('button', { name: new RegExp(handTag) }) }).first()
    ).toBeVisible();

    // 5. A broadcast from the mass tag: the dry run shows the audience, start, then cancel.
    await page.goto('/broadcast/new');
    const name = `E2E tag broadcast ${stamp}`;
    await page.locator('input[name="name"]').fill(name);
    await page.locator('textarea[name="body"]').fill('Hi {{name}}, a tagged e2e message.');
    const pick = async (select: string, text: string): Promise<void> => {
      const value = await page.locator(`select[name="${select}"] option`, { hasText: text }).first().getAttribute('value');
      await page.locator(`select[name="${select}"]`).selectOption(value ?? '');
    };
    await pick('senderIdentityId', SENDER);
    await pick('fromTagId', massTag);
    await page.getByRole('button', { name: /create|save|draft/i }).first().click();
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByText(new RegExp(`${imported}`)).first()).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText(/Running/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible();
  });
});
