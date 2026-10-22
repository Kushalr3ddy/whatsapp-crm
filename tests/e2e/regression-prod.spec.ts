import { test, expect, type Page } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const SENDER = 'E2E flow number';
const TAG = 'e2e-flow';

/**
 * Regression tests that only show up on a PRODUCTION build (`next build` + `next start`), so they carry `@smoke` and run in CI
 * against one (see tests/regression/README.md). The bug they guard: a form whose server action ends in a redirect hung on its
 * "Creating…" state forever in production, because Next's own gzip never finished the response (R-001). `next dev` never showed it.
 */
test.describe('forms that redirect, on a production build', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  /** A number and a tag to build a draft from, made through the API with fixed names so a re-run reuses them. */
  async function fixtures(page: Page): Promise<void> {
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const senders = ((await (await page.request.get(`${API}/senders`, { headers })).json()) as { data: Array<{ label: string }> }).data;
    if (!senders.some((s) => s.label === SENDER)) await page.request.post(`${API}/senders`, { headers, data: { label: SENDER, provider: 'baileys' } });
    const tags = ((await (await page.request.get(`${API}/tags`, { headers })).json()) as { data: Array<{ name: string }> }).data;
    if (!tags.some((t) => t.name === TAG)) await page.request.post(`${API}/tags`, { headers, data: { name: TAG } });
  }

  /** Fills the New campaign form with a unique name and returns it. */
  async function fillForm(page: Page): Promise<string> {
    await page.goto('/broadcast/new');
    const name = `Regression ${String(Date.now())}`;
    await page.locator('input[name="name"]').fill(name);
    await page.locator('textarea[name="body"]').fill('Hi {{name}}, regression test.');
    const pick = async (select: string, text: string): Promise<void> => {
      const value = await page.locator(`select[name="${select}"] option`, { hasText: text }).first().getAttribute('value');
      await page.locator(`select[name="${select}"]`).selectOption(value ?? '');
    };
    await pick('senderIdentityId', SENDER);
    await pick('fromTagId', TAG);
    return name;
  }

  /** Cancels the draft this run made so nothing is left behind. */
  async function cleanUp(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => undefined);
  }

  test('[R-001] @smoke Create draft redirects to the new draft within 8 seconds, not stuck on "Creating…"', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    const name = await fillForm(page);
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/, { timeout: 8_000 });
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await cleanUp(page);
  });

  test('[R-004] @smoke clicking Create draft twice makes exactly one draft', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    const name = await fillForm(page);
    await page.getByRole('button', { name: /create draft/i }).dblclick();
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/, { timeout: 8_000 });
    const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
    const list = ((await (await page.request.get(`${API}/campaigns`, { headers: { 'x-csrf-token': csrf } })).json()) as { data: Array<{ name: string }> }).data;
    expect(list.filter((c) => c.name === name)).toHaveLength(1);
    await cleanUp(page);
  });

  test('[R-006] @smoke "Tag many at once": Preview with no tag chosen does not hang and does not send anything', async ({ page }) => {
    // Originally the button gave no answer. The tag choice is now required in the browser, so no request is made at all (an instant server redirect
    // can hang on a production server: see R-008). The browser's own message stands in for the server's "Choose a tag first".
    await signIn(page);
    await page.goto('/contacts');
    await page.waitForLoadState('networkidle');
    await page.locator('summary', { hasText: 'Tag many at once' }).click();
    const posts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
    const preview = page.getByRole('button', { name: 'Preview', exact: true }).first();
    await preview.click();
    const tag = page.getByLabel('Tag to apply');
    expect(await tag.evaluate((el) => (el as unknown as { validity: { valueMissing: boolean } }).validity.valueMissing)).toBe(true);
    await expect(page.getByRole('button', { name: /Counting/ })).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });

  test('[R-007] @smoke a contact row opened by script right after the page loads still shows its panel', async ({ page }) => {
    // The row's panel is built when it is opened (D-89). A row opened before the page finished starting up used to stay empty.
    await signIn(page);
    await page.goto('/contacts');
    const row = page.locator('li').filter({ has: page.getByLabel(/^Select /) }).first();
    await row.locator('details').first().evaluate((el) => { (el as unknown as { open: boolean }).open = true; });
    await expect(row.getByLabel('Add a tag')).toBeVisible({ timeout: 8_000 });
  });
});
