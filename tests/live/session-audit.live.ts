import { test, expect, type Locator } from '@playwright/test';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURSOR_OVERLAY } from './cursor';

/**
 * A timed, recorded, ordered pass over the whole product, written for measuring how responsive each screen and control is, not only whether it works.
 *
 *   sign in wrong, then right → the dashboard one element at a time → back to the dashboard → Inbox (send a message, note the time) → Contacts
 *   (import the CSV, "Upload anyway", search) → Campaigns (to the imported numbers) → Team (try to demote the only admin) → AI assistant and its
 *   settings → Security → Billing (look only) → the dashboard → sign out.
 *
 * Every step is timed; a failing step is recorded and the run goes on, so one broken control does not hide the rest. Resource samples come from
 * `resmon.mjs` running beside it. Settings come from the environment (`SESSION_*`), set by `scripts/run-session.sh`.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const OUT = process.env.SESSION_OUT ?? 'test-results/session';
const CSV = process.env.SESSION_CSV ?? '';
const SEND_TO = (process.env.LIVE_SEND_TO ?? '').trim();
const EMAIL = process.env.SESSION_EMAIL ?? '';
const PASSWORD = process.env.SESSION_PASSWORD ?? '';
const SENDER_LABEL = process.env.SESSION_SENDER ?? '';
const MODEL_KEY = process.env.SESSION_MODEL_KEY ?? '';
const CAMPAIGN_TEXT = process.env.SESSION_CAMPAIGN_TEXT ?? 'Test message from the CRM test run, please ignore.';
const TAG = process.env.SESSION_IMPORT_TAG ?? 'session-import';
/** How long to wait for a message to leave the gateway, in seconds. Lower it when no gateway for this channel is running (the step then fails fast and says so). */
const SEND_WAIT_MS = Number(process.env.SESSION_SEND_WAIT_S ?? '300') * 1000;

/** The people in the CSV (name, mobile, email, city), read from its first four columns, so the searches below follow whatever file is used. */
function readPeople(path: string): Array<{ name: string; phone: string; email: string; city: string }> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name = '', phone = '', email = '', city = ''] = l.split(',').map((c) => c.trim());
    return { name, phone, email, city };
  });
}

interface Row { n: number; area: string; name: string; ms: number; startedAt: string; ok: boolean; note: string }
const rows: Row[] = [];
const t0 = Date.now();

