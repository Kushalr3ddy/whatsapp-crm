import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { signIn, nav, CREDS_MISSING } from '../e2e/helpers';
import { CURSOR_OVERLAY } from './cursor';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
/** A real end-user file kept in the git-ignored private/ folder. Previewed only, never imported. */
const IMPORT_FILE = process.env.WALKTHROUGH_IMPORT_FILE ?? 'private/Purchase-Manager_20260622211807_160.xlsx';
/** Seconds to rest on each page so a recording is easy to follow. */
const DWELL = Number(process.env.WALKTHROUGH_DWELL_MS ?? 2500);

interface Sender { id: string; label: string | null; provider: string; connectionState: string | null }

/**
 * A recorded tour for demos: sign in → link a number (you scan) → every tab → import PREVIEW → a campaign form
 * filled but never saved → sign out. It writes nothing and sends nothing. Run with `LIVE_VIDEO=1`.
 */
test.describe('recorded walkthrough', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD');

  test('login → link → tabs → import preview → campaign form → sign out', async ({ page }) => {
    await page.context().addInitScript(CURSOR_OVERLAY);
    const rest = (): Promise<void> => page.waitForTimeout(DWELL);
    const headers = async (): Promise<Record<string, string>> => {
      const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
      return { 'x-csrf-token': csrf };
    };

    await test.step('sign in', async () => {
      await page.goto('/login');
      await rest();
      await page.getByRole('button', { name: /theme/i }).first().click().catch(() => undefined);
      await rest();
      await page.getByRole('button', { name: /theme/i }).first().click().catch(() => undefined);
      await signIn(page);
      await rest();
    });

    await test.step('linked numbers: link if none is connected', async () => {
      await nav(page).getByRole('link', { name: 'Linked numbers', exact: true }).click();
      await rest();
      const list = async (): Promise<Sender[]> =>
        ((await (await page.request.get(`${API}/senders`, { headers: await headers() })).json()) as { data: Sender[] }).data;
      let senders = await list();
      if (!senders.some((s) => s.provider === 'baileys' && s.connectionState === 'open')) {
        // eslint-disable-next-line no-console
        console.log('\n>>> No connected number. Scan the QR on the Linked numbers page now; waiting up to 10 min…\n');
        await page.getByRole('button', { name: 'Link this number' }).first().click({ timeout: 10_000 }).catch(() => undefined);
        await expect.poll(async () => {
          senders = await list();
          return senders.some((s) => s.provider === 'baileys' && s.connectionState === 'open');
        }, { timeout: 10 * 60_000, intervals: [3_000] }).toBe(true);
        await page.reload();
      }
      await rest();
    });

    await test.step('every tab', async () => {
      for (const name of ['Overview', 'Inbox', 'Contacts', 'Linked numbers', 'Import', 'Campaigns', 'Team', 'Security', 'Billing']) {
        const link = nav(page).getByRole('link', { name, exact: true });
        if (!(await link.isVisible())) continue;
        await link.click();
        await page.waitForLoadState('domcontentloaded');
        await rest();
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(800);
        await page.mouse.wheel(0, -500);
        if (name === 'Inbox') {
          await page.locator('a[href^="/inbox/"]').first().click({ timeout: 5_000 }).catch(() => undefined);
          await rest();
        }
      }
    });

    await test.step('import: upload and preview only', async () => {
      await nav(page).getByRole('link', { name: 'Import', exact: true }).click();
      if (existsSync(IMPORT_FILE)) {
        await page.locator('input[type="file"]').setInputFiles(IMPORT_FILE);
        await page.getByRole('button', { name: 'Upload' }).click();
        await rest();
        await page.getByRole('button', { name: 'Preview' }).click().catch(() => undefined);
        await rest();
        await page.mouse.wheel(0, 700);
        await rest();
      }
    });

    await test.step('campaign form: filled, never saved', async () => {
      await page.goto('/broadcast/new');
      await page.locator('input[name="name"]').fill('Walkthrough demo (not saved)');
      await page.locator('textarea[name="body"]').fill('{Hi|Hello} {{name}}, this is a demo message. Nothing is sent.');
      await rest();
      await page.mouse.wheel(0, 500);
      await rest();
    });

    await test.step('sign out', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/);
      await rest();
    });
  });
});
