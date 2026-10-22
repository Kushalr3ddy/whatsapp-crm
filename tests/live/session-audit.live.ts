import { test, expect, type Locator } from '@playwright/test';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

    /** Runs one step, times it, keeps going if it fails, and takes a screenshot when it does. */
    async function step(name: string, body: () => Promise<string | void>): Promise<boolean> {
      const started = Date.now();
      let ok = true; let note = '';
      try { note = (await body()) ?? ''; }
      catch (error) {
        ok = false; note = String(error instanceof Error ? error.message : error).split('\n').slice(0, 3).join(' ').slice(0, 300);
        await page.screenshot({ path: join(OUT, `FAILED-${String(rows.length + 1).padStart(3, '0')}.png`) }).catch(() => undefined);
      }
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
        }, { timeout: 5 * 60_000, intervals: [2_000] }).toBe(true);
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
    await press('Import contacts button', page.getByRole('link', { name: 'Import contacts' }).first(), page.getByRole('heading', { name: /import contacts/i }).first());
    if (!existsSync(CSV)) {
      await step('the CSV file exists', async () => { throw new Error(`file not found: ${CSV}`); });
    } else {
      const copy = join(OUT, 'test-numbers-import.csv');
      copyFileSync(CSV, copy);
      await step('import: upload, rows read', async () => {
        await page.locator('input[type="file"]').setInputFiles(copy);
        await expect(page.getByText(/rows ·/)).toBeVisible({ timeout: 30_000 });
        return (await page.getByText(/rows ·/).first().innerText()).replace(/\s+/g, ' ');
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
    await search('imported name', 'Test Phone One', 'some');
    await search('imported name', 'Test Phone Two', 'some');
    await search('imported name', 'Test Phone Three', 'some');
    await search('imported phone (digits)', '9035524447', 'some');
    await search('imported phone (with +)', '+34644766643', 'some');
    await search('imported email', 'test2@example.test', 'some');
    await search('imported city', 'Madrid', 'some');
    await search('shared word', 'Phone', 'some');
    await search('random: a city', 'Bengaluru', 'some');
    await search('random: part of a number', '4122631', 'some');
    await search('random: unrelated word', 'zzz-no-such-person', 'none');
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
    await step('Create draft', async () => {
      await page.getByRole('button', { name: /create draft/i }).click();
      await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/, { timeout: 20_000 });
      campaignId = /\/broadcast\/([0-9a-f-]{36})/.exec(page.url())![1]!;
      await expect(page.getByText(/Draft/).first()).toBeVisible();
    });
    await shot('06-campaign-draft');
    await step('Start the campaign', async () => {
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(page.getByText(/Running|Completed/i).first()).toBeVisible({ timeout: 30_000 });
    });
    await step('every recipient settles (sent / delivered / skipped)', async () => {
      type R = Array<{ displayName: string | null; status: string; skipReason: string | null }>;
      let list: R = [];
      await expect.poll(async () => {
        list = await api<R>(`/campaigns/${campaignId}/recipients`);
        return list.length > 0 && list.every((r) => ['sent', 'delivered', 'read', 'skipped', 'failed'].includes(r.status));
      }, { timeout: 8 * 60_000, intervals: [2_000] }).toBe(true);
      return `at ${new Date().toISOString()}: ` + list.map((r) => `${r.displayName ?? '?'}=${r.status}${r.skipReason !== null ? `(${r.skipReason})` : ''}`).join('; ');
    });
    await shot('07-campaign-done');
    await step('campaign page after reload', async () => { await page.reload(); await expect(page.getByText(campaignName).first()).toBeVisible(); });

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
