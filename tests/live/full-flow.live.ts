import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { signIn, nav, openDetails, CREDS_MISSING } from '../e2e/helpers';
import { writeNaukriSample } from './naukri-sample';
import { CURSOR_OVERLAY } from './cursor';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/** Numbers come from `.env`, never the repo: the operator's own phones. */
const SEND_TO = (process.env.LIVE_SEND_TO ?? '').trim();
const BROADCAST_TO = (process.env.LIVE_BROADCAST_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** Only for verifying the suite itself on the in-memory channel; real runs leave this unset. */
const ALLOW_FAKE = process.env.LIVE_ALLOW_FAKE === '1';
/** Lets a re-run broadcast to people messaged within the cooldown window (admin override, audited). */
const OVERRIDE_GATES = process.env.LIVE_OVERRIDE_GATES === '1';
/** Skips import, messages, tagging and the broadcast: nothing is sent, only the tab tour runs. */
const TOUR_ONLY = process.env.LIVE_TOUR_ONLY === '1';

interface Sender { id: string; label: string | null; provider: string; connectionState: string | null }

/**
 * The whole product, start to finish, on screen: sign in → (link a number if needed) → import a
 * Naukri-style Excel → message one person → tag people → broadcast to three → sign out.
 *
 * It sends REAL WhatsApp messages from the linked number to `LIVE_SEND_TO` and `LIVE_BROADCAST_TO`
 * only. The import file's other rows are fillers and are never messaged. Run it headed:
 * `npm run test:live` with the real stack (`npm run dev:all`, not the fake gateway) up.
 */
test.describe('live walkthrough', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');
  test.skip(SEND_TO === '' || BROADCAST_TO.length === 0, 'set LIVE_SEND_TO and LIVE_BROADCAST_TO in .env');

  test('login → import → message → tag → broadcast → sign out', async ({ page }) => {
    // Wall-clock timing for every step and a few key moments inside them, written out at the end.
    const t0 = Date.now();
    const timings: Array<{ name: string; ms: number; at: number }> = [];
    const lap = (name: string, since: number): void => {
      timings.push({ name, ms: Date.now() - since, at: Date.now() - t0 });
    };
    /** Prints the table and saves it next to the video. Also runs when a step fails, so a failed run still has times. */
    const report = (): void => {
      const total = Date.now() - t0;
      const rowsOut = timings.map((t) => `${t.name.padEnd(54)} ${(t.ms / 1000).toFixed(1).padStart(7)} s   (at ${(t.at / 1000).toFixed(0)} s)`);
      // eslint-disable-next-line no-console
      console.log(`\nTIMINGS\n${rowsOut.join('\n')}\n${'total'.padEnd(54)} ${(total / 1000).toFixed(1).padStart(7)} s\n`);
      mkdirSync('test-results', { recursive: true });
      writeFileSync('test-results/live-timings.json', JSON.stringify({ totalMs: total, steps: timings }, null, 2));
    };
    const timed = async (name: string, body: () => Promise<void>): Promise<void> => {
      const started = Date.now();
      try { await test.step(name, body); } catch (error) { lap(`${name} (FAILED)`, started); report(); throw error; }
      lap(name, started);
    };
    /** A step that is skipped in tour-only mode, so a re-run does not message anyone again. */
    const unlessTourOnly = async (name: string, body: () => Promise<void>): Promise<void> => {
      if (!TOUR_ONLY) await timed(name, body);
    };
    // Draw a pointer so a screen recording shows where the mouse is.
    await page.context().addInitScript(CURSOR_OVERLAY);
    const stamp = String(Date.now());
    const headers = async (): Promise<Record<string, string>> => {
      const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
      return { 'x-csrf-token': csrf, 'content-type': 'application/json' };
    };
    const get = async <T>(path: string): Promise<T> =>
      ((await (await page.request.get(`${API}${path}`, { headers: await headers() })).json()) as { data: T }).data;

    // ── 1 · sign in ────────────────────────────────────────────────────────────────────
    await timed('sign in', async () => {
      await signIn(page);
    });

    // ── 2 · a connected number to send from (link one, on screen, if there isn't one) ──────
    let sender!: Sender;
    await timed('find or link the sending number', async () => {
      const usable = (s: Sender): boolean =>
        s.connectionState === 'open' && (s.provider === 'baileys' || (ALLOW_FAKE && s.provider === 'fake'));
      let senders = await get<Sender[]>('/senders');
      let found = senders.find(usable);
      if (found === undefined) {
        // Nothing connected. Make sure a number exists, then wait while the operator scans the QR.
        if (!senders.some((s) => s.provider === 'baileys')) {
          await page.request.post(`${API}/senders`, {
            headers: await headers(), data: { label: 'Live test number', provider: 'baileys' }
          });
        }
        await page.goto('/link');
        // Start the link so the QR is on screen without anyone clicking; best effort, the page may differ.
        const card = page.locator('li').filter({ hasText: /Live test number|E2E flow number|Live demo number/ });
        await (await card.count() > 0 ? card : page).getByRole('button', { name: 'Link this number' }).first()
          .click({ timeout: 15_000 }).catch(() => undefined);
        test.info().annotations.push({ type: 'action', description: 'Scan the QR with WhatsApp → Linked devices' });
        // eslint-disable-next-line no-console
        console.log('\n>>> No connected number. Link one in the browser window now (QR on /link); waiting up to 10 min…\n');
        const qrShown = Date.now();
        await expect.poll(async () => {
          senders = await get<Sender[]>('/senders');
          return senders.find(usable)?.id ?? null;
        }, { timeout: 10 * 60_000, intervals: [3_000], message: 'a number must be linked and connected' }).not.toBeNull();
        found = senders.find(usable);
        lap('  QR on screen → number connected (your scan)', qrShown);
      }
      sender = found!;
      await nav(page).getByRole('link', { name: 'Linked numbers', exact: true }).click();
      await expect(page.getByText(sender.label ?? '').first()).toBeVisible();
    });

    // ── 3 · import a Naukri-style Excel file, tagging everyone in it ──────────────────────
    const importTag = `live-import-${stamp}`;
    await unlessTourOnly('import the Excel file', async () => {
      const own = BROADCAST_TO.map((phone, i) => ({ name: `Live Test ${['One', 'Two', 'Three', 'Four'][i] ?? String(i + 1)}`, phone }));
      const file = await writeNaukriSample(own);
      await nav(page).getByRole('link', { name: 'Import', exact: true }).click();
      let mark = Date.now();
      await page.locator('input[type="file"]').setInputFiles(file);
      await expect(page.getByText(/rows ·/)).toBeVisible();
      lap('  import: upload → rows read', mark);
      await page.getByLabel('Tag everyone in this file').fill(importTag);
      mark = Date.now();
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible();
      lap('  import: dry-run preview', mark);
      mark = Date.now();
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByText(/✓ Imported/)).toBeVisible();
      lap('  import: commit', mark);
    });

    // ── 4 · message one person (your own phone) ───────────────────────────────────────────
    await unlessTourOnly('send one message, then reply in the thread', async () => {
      // The UI has no "new conversation" button yet, so the first message goes through the same
      // endpoint the host app uses; the reply below is typed in the inbox like an agent would.
      const sendStart = Date.now();
      const first = await page.request.post(`${API}/messages`, {
        headers: await headers(),
        data: { to: SEND_TO, senderId: sender.id, body: `CRM live test ${stamp}: hello from the CRM.` }
      });
      expect(first.status(), await first.text()).toBe(202);
      const conversationId = ((await first.json()) as { data: { conversationId: string } }).data.conversationId;

      await page.goto(`/inbox/${conversationId}`);
      await expect(page.getByText(`CRM live test ${stamp}`)).toBeVisible();
      await page.getByPlaceholder(/^Message |^Reply$/).fill(`Second message ${stamp}, typed in the inbox.`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();

      await expect.poll(async () => {
        const msgs = await get<Array<{ direction: string; status: string }>>(`/conversations/${conversationId}/messages`);
        const out = msgs.filter((m) => m.direction === 'outbound');
        return out.length >= 2 && out.every((m) => ['sent', 'delivered', 'read'].includes(m.status));
      }, { timeout: 5 * 60_000, intervals: [3_000], message: 'both messages must leave (check the gateway log)' }).toBe(true);
      lap('  messages: queued → both sent by the gateway', sendStart);
      await page.reload();
    });

    // ── 5 · tag: mass-tag the three recipients, then hand-tag one ────────────────────────
    const castTag = `live-broadcast-${stamp}`;
    const handTag = `live-vip-${stamp}`;
    await unlessTourOnly('tag people', async () => {
      await page.goto('/contacts');
      await openDetails(page, /^New tag/);
      await page.getByPlaceholder('New tag name…').fill(castTag);
      await page.getByRole('button', { name: 'Add tag' }).click();
      await expect(page.getByRole('link', { name: castTag })).toBeVisible();
      await openDetails(page, /^New tag/);
      await page.getByPlaceholder('New tag name…').fill(handTag);
      await page.getByRole('button', { name: 'Add tag' }).click();
      await expect(page.getByRole('link', { name: handTag })).toBeVisible();

      // The recipients are the only people named "Live Test …", so a search narrows to exactly them.
      await page.goto(`/contacts?q=${encodeURIComponent('Live Test')}`);
      await openDetails(page, 'Tag many at once');
      await page.getByLabel('Add or remove').first().selectOption('add');
      await page.getByLabel('Tag to apply').selectOption({ label: castTag });
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText(new RegExp(`Add tag ${castTag} to ${String(BROADCAST_TO.length)} people`))).toBeVisible();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByText(new RegExp(`Done — ${String(BROADCAST_TO.length)} people added`))).toBeVisible();

      // One person by hand: pick the tag on that person's row, then the tag's chip count proves it applied.
      await page.goto(`/contacts?q=${encodeURIComponent(BROADCAST_TO[0]!.replace(/\D/g, ''))}`);
      const row = page.locator('li').filter({ has: page.getByLabel('Add a tag') }).first();
      await row.getByLabel('Add a tag').fill(handTag);
      await row.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('link', { name: new RegExp(`${handTag} 1`) })).toBeVisible();
    });

    // ── 6 · broadcast to the tagged three ───────────────────────────────────────────────
    await unlessTourOnly('broadcast to the tagged people', async () => {
      await page.goto('/broadcast/new');
      const name = `Live broadcast ${stamp}`;
      await page.locator('input[name="name"]').fill(name);
      await page.locator('textarea[name="body"]').fill('{Hi|Hello} {{name}}, this is a CRM broadcast test. No reply needed.');
      const pick = async (select: string, text: string): Promise<void> => {
        const value = await page.locator(`select[name="${select}"] option`, { hasText: text }).first().getAttribute('value');
        await page.locator(`select[name="${select}"]`).selectOption(value ?? '');
      };
      await pick('senderIdentityId', sender.label ?? '');
      await pick('fromTagId', castTag);
      await page.getByRole('button', { name: /create|save|draft/i }).first().click();
      await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
      const campaignId = /\/broadcast\/([0-9a-f-]{36})/.exec(page.url())![1]!;

      const campaignStart = Date.now();
      if (OVERRIDE_GATES) {
        // A re-run inside the 14-day cooldown: an admin lifts the recipient gates, with a reason.
        const r = await page.request.post(`${API}/campaigns/${campaignId}/start`, {
          headers: await headers(),
          data: { overrideGates: ['engagement', 'cooldown', 'duplicate_campaign'], reason: 'live test re-run to own numbers' }
        });
        expect(r.status(), await r.text()).toBeLessThan(300);
        await page.reload();
      } else {
        await page.getByRole('button', { name: 'Start', exact: true }).click();
      }
      await expect(page.getByText(/Running|Completed/i).first()).toBeVisible();

      type R = Array<{ displayName: string | null; status: string; skipReason: string | null }>;
      let rows: R = [];
      await expect.poll(async () => {
        rows = await get<R>(`/campaigns/${campaignId}/recipients`);
        const settled = rows.length === BROADCAST_TO.length
          && rows.every((r) => ['sent', 'delivered', 'read', 'skipped', 'failed'].includes(r.status));
        return settled;
      }, { timeout: 8 * 60_000, intervals: [3_000], message: 'every recipient should settle' }).toBe(true);

      lap('  broadcast: start → all three recipients settled', campaignStart);
      const bad = rows.filter((r) => !['sent', 'delivered', 'read'].includes(r.status));
      expect(bad, `not delivered: ${JSON.stringify(bad)}. ` +
        'A "cooldown"/"engaged" skip means they were messaged recently — re-run with LIVE_OVERRIDE_GATES=1.').toEqual([]);
      await page.reload();
      await expect(page.getByText('Live Test One').first()).toBeVisible();
    });

    // ── 7 · walk every tab and click what is safe to click ────────────────────────────────
    await timed('tour: every tab and button', async () => {
      // Controls that change data, send, or end the session are never clicked by the tour.
      const UNSAFE = /delete|remove|cancel|sign out|start|send|confirm|import|unlink|resolve|reopen|do not contact|\badd\b|save|create|override|block|link this|upload|export|apply|tag |note|merge|close|preview|campaign from/i;
      const pages = ['Overview', 'Inbox', 'Contacts', 'Linked numbers', 'Import', 'Campaigns', 'Billing'];
      const clicked: string[] = [];
      for (const name of pages) {
        const pageStart = Date.now();
        await nav(page).getByRole('link', { name, exact: true }).click();
        await page.waitForLoadState('domcontentloaded');
        // Open every disclosure, then press every tab and harmless button once.
        for (const summary of (await page.locator('summary').all()).slice(0, 8)) {
          await summary.click({ timeout: 1_500 }).then(() => clicked.push(`${name}: ▸ ${'summary'}`)).catch(() => undefined);
        }
        for (const tab of (await page.getByRole('tab').all()).slice(0, 6)) {
          await tab.click({ timeout: 1_500 }).then(() => clicked.push(`${name}: tab`)).catch(() => undefined);
        }
        for (const button of (await page.getByRole('button').all()).slice(0, 14)) {
          const label = ((await button.innerText().catch(() => '')) || (await button.getAttribute('aria-label')) || '').trim();
          if (label === '' || UNSAFE.test(label) || !(await button.isVisible()) || !(await button.isEnabled())) continue;
          await button.click({ timeout: 1_500 }).then(() => clicked.push(`${name}: ${label}`)).catch(() => undefined);
        }
        lap(`  tour: ${name}`, pageStart);
      }
      // The inbox filters and the first thread, the one place a click changes what is on screen a lot.
      await nav(page).getByRole('link', { name: 'Inbox', exact: true }).click();
      const threadStart = Date.now();
      await page.locator('a[href^="/inbox/"]').first().click({ timeout: 10_000 }).catch(() => undefined);
      lap('  tour: open first inbox thread', threadStart);
      // The theme toggle, if present.
      await page.getByRole('button', { name: /theme/i }).first().click({ timeout: 3_000 }).catch(() => undefined);
      test.info().annotations.push({ type: 'tour', description: `${String(clicked.length)} controls pressed` });
    });

    // ── 8 · sign out, and the session is really gone ──────────────────────────────────────
    await timed('sign out', async () => {
      // The tour may have just toggled the theme, which re-renders the shell; let it settle, and
      // press again if the first press landed mid-render.
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Sign out' }).click();
      if (!(await page.waitForURL(/\/login/, { timeout: 8_000 }).then(() => true, () => false))) {
        await page.getByRole('button', { name: 'Sign out' }).click();
      }
      await expect(page).toHaveURL(/\/login/);
      await page.goto('/contacts');
      await expect(page).toHaveURL(/\/login/);
    });

    report();
  });
});