test.describe('session audit', () => {
  test.skip(EMAIL === '' || PASSWORD === '', 'SESSION_EMAIL / SESSION_PASSWORD are not set (run scripts/run-session.sh)');

  test('the whole session, timed', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    mkdirSync(OUT, { recursive: true });
    page.setDefaultTimeout(30_000);
    await page.context().addInitScript(CURSOR_OVERLAY);
    let area = 'start';
    let failStreak = 0;

    // What the browser itself reports while a step runs: script errors, console errors, and failed or slow requests. Kept per step so a bug can be traced to the click that caused it.
    let diag: string[] = [];
    const flag = (kind: string, text: string): void => { diag.push(`${kind}: ${text}`.slice(0, 200)); };
    page.on('pageerror', (e) => { flag('page error', e.message); });
    page.on('console', (m) => { if (m.type() === 'error') flag('console error', m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/_next\/|favicon/.test(r.url())) flag(`HTTP ${String(r.status())}`, r.url().replace(/^https?:\/\/[^/]+/, '')); });
    page.on('requestfailed', (r) => { if (!/_next\/|favicon/.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') flag('request failed', r.url().replace(/^https?:\/\/[^/]+/, '')); });
    /** Brings the window to the front before each step, so a click on another window or a moved mouse does not leave the test typing into nothing. */
    const refocus = async (): Promise<void> => { await page.bringToFront().catch(() => undefined); };
    /** Failures that come from the window being disturbed (something over the page, a moved element), not from the product. Safe to try once more: they happen before the click lands. */
    const DISTURBED = /intercepts pointer events|not stable|detached from the DOM|outside of the viewport|Element is not attached/;

    /** Runs one step, times it, keeps going if it fails, and takes a screenshot when it does. */
    async function step(name: string, body: () => Promise<string | void>): Promise<boolean> {
      const started = Date.now();
      let ok = true; let note = '';
      diag = [];
      await refocus();
      try {
        try { note = (await body()) ?? ''; }
        catch (first) {
          if (!DISTURBED.test(String(first))) throw first;
          await refocus(); await page.mouse.move(2, 2).catch(() => undefined);
          note = `retried once after the window was disturbed. ${(await body()) ?? ''}`;
        }
      }
      catch (error) {
        ok = false; note = String(error instanceof Error ? error.message : error).split('\n').slice(0, 3).join(' ').slice(0, 300);
        await page.screenshot({ path: join(OUT, `FAILED-${String(rows.length + 1).padStart(3, '0')}.png`) }).catch(() => undefined);
      }
      if (diag.length > 0) note = `${note}${note === '' ? '' : ' | '}browser reported: ${[...new Set(diag)].slice(0, 4).join('; ')}`.slice(0, 600);
      const row: Row = { n: rows.length + 1, area, name, ms: Date.now() - started, startedAt: new Date(started).toISOString(), ok, note };
      rows.push(row);
      // Written as it happens, so a run that is stopped or crashes still leaves its timings, and the log can be followed live.
      appendFileSync(join(OUT, 'steps.jsonl'), `${JSON.stringify(row)}\n`);
      // eslint-disable-next-line no-console
      console.log(`${ok ? 'ok    ' : 'FAILED'} ${String(row.n).padStart(3)} ${(row.ms / 1000).toFixed(2).padStart(7)} s  ${area} / ${name}${ok ? '' : `  ->  ${note.slice(0, 160)}`}`);
      if (!ok) {
        failStreak += 1;
        if (failStreak >= 12) throw new Error('12 steps failed in a row: stopping so the report is not padded with timeouts');
      } else failStreak = 0;
      return ok;
    }
    /** Clicks something and times it until the page shows `ready`. */
    async function press(name: string, target: Locator, ready: Locator | (() => Promise<void>), timeout = 30_000): Promise<boolean> {
      return step(name, async () => {
        await target.click({ timeout });
        if (typeof ready === 'function') await ready(); else await expect(ready).toBeVisible({ timeout });
      });
    }
    const shot = async (name: string): Promise<void> => { await page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => undefined); };
    const nav = (label: string): Locator => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });
    const csrf = async (): Promise<Record<string, string>> => ({
      'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '', 'content-type': 'application/json'
    });
    const api = async <T>(path: string): Promise<T> => ((await (await page.request.get(`${API}${path}`, { headers: await csrf() })).json()) as { data: T }).data;

    // ───────────────────────────────────────────────────── 1 · sign in: wrong, then right
    area = '1 sign in';
    await page.goto('/login');
    await step('login page ready', async () => { await expect(page.locator('input[type="email"]')).toBeVisible(); });
    await step('wrong password: error shown', async () => {
      await page.locator('input[type="email"]').fill(EMAIL);
      await page.locator('input[type="password"]').fill('definitely-not-the-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      const err = page.getByText(/incorrect|wrong|invalid|could not sign|not correct/i).first();
      await expect(err).toBeVisible({ timeout: 15_000 });
      return `message: "${(await err.innerText()).slice(0, 120)}"`;
    });
    await step('wrong email: error shown', async () => {
      await page.locator('input[type="email"]').fill('nobody-here@example.invalid');
      await page.locator('input[type="password"]').fill('whatever-123');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText(/incorrect|wrong|invalid|could not sign|not correct/i).first()).toBeVisible({ timeout: 15_000 });
    });
    await step('show / hide password toggle', async () => {
      await page.getByRole('button', { name: /show/i }).first().click({ timeout: 5_000 });
      await expect(page.locator('input[name="password"], input[type="text"]').first()).toBeVisible();
      await page.getByRole('button', { name: /hide/i }).first().click({ timeout: 5_000 });
    });
    await step('correct sign in: dashboard ready', async () => {
      await page.locator('input[type="email"]').fill(EMAIL);
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(nav('Contacts')).toBeVisible({ timeout: 30_000 });
    });
    await shot('01-dashboard');

    // ───────────────────────────────────────────────────── 1b · first visits (the dev server compiles a page the first time it is opened)
    area = '1b first visits';
    {
      const convs = await api<Array<{ id: string }>>('/conversations').catch(() => []);
      const camps = await api<Array<{ id: string }>>('/campaigns').catch(() => []);
      const made = await page.request.post(`${API}/ai/templates`, { headers: await csrf(), data: { name: 'warm-up (removed at once)', description: 'x', instructions: '- x', audience: '', firstMessage: '' } });
      const tplId = made.ok() ? ((await made.json()) as { data: { id: string } }).data.id : '';
      const visits = ['/inbox', '/contacts', '/link', '/import', '/broadcast', '/broadcast/new', '/team', '/ai', '/ai/settings', '/security', '/billing',
        ...(convs[0] ? [`/inbox/${convs[0].id}`] : []), ...(camps[0] ? [`/broadcast/${camps[0].id}`] : []), ...(tplId !== '' ? [`/ai/t/${tplId}`] : [])];
      for (const path of visits) await step(`first visit ${path.replace(/[0-9a-f-]{36}/, ':id')}`, async () => { await page.goto(path); await expect(page.locator('main h1, h1').first()).toBeVisible({ timeout: 60_000 }); });
      if (tplId !== '') await page.request.delete(`${API}/ai/templates/${tplId}`, { headers: await csrf() });
      await page.goto('/');
    }

    // ───────────────────────────────────────────────────── 2 · the dashboard, element by element
    area = '2 dashboard';
    await step('theme toggle changes the page', async () => {
      const themeNow = (): Promise<string> => page.evaluate("document.documentElement.getAttribute('data-theme') ?? document.documentElement.className") as Promise<string>;
      const before = await themeNow();
      await page.getByRole('button', { name: /theme/i }).first().click();
      await expect.poll(themeNow, { timeout: 5_000 }).not.toBe(before);
      await page.getByRole('button', { name: /theme/i }).first().click();
      await page.getByRole('button', { name: /theme/i }).first().click();
    });
    const hrefSet = new Set<string>();
    for (const link of await page.locator('main a[href^="/"]').all()) {
      const h = (await link.getAttribute('href')) ?? '';
      if (h !== '' && !h.startsWith('/media') && !h.includes('export')) hrefSet.add(h);
    }
    const hrefs = [...hrefSet];
    for (const href of hrefs.slice(0, 14)) {
      await step(`dashboard link ${href}: open`, async () => {
        await page.locator(`main a[href="${href}"]`).first().click({ timeout: 10_000 });
        await page.waitForURL((u) => u.pathname === href.split('?')[0] || u.pathname.startsWith(href.split('?')[0]!), { timeout: 20_000 });
        await expect(page.locator('main h1, h1').first()).toBeVisible({ timeout: 20_000 });
      });
      await step(`dashboard link ${href}: back to dashboard`, async () => { await page.goBack(); await expect(nav('Contacts')).toBeVisible(); await page.waitForLoadState('domcontentloaded'); });
    }
    await press('sidebar: Overview', nav('Overview'), page.locator('main h1').first());
    await shot('02-dashboard-again');

    // ───────────────────────────────────────────────────── 3 · inbox
    area = '3 inbox';
    await press('open Inbox', nav('Inbox'), page.getByRole('heading', { name: /inbox/i }).first());
    for (const filter of ['Closed', 'Mine', 'All', 'Open']) {
      await step(`inbox filter: ${filter}`, async () => { await page.getByRole('button', { name: filter, exact: true }).click({ timeout: 8_000 }); await page.waitForLoadState('domcontentloaded'); });
    }
    const senders = await api<Array<{ id: string; label: string | null; provider: string; connectionState: string | null }>>('/senders');
    const sender = senders.find((s) => s.label === SENDER_LABEL) ?? senders.find((s) => s.connectionState === 'open');
    let conversationId = '';
    let sentAt = '';
    if (sender === undefined || SEND_TO === '') {
      await step('find the sending number', async () => { throw new Error(`no sending number found (looked for "${SENDER_LABEL}") or LIVE_SEND_TO is empty`); });
    } else {
      await step(`first message from "${sender.label}" (${sender.provider}, ${sender.connectionState}) to the test number`, async () => {
        const sentStart = Date.now();
        const res = await page.request.post(`${API}/messages`, { headers: await csrf(), data: { to: SEND_TO, senderId: sender.id, body: `Session audit ${new Date().toISOString()}: hello from the CRM.` } });
        expect(res.status(), await res.text()).toBe(202);
        conversationId = ((await res.json()) as { data: { conversationId: string } }).data.conversationId;
        sentAt = new Date(sentStart).toISOString();
        return `queued at ${sentAt}`;
      });
      await step('open the conversation', async () => { await page.goto(`/inbox/${conversationId}`); await expect(page.getByText('Session audit').first()).toBeVisible(); });
      await step('type a reply in the inbox and send it', async () => {
        await page.getByPlaceholder(/^Message |^Reply$/).fill(`Second message ${new Date().toISOString()}, typed in the inbox.`);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByText(/Second message/).first()).toBeVisible({ timeout: 15_000 });
      });
      await step('both messages leave the gateway (sent / delivered)', async () => {
        const began = Date.now();
        await expect.poll(async () => {
          const msgs = await api<Array<{ direction: string; status: string; createdAt?: string }>>(`/conversations/${conversationId}/messages`);
          const out = msgs.filter((m) => m.direction === 'outbound');
          return out.length >= 2 && out.every((m) => ['sent', 'delivered', 'read'].includes(m.status));
        }, { timeout: SEND_WAIT_MS, intervals: [2_000], message: 'both messages should leave the gateway; is a gateway for this number\'s channel running?' }).toBe(true);
        const msgs = await api<Array<{ direction: string; status: string }>>(`/conversations/${conversationId}/messages`);
        return `sent at ${new Date().toISOString()} (${((Date.now() - began) / 1000).toFixed(1)} s after the reply); statuses: ${msgs.filter((m) => m.direction === 'outbound').map((m) => m.status).join(', ')}; first queued ${sentAt}`;
      });
      await shot('03-inbox-thread');
      for (const [label, tabName] of [['Note', 'Note'], ['Reply', 'Reply']] as const) {
        await step(`composer tab: ${label}`, async () => { await page.getByRole('button', { name: tabName, exact: true }).click({ timeout: 5_000 }); });
      }
    }

    // ───────────────────────────────────────────────────── 4 · contacts: import, upload anyway, search
    area = '4 contacts';
    await press('open Contacts', nav('Contacts'), page.getByRole('heading', { name: 'Contacts' }).first());
    await step('Refresh button', async () => { await page.getByRole('link', { name: 'Refresh' }).click(); await page.waitForLoadState('domcontentloaded'); });
    await step('open the first contact row', async () => { await page.locator('summary').first().click({ timeout: 8_000 }); });
    await step('Dates and order box opens', async () => { await page.locator('summary', { hasText: 'Dates and order' }).click(); });
    await step('Custom fields panel opens (scrolls, searches)', async () => {
      await page.locator('summary', { hasText: /^Custom fields/ }).click();
      const search = page.getByLabel('Search fields');
      if (await search.count() > 0) { await search.fill('zzz-no-such-field'); await expect(page.getByText('No field matches.')).toBeVisible(); await search.fill(''); }
      return `${await page.locator('summary', { hasText: /^Custom fields/ }).innerText()}`;
    });
    await step('Manage tags opens; Delete tag asks "Are you sure?" and Cancel keeps it', async () => {
      const manage = page.locator('summary', { hasText: /^Manage tags/ });
      if (await manage.count() === 0) return 'no tags yet, so the manager is hidden';
      await manage.click();
      await page.getByRole('button', { name: /^Delete tag / }).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });
    await step('Tag many at once: Preview with no tag chosen answers within 8 s (asks for a tag)', async () => {
      await page.locator('summary', { hasText: 'Tag many at once' }).click();
      const began = Date.now();
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
      try {
        await expect(page.getByText(/pick a tag|choose a tag first|Pick a tag/i).first()).toBeVisible({ timeout: 8_000 });
        return `answered after ${((Date.now() - began) / 1000).toFixed(1)} s`;
      } catch {
        const stuck = await page.getByRole('button', { name: /Counting/ }).count();
        // Leave the stuck page so the steps after it measure their own screens.
        await page.goto('/contacts');
        throw new Error(stuck > 0 ? 'BUG: the button stayed on "Counting…" and the page never showed the result (server answered with a redirect that the browser did not follow)' : 'no answer was shown within 8 s');
      }
    });
    await press('Import contacts button', page.getByRole('link', { name: 'Import contacts' }).first(), page.getByRole('heading', { name: /import contacts/i }).first());
    if (!existsSync(CSV)) {
      await step('the CSV file exists', async () => { throw new Error(`file not found: ${CSV}`); });
    } else {
      const copy = join(OUT, 'test-numbers-import.csv');
      copyFileSync(CSV, copy);
      await step('import: upload, rows read', async () => {
        await page.locator('input[type="file"]').setInputFiles(copy);
        const rowsRead = page.getByText(/rows ·/);
        const seenBefore = page.getByText(/already uploaded/);
        await expect(rowsRead.or(seenBefore).first()).toBeVisible({ timeout: 30_000 });
        // An organisation that imported this file in an earlier run refuses the same bytes; that is the feature, so use "Upload anyway".
        if (await seenBefore.first().isVisible()) {
          await page.getByRole('button', { name: 'Upload anyway' }).click();
          await expect(rowsRead).toBeVisible({ timeout: 30_000 });
          return 'the file had been uploaded before, so "Upload anyway" was used: ' + (await rowsRead.first().innerText()).replace(/\s+/g, ' ');
        }
        return (await rowsRead.first().innerText()).replace(/\s+/g, ' ');
      });
      await shot('04-import-mapped');
      await step('import: tick the City column to be stored', async () => { await page.getByLabel('City').check(); });
      await step('import: tag name set', async () => { await page.getByLabel('Tag everyone in this file').fill(TAG); });
      await step('import: Preview', async () => { await page.getByRole('button', { name: 'Preview' }).click(); await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible({ timeout: 30_000 }); });
      await step('import: Import (commit)', async () => {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const done = page.getByText(/✓ Imported/);
        await expect(done).toBeVisible({ timeout: 60_000 });
        return (await done.first().innerText()).replace(/\s+/g, ' ').slice(0, 200);
      });
      await shot('05-import-done');
      await step('import: Start over', async () => { await page.getByRole('button', { name: /Start over|Import another/ }).first().click(); });
      await step('import: the same file again is refused', async () => {
        await page.locator('input[type="file"]').setInputFiles(copy);
        await expect(page.getByText(/already uploaded/)).toBeVisible({ timeout: 30_000 });
        return (await page.getByText(/already uploaded/).first().innerText()).slice(0, 160);
      });
      await step('import: Upload anyway', async () => { await page.getByRole('button', { name: 'Upload anyway' }).click(); await expect(page.getByText(/rows ·/)).toBeVisible({ timeout: 30_000 }); });
      await step('import: tick City, Preview (second time)', async () => {
        await page.getByLabel('City').check();
        await page.getByRole('button', { name: 'Preview' }).click();
        await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible({ timeout: 30_000 });
      });
      await step('import: Import again (people already exist)', async () => {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const done = page.getByText(/✓ Imported/);
        await expect(done).toBeVisible({ timeout: 60_000 });
        return (await done.first().innerText()).replace(/\s+/g, ' ').slice(0, 200);
      });
      // The newest file's name wins (PR #107): a file with the first person's number and another name is previewed (listed as replaced), imported, and then undone by importing the original again.
      const first = readPeople(CSV)[0];
      if (first !== undefined) {
        const renamedCsv = join(OUT, 'renamed.csv');
        const head = readFileSync(CSV, 'utf8').split('\n')[0] ?? '';
        writeFileSync(renamedCsv, `${head}\nRenamed By Audit,${first.phone},${first.email},${first.city}\n`);
        await step('import: start a file with a new name for someone already in the book', async () => {
          await page.getByRole('button', { name: /Start over|Import another/ }).first().click();
          await page.locator('input[type="file"]').setInputFiles(renamedCsv);
          await expect(page.getByText(/rows ·/)).toBeVisible({ timeout: 30_000 });
        });
        await step('import: Preview lists the person whose name would be replaced', async () => {
          await page.getByRole('button', { name: 'Preview' }).click();
          const box = page.getByText(/will have their name replaced/);
          await expect(box).toBeVisible({ timeout: 30_000 });
          return (await page.getByRole('alert', { name: 'Names replaced' }).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220);
        });
        await shot('05b-import-name-replaced-preview');
        await step('import: Import the new name', async () => { await page.getByRole('button', { name: 'Import', exact: true }).click(); await expect(page.getByText(/✓ Imported/)).toBeVisible({ timeout: 60_000 }); });
        await step('import: undo it by importing the original file again', async () => {
          await page.getByRole('button', { name: /Start over|Import another/ }).first().click();
          await page.locator('input[type="file"]').setInputFiles(copy);
          await page.getByRole('button', { name: 'Upload anyway' }).click();
          await expect(page.getByText(/rows ·/)).toBeVisible({ timeout: 30_000 });
          await page.getByRole('button', { name: 'Preview' }).click();
          await expect(page.getByText(/Preview \(nothing written yet\)/)).toBeVisible({ timeout: 30_000 });
          await page.getByRole('button', { name: 'Import', exact: true }).click();
          await expect(page.getByText(/✓ Imported/)).toBeVisible({ timeout: 60_000 });
        });
      }
    }
    const search = async (label: string, q: string, expectation: 'some' | 'none'): Promise<void> => {
      await step(`search "${q}"`, async () => {
        const box = page.getByLabel('Search contacts');
        await box.fill(q);
        await box.press('Enter');
        await page.waitForURL(new RegExp(`q=${encodeURIComponent(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%20/g, '(\\+|%20)')}`), { timeout: 15_000 });
        const summary = page.locator('main').getByText(/\d+\+? (person|people)( match)?\./).first();
        await expect(summary).toBeVisible({ timeout: 15_000 });
        const text = (await summary.innerText()).trim();
        if (expectation === 'none') expect(text).toMatch(/^0 /); else expect(text).not.toMatch(/^0 /);
        return `${label}: ${text}`;
      });
    };
    area = '4 contacts: search';
    await step('open Contacts to search', async () => { await page.goto('/contacts'); await expect(page.getByLabel('Search contacts')).toBeVisible(); });
    const people = readPeople(CSV);
    const first = people[0]; const second = people[1] ?? people[0]; const last = people[people.length - 1];
    if (first === undefined || second === undefined || last === undefined) {
      await step('the CSV has people to search for', async () => { throw new Error(`no rows found in ${CSV}`); });
    } else {
      const words = people.flatMap((p) => p.name.split(' ')).filter((w) => w.length > 2);
      const common = [...new Set(words)].sort((a, b) => words.filter((w) => w === b).length - words.filter((w) => w === a).length)[0] ?? first.name;
      for (const p of people.slice(0, 3)) await search('an imported name', p.name, 'some');
      await search('an imported phone (digits)', first.phone.replace(/\D/g, '').slice(-10), 'some');
      await search('an imported phone (with +)', last.phone, 'some');
      await search('an imported email', second.email, 'some');
      await search('an imported city', last.city, 'some');
      await search('a word they share', common, 'some');
      await search('random: another city', first.city, 'some');
      await search('random: part of a number', second.phone.replace(/\D/g, '').slice(-7), 'some');
      await search('random: an unrelated word', 'zzz-no-such-person', 'none');
    }
    await step('tag filter chip for the import', async () => { await page.goto('/contacts'); await page.getByRole('link', { name: new RegExp(TAG) }).first().click({ timeout: 8_000 }); await page.waitForURL(/tag=/); });

    // ───────────────────────────────────────────────────── 5 · campaign to the imported numbers only
    area = '5 campaigns';
    await press('open Campaigns', nav('Campaigns'), page.getByRole('heading', { name: /campaigns|broadcast/i }).first());
    await press('New campaign', page.getByRole('link', { name: /new campaign|new broadcast|create/i }).first(), page.locator('input[name="name"]'));
    const campaignName = `Session audit ${new Date().toISOString().slice(0, 16)}`;
    let campaignId = '';
    await step('fill the form (name, text, number, the import tag)', async () => {
      await page.locator('input[name="name"]').fill(campaignName);
      await page.locator('textarea[name="body"]').fill(CAMPAIGN_TEXT);
      const pick = async (select: string, text: string): Promise<void> => {
        const value = await page.locator(`select[name="${select}"] option`, { hasText: text }).first().getAttribute('value');
        if (value === null) throw new Error(`no option containing "${text}" in ${select}`);
        await page.locator(`select[name="${select}"]`).selectOption(value);
      };
      await pick('senderIdentityId', sender?.label ?? SENDER_LABEL);
      await pick('fromTagId', TAG);
    });
    await step('template picker and "Build a new template" link are on the form', async () => {
      await expect(page.getByText('Start from a saved template')).toBeVisible();
      await expect(page.getByRole('link', { name: /Build a new template/ })).toBeVisible();
    });
    await step('Create draft (double-clicked on purpose: only one draft may appear)', async () => {
      await page.getByRole('button', { name: /create draft/i }).dblclick();
      await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/, { timeout: 20_000 });
      campaignId = /\/broadcast\/([0-9a-f-]{36})/.exec(page.url())![1]!;
      await expect(page.getByText(/Draft/).first()).toBeVisible();
      await expect(page.getByText(/Draft created/)).toBeVisible();
    });
    await shot('06-campaign-draft');
    await step('only one draft with this name exists after the double click', async () => {
      const list = await api<Array<{ name: string; status: string }>>('/campaigns');
      const same = list.filter((c) => c.name === campaignName);
      expect(same, `${String(same.length)} campaigns named "${campaignName}"`).toHaveLength(1);
    });
    await step('the 14-day warning names the earlier campaign, and the overrides popup is readable', async () => {
      const warn = page.getByText(/already messaged in another campaign/);
      const warned = await warn.count() > 0;
      await page.getByRole('button', { name: 'Start with overrides…' }).click();
      await expect(page.getByRole('heading', { name: 'Start with overrides' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start, lifting the ticked rules' })).toBeVisible();
      await shot('06b-overrides-popup');
      await page.getByRole('button', { name: 'Back' }).click();
      return warned ? (await warn.first().innerText()).slice(0, 160) : 'no cooldown warning (nobody in this audience was messaged recently)';
    });
    await step('Start the campaign', async () => {
      if (process.env.SESSION_OVERRIDE_GATES === '1') {
        // The same people were messaged moments ago by the Inbox step, so the recipient-experience gates would skip them. An admin may lift them with a written reason (audited): done through the Start-with-overrides popup.
        await page.getByRole('button', { name: 'Start with overrides…' }).click();
        const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
        for (const label of [/Engagement lock/, /Cooldown/, /Duplicate campaign/]) await page.getByLabel(label).check();
        await page.getByPlaceholder(/Why\?/).fill('session audit: messages to the operator\'s own test numbers');
        await page.getByRole('button', { name: 'Start, lifting the ticked rules' }).click();
        await dialog.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
        await expect(page.getByText(/Running|Completed|Starting/i).first()).toBeVisible({ timeout: 30_000 });
        return 'started through the overrides popup (audited), because the same people were messaged moments earlier';
      }
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(page.getByText(/Running|Completed/i).first()).toBeVisible({ timeout: 30_000 });
    });
    await step('every recipient settles (sent / delivered / skipped)', async () => {
      type R = Array<{ displayName: string | null; status: string; skipReason: string | null }>;
      let list: R = [];
      await expect.poll(async () => {
        list = await api<R>(`/campaigns/${campaignId}/recipients`);
        return list.length > 0 && list.every((r) => ['sent', 'delivered', 'read', 'skipped', 'failed'].includes(r.status));
      }, { timeout: SEND_WAIT_MS, intervals: [2_000], message: 'every recipient should settle; is a gateway for this number\'s channel running, and is the number under a send limit?' }).toBe(true);
      return `at ${new Date().toISOString()}: ` + list.map((r) => `${r.displayName ?? '?'}=${r.status}${r.skipReason !== null ? `(${r.skipReason})` : ''}`).join('; ');
    });
    await shot('07-campaign-done');
    await step('campaign page after reload', async () => { await page.reload(); await expect(page.getByText(campaignName).first()).toBeVisible(); });

    area = '5b linked numbers';
    await press('open Linked numbers', nav('Linked numbers'), page.getByRole('heading', { name: 'Linked numbers', exact: true }));
    await step('Remove this number asks "Are you sure?" and Cancel keeps it (not confirmed)', async () => {
      await page.getByRole('button', { name: 'Remove this number' }).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });

    // ───────────────────────────────────────────────────── 6 · team: demote the only admin
    area = '6 team';
    await press('open Team', nav('Team'), page.getByRole('heading', { name: /team/i }).first());
    await shot('08-team');
    await step('demote yourself: refused while you are the only admin', async () => {
      const me = page.locator('li', { hasText: '(you)' });
      await expect(me).toBeVisible();
      const role = me.getByRole('combobox');
      const before = await role.inputValue();
      if (before !== 'admin') throw new Error(`expected to start as admin, was ${before}`);
      // Another admin would make this succeed and demote the account being used; stop rather than do that.
      const admins = await page.locator('li').filter({ hasText: /admin/i }).count();
      const options = await role.locator('option').allTextContents();
      const target = options.find((o) => /agent/i.test(o)) ?? options.find((o) => !/admin/i.test(o));
      if (target === undefined) throw new Error(`no lower role in ${JSON.stringify(options)}`);
      await role.selectOption({ label: target });
      const message = page.getByText(/last admin|only admin|another admin|at least one admin|cannot demote|can't demote/i).first();
      const refused = await message.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
      const shownMessage = refused ? (await message.innerText().catch(() => '')).slice(0, 140) : '';
      await page.reload();
      const after = await page.locator('li', { hasText: '(you)' }).getByRole('combobox').inputValue();
      if (after !== 'admin') throw new Error(`DEMOTED to ${after}: the account lost admin (${String(admins)} admin rows listed). Restore it with the database.`);
      if (!refused) throw new Error('role unchanged, but no error message was shown');
      return `refused with: "${shownMessage}"; role still ${after}`;
    });
    await step('Disable on your own row is not allowed', async () => { await expect(page.locator('li', { hasText: '(you)' }).getByRole('button', { name: 'Disable' })).toBeDisabled(); });

    // ───────────────────────────────────────────────────── 7 · AI assistant and its settings
    area = '7 AI assistant';
    await press('open AI assistant', nav('AI assistant'), page.getByRole('heading', { name: 'AI assistant' }).first());
    await shot('09-ai');
    const describe = page.getByLabel('Your description');
    if (!(await describe.isVisible().catch(() => false))) {
      await step('the assistant is switched on', async () => { throw new Error('the describe box is not shown: the assistant is off in this organisation'); });
    } else {
      await step('Write the instructions (the AI answers)', async () => {
        await describe.fill('I run a small bakery called Crumb. Message people about the new sourdough on Friday and answer questions about opening hours, 8 to 6.');
        await page.getByRole('button', { name: 'Write the instructions' }).click();
        await expect(page.getByText(/Written by AI/)).toBeVisible({ timeout: 120_000 });
      });
      await step('instructions are locked; Edit by hand warns', async () => {
        await expect(page.getByLabel(/Instructions for the AI/)).toHaveAttribute('readonly', '');
        await page.getByRole('button', { name: 'Edit by hand' }).click();
        await expect(page.getByText(/behave differently/)).toBeVisible();
        await page.getByRole('button', { name: 'Keep it locked' }).click();
      });
      await shot('10-ai-review');
      const templateName = `Session audit template ${new Date().toISOString().slice(11, 19)}`;
      await step('Save as a template (moves to page 2)', async () => {
        await page.getByLabel('Template name').fill(templateName);
        await page.getByRole('button', { name: 'Save as a template' }).click();
        await expect(page).toHaveURL(/\/ai\/t\//, { timeout: 20_000 });
        await expect(page.getByRole('heading', { name: 'What next?' })).toBeVisible();
      });
      await step('Message a group section opens', async () => { await page.getByRole('button', { name: 'Message a group with this' }).click(); await expect(page.getByRole('region', { name: 'Message a group' })).toBeVisible(); });
      await step('Done for now (back to the AI page)', async () => { await page.getByRole('link', { name: 'Done for now' }).click(); await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible(); });
      await step('delete the template made by this run', async () => {
        page.once('dialog', (d) => { void d.accept(); });
        const row = page.getByRole('listitem').filter({ hasText: templateName });
        await row.getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByRole('listitem').filter({ hasText: templateName })).toHaveCount(0, { timeout: 15_000 });
      });
      await step('one-off order to the assistant (queue)', async () => {
        const note = `Just say hello and confirm you are working. Do not create or change anything. ${Date.now()}`;
        await page.getByLabel('Instruction for the assistant').fill(note);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        const queue = page.getByLabel('AI queue');
        await expect(queue.getByText(note)).toBeVisible({ timeout: 15_000 });
        await expect(queue.getByText(/Instruction · done/).first()).toBeVisible({ timeout: 120_000 });
      });
    }
    await press('AI settings tab', page.getByRole('navigation', { name: 'AI sections' }).getByRole('link', { name: 'AI settings' }), page.getByRole('region', { name: 'In use now' }));
    await shot('11-ai-settings');
    await step('choose Groq, paste the key, Find models', async () => {
      await page.getByLabel('1. Provider').selectOption('groq');
      await page.getByLabel('2. API key').fill(MODEL_KEY);
      await page.getByRole('button', { name: 'Find models' }).click();
      await expect(page.getByText(/\d+ models found/)).toBeVisible({ timeout: 30_000 });
      return (await page.getByText(/\d+ models found/).first().innerText());
    });
    await step('model picker opens and narrows', async () => {
      const model = page.getByLabel('3. Model');
      await model.click();
      await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible();
      await model.fill('gpt-oss-20b');
      await page.getByRole('option', { name: /gpt-oss-20b/ }).first().click();
      await expect(model).toHaveValue(/gpt-oss-20b/);
    });
    await step('Test it (two real calls)', async () => {
      await page.getByRole('button', { name: /Test it/ }).click();
      const ok = page.getByText(/It works\./);
      await expect(ok).toBeVisible({ timeout: 60_000 });
      return (await ok.first().innerText()).replace(/\s+/g, ' ');
    });
    await step('Use this (saved to the settings file)', async () => {
      await page.getByRole('button', { name: 'Use this' }).click();
      await expect(page.getByText(/Saved\. The assistant uses/)).toBeVisible({ timeout: 30_000 });
    });
    await shot('12-ai-settings-saved');
    await step('a wrong key is explained in words', async () => {
      await page.getByLabel('2. API key').fill('not-the-right-key');
      await page.getByRole('button', { name: /Test it/ }).click();
      await expect(page.getByText('The test failed.')).toBeVisible({ timeout: 45_000 });
      return (await page.getByText('The test failed.').locator('..').innerText()).replace(/\s+/g, ' ').slice(0, 220);
    });

    // ───────────────────────────────────────────────────── 8 · security
    area = '8 security';
    await press('open Security', nav('Security'), page.getByRole('heading', { name: 'Encryption keys' }));
    await shot('13-security');
    await step('Current key is shown', async () => { await expect(page.getByText('Current key', { exact: true })).toBeVisible(); });
    await step('Verify with the new key', async () => {
      await page.getByRole('button', { name: 'Verify with the new key' }).click();
      const result = page.getByText(/sampled value/);
      await expect(result).toBeVisible({ timeout: 30_000 });
      return (await result.first().innerText()).replace(/\s+/g, ' ').slice(0, 160);
    });
    await step('every other control on the page is listed (not pressed)', async () => {
      const labels: string[] = [];
      for (const b of await page.getByRole('button').all()) { const t = ((await b.textContent()) ?? '').trim(); if (t !== '') labels.push(t); }
      return `buttons: ${labels.join(' | ')}`;
    });

    // ───────────────────────────────────────────────────── 9 · billing: look, do nothing
    area = '9 billing';
    await press('open Billing (look only)', nav('Billing'), page.locator('main h1').first());
    await shot('14-billing');

    // ───────────────────────────────────────────────────── 10 · dashboard again, sign out
    area = '10 finish';
    await press('back to the dashboard', nav('Overview'), page.locator('main h1').first());
    await step('Sign out', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    });
    await step('the session is really gone', async () => { await page.goto('/contacts'); await expect(page).toHaveURL(/\/login/); });

    writeFileSync(join(OUT, 'timings.json'), JSON.stringify({ startedAt: new Date(t0).toISOString(), totalMs: Date.now() - t0, rows }, null, 2));
    const failed = rows.filter((r) => !r.ok);
    // eslint-disable-next-line no-console
    console.log(`\nSESSION: ${String(rows.length)} steps, ${String(failed.length)} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s\n${failed.map((f) => `  FAILED ${f.area} / ${f.name}: ${f.note}`).join('\n')}`);
  });
});
