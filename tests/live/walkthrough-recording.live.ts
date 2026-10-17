import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { signIn, nav, openDetails, CREDS_MISSING } from '../e2e/helpers';
import { CURSOR_OVERLAY } from './cursor';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
/** A real end-user file kept in the git-ignored private/ folder. Imported, and its people are never messaged. */
const IMPORT_FILE = process.env.WALKTHROUGH_IMPORT_FILE ?? 'private/Purchase-Manager_20260622211807_160.xlsx';
/** The operator's own phones, from `.env`: the only people this run ever messages. */
const SEND_TO = (process.env.LIVE_SEND_TO ?? '').trim();
const BROADCAST_TO = (process.env.LIVE_BROADCAST_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** Milliseconds to rest after each thing happens so a viewer can follow it. */
const DWELL = Number(process.env.WALKTHROUGH_DWELL_MS ?? 2200);

interface Sender { id: string; label: string | null; provider: string; connectionState: string | null }

/**
 * A recorded tour for demos. Every step does something visible:
 * sign in (theme toggle first) → link the number (you scan) → inbox reply → contacts search and tag →
 * import the Purchase-Manager file → a campaign to the operator's own phones → Team and Security → sign out.
 * The people in the imported file are never messaged. Run with `LIVE_VIDEO=1`.
 */
test.describe('recorded walkthrough', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD');
  test.skip(SEND_TO === '' || BROADCAST_TO.length === 0, 'set LIVE_SEND_TO and LIVE_BROADCAST_TO in .env');

  test('login → link → inbox → contacts → import → campaign → sign out', async ({ page }) => {
    await page.context().addInitScript(CURSOR_OVERLAY);
    const rest = (ms = DWELL): Promise<void> => page.waitForTimeout(ms);
    const stamp = String(Date.now());
    const headers = async (): Promise<Record<string, string>> => {
      const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
      return { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    };
    const get = async <T>(path: string): Promise<T> =>
      ((await (await page.request.get(`${API}${path}`, { headers: await headers() })).json()) as { data: T }).data;
    const go = async (name: string): Promise<void> => {
      await nav(page).getByRole('link', { name, exact: true }).click();
      await page.waitForLoadState('domcontentloaded');
      await rest();
    };
    /** Scrolls down and back so a long page is seen, not just its top. */
    const look = async (page2: Page): Promise<void> => {
      await page2.mouse.wheel(0, 600);
      await rest(1200);
      await page2.mouse.wheel(0, -600);
      await rest(600);
    };

    await test.step('sign in, theme toggle first', async () => {
      await page.goto('/login');
      await rest();
      const toggle = page.getByRole('main').getByRole('button', { name: /theme/i });
      await toggle.click();
      await rest(1500);
      await toggle.click();
      await rest(1500);
      await expect(page).toHaveURL(/\/login/);
      await signIn(page);
      await rest();
    });

    let sender!: Sender;
    await test.step('linked numbers: link the number (scan the QR)', async () => {
      await go('Linked numbers');
      const usable = (s: Sender): boolean => s.provider === 'baileys' && s.connectionState === 'open';
      let senders = await get<Sender[]>('/senders');
      if (!senders.some(usable)) {
        // eslint-disable-next-line no-console
        console.log('\n>>> Scan the QR on the Linked numbers page now (WhatsApp → Linked devices); waiting up to 10 min…\n');
        const press = page.getByRole('button', { name: /^(Link this number|Try again)$/ }).first();
        await press.click({ timeout: 15_000 }).catch(() => undefined);
        await expect.poll(async () => {
          senders = await get<Sender[]>('/senders');
          return senders.some(usable);
        }, { timeout: 10 * 60_000, intervals: [3_000] }).toBe(true);
      }
      sender = senders.find(usable)!;
      await page.reload();
      await rest();
    });

    await test.step('inbox: a message arrives, open it and reply', async () => {
      const first = await page.request.post(`${API}/messages`, {
        headers: await headers(),
        data: { to: SEND_TO, senderId: sender.id, body: `CRM walkthrough ${stamp}: hello from the CRM.` }
      });
      expect(first.status(), await first.text()).toBe(202);
      const conversationId = ((await first.json()) as { data: { conversationId: string } }).data.conversationId;
      await go('Inbox');
      await page.goto(`/inbox/${conversationId}`);
      await expect(page.getByText(`CRM walkthrough ${stamp}`)).toBeVisible();
      await rest();
      await page.getByPlaceholder(/^Message |^Reply$/).pressSequentially(`Reply ${stamp}, typed in the inbox.`, { delay: 40 });
      await rest(800);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(async () => {
        const msgs = await get<Array<{ direction: string; status: string }>>(`/conversations/${conversationId}/messages`);
        const out = msgs.filter((m) => m.direction === 'outbound');
        return out.length >= 2 && out.every((m) => ['sent', 'delivered', 'read'].includes(m.status));
      }, { timeout: 3 * 60_000, intervals: [3_000] }).toBe(true);
      await page.reload();
      await rest();
    });

    const tag = `walkthrough-${stamp}`;
    await test.step('contacts: search, then tag your own phones', async () => {
      await go('Contacts');
      await look(page);
      await page.goto(`/contacts?q=${encodeURIComponent('Live Test')}`);
      await rest();
      await openDetails(page, /^New tag/);
      await page.getByPlaceholder('New tag name…').pressSequentially(tag, { delay: 30 });
      await page.getByRole('button', { name: 'Add tag' }).click();
      await expect(page.getByRole('link', { name: tag })).toBeVisible();
      await rest();
      await openDetails(page, 'Tag many at once');
      await page.getByLabel('Add or remove').first().selectOption('add');
      await page.getByLabel('Tag to apply').selectOption({ label: tag });
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText(new RegExp(`Add tag ${tag} to \\d+ people`))).toBeVisible();
      await rest();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByText(/Done — \d+ people added/)).toBeVisible();
      await rest();
    });

    await test.step('import: the Purchase-Manager file (nobody in it is messaged)', async () => {
      test.skip(!existsSync(IMPORT_FILE), 'sample file missing');
      await go('Import');
      await page.locator('input[type="file"]').setInputFiles(IMPORT_FILE);
      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByText(/rows ·/)).toBeVisible();
      await rest();
      await page.getByLabel('Tag everyone in this file').pressSequentially(`purchase-manager-${stamp}`, { delay: 30 });
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
      await rest(3000);
      await page.mouse.wheel(0, 700);
      await rest();
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByText(/✓ Imported/)).toBeVisible({ timeout: 120_000 });
      await rest(3000);
      await go('Contacts');
      await look(page);
    });

    await test.step('campaign: create it from the tag and start it', async () => {
      await go('Campaigns');
      await page.goto('/broadcast/new');
      await rest();
      await page.locator('input[name="name"]').pressSequentially(`Walkthrough campaign ${stamp}`, { delay: 30 });
      await page.locator('textarea[name="body"]').pressSequentially('{Hi|Hello} {{name}}, this is a CRM demo message. No reply needed.', { delay: 25 });
      await rest(800);
      const pick = async (select: string, text: string): Promise<void> => {
        const value = await page.locator(`select[name="${select}"] option`, { hasText: text }).first().getAttribute('value');
        await page.locator(`select[name="${select}"]`).selectOption(value ?? '');
      };
      await pick('senderIdentityId', sender.label ?? '');
      await page.getByRole('tab', { name: 'A tag' }).click();
      await pick('fromTagId', tag);
      await rest();
      await page.getByRole('button', { name: /create|save|draft/i }).first().click();
      await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
      const campaignId = /\/broadcast\/([0-9a-f-]{36})/.exec(page.url())![1]!;
      await rest();
      // Own phones were messaged recently, so an admin lifts the cooldown gates (audited, with a reason).
      const r = await page.request.post(`${API}/campaigns/${campaignId}/start`, {
        headers: await headers(),
        data: { overrideGates: ['engagement', 'cooldown', 'duplicate_campaign'], reason: 'recorded walkthrough to own numbers' }
      });
      expect(r.status(), await r.text()).toBeLessThan(300);
      await page.reload();
      await rest();
      await expect.poll(async () => {
        const rows = await get<Array<{ status: string }>>(`/campaigns/${campaignId}/recipients`);
        return rows.length > 0 && rows.every((x) => ['sent', 'delivered', 'read', 'skipped', 'failed'].includes(x.status));
      }, { timeout: 8 * 60_000, intervals: [3_000] }).toBe(true);
      await page.reload();
      await rest(3000);
    });

    await test.step('team and security', async () => {
      for (const name of ['Overview', 'Team', 'Security']) {
        await go(name);
        await look(page);
      }
    });

    await test.step('sign out', async () => {
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/);
      await rest(3000);
    });
  });
});
