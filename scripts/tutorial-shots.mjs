// Takes the screenshots for the user tutorial (docs/CRM-user-tutorial.pdf) from a running app, signed in as a
// DEMO org that holds only invented people. Run with `npm run tutorial:shots -- <output folder>`.
//
// It never touches real data: it signs in as the demo admin created for this purpose and stops before anything
// is sent or imported. Prerequisites (see scripts/build-tutorial.mjs for the whole recipe):
//   npm run admin -- org --name "Demo Co" --slug demo-tutorial --email demo@example.test --password '<pw>'
//   TEST_ORG_SLUG=demo-tutorial TEST_EMAIL=demo@example.test TEST_PASSWORD='<pw>' npm run local:seed
//   the app on http://localhost:3001 (`npm run dev:fast` is quickest)
//
// Numbered red markers are drawn onto the page before each shot, so the text can say "press (2)".
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'tutorial-shots');
const base = process.env.TUTORIAL_BASE ?? 'http://localhost:3001';
const email = process.env.TUTORIAL_EMAIL ?? 'demo@example.test';
const password = process.env.TUTORIAL_PASSWORD ?? 'DemoTutorial!2026';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5 });
// Light theme prints better than dark.
await ctx.addInitScript(() => { try { localStorage.setItem('crm.theme', 'light'); } catch { /* ignore */ } });
const page = await ctx.newPage();

/** Draws numbered markers at the top-left of each target, so the text can point at them. */
async function mark(targets) {
  const spots = [];
  for (const [n, locator] of targets) {
    const box = await locator.first().boundingBox({ timeout: 3000 }).catch(() => null);
    if (box !== null) spots.push({ n, x: box.x, y: box.y });
  }
  await page.evaluate((list) => {
    for (const s of list) {
      const el = document.createElement('div');
      el.className = 'tutorial-marker';
      el.textContent = String(s.n);
      el.style.cssText = `position:fixed;left:${Math.max(2, s.x - 3)}px;top:${Math.max(2, s.y - 26)}px;width:22px;height:22px;border-radius:9999px;`
        + 'background:#dc2626;color:#fff;font:700 13px/22px Inter,system-ui,sans-serif;text-align:center;z-index:99999;'
        + 'box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.35);pointer-events:none';
      document.body.appendChild(el);
    }
  }, spots);
}

/** Removes the markers again. */
async function unmark() {
  await page.evaluate(() => { for (const e of document.querySelectorAll('.tutorial-marker')) e.remove(); });
}

/** Saves a screenshot of the viewport. */
async function shot(name) {
  await page.waitForTimeout(500);
  // Crop away the empty space under a short page. A page that fills the window (the inbox) is left whole.
  const vp = page.viewportSize();
  const bottom = await page.evaluate(() => {
    const main = document.querySelector('main');
    return main === null ? null : Math.ceil(main.getBoundingClientRect().bottom);
  });
  const height = bottom !== null && bottom < vp.height - 40 ? Math.max(360, bottom + 28) : vp.height;
  await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: 0, width: vp.width, height } });
  await unmark();
}

/** Opens a page and gives it a moment to settle. */
async function go(path, height) {
  if (height !== undefined) await page.setViewportSize({ width: 1360, height });
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(900);
}

// 01 · sign in ----------------------------------------------------------------------------------
await go('/login', 760);
await shot('01-login');
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="password"]').fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));

// 02 · overview -----------------------------------------------------------------------------------
await go('/', 700);
await mark([
  [1, page.getByRole('navigation', { name: 'Main' })],
  [2, page.getByRole('link', { name: 'Import contacts' })],
  [3, page.getByRole('link', { name: 'New campaign' })],
  [4, page.getByText('Latest conversations')]
]);
await shot('02-overview');

// 03 · inbox and a thread -------------------------------------------------------------------------
await go('/inbox', 760);
await mark([
  [1, page.getByRole('button', { name: 'Mine', exact: true })],
  [2, page.getByRole('button', { name: 'Open', exact: true })],
  [3, page.locator('a[href^="/inbox/"]').first()]
]);
await shot('03-inbox');

await page.locator('a[href^="/inbox/"]').filter({ hasText: 'Asha Rao' }).first().click();
await page.getByRole('button', { name: 'Resolve', exact: true }).waitFor();
await page.waitForTimeout(600);
await mark([
  [1, page.getByLabel('Assignee')],
  [2, page.getByRole('button', { name: 'Resolve', exact: true })],
  [3, page.getByLabel('Add participant')],
  [4, page.getByRole('button', { name: 'Reply', exact: true })],
  [5, page.getByRole('button', { name: 'Note', exact: true })]
]);
await shot('04-thread');

// An internal note, typed but not saved.
await page.getByRole('button', { name: 'Note', exact: true }).click();
await page.getByPlaceholder('Add an internal note').fill('Asked about night shifts; call back after 4pm.');
await mark([[1, page.getByPlaceholder('Add an internal note')], [2, page.getByRole('button', { name: 'Add note' })]]);
await shot('05-note');

// 06 · contacts -----------------------------------------------------------------------------------
await go('/contacts', 860);
await mark([
  [1, page.getByPlaceholder('Search by name, phone or email…')],
  [2, page.getByText('Tag:', { exact: false }).first()],
  [3, page.getByText('Tag many at once')],
  [4, page.getByText('Campaign from checked contacts')],
  [5, page.getByRole('link', { name: 'Import contacts' }).first()]
]);
await shot('06-contacts');

// 07 · import wizard -----------------------------------------------------------------------------
await go('/import', 760);
await shot('07-import-upload');
const stamp = String(Date.now());
const csv = `Full Name,Mobile,Email,City\nMira Das,+12025550201,mira${stamp}@example.test,Pune\nNikhil Rao,+12025550202,nikhil${stamp}@example.test,Delhi\nOmi Jain,+12025550203,omi${stamp}@example.test,Mumbai\n`;
await page.locator('input[type="file"]').setInputFiles({ name: 'new-contacts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.getByText('Which columns hold phone numbers?').waitFor();
await page.setViewportSize({ width: 1360, height: 1500 });
await mark([
  [1, page.getByText('Which columns hold phone numbers?')],
  [2, page.getByText('Name and email').first()],
  [3, page.getByText('Select the columns to be stored')],
  [4, page.getByRole('button', { name: 'Preview', exact: true })],
  [5, page.getByRole('button', { name: 'Import', exact: true })],
  [6, page.getByRole('button', { name: 'Start over' })]
]);
await shot('08-import-match');
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByText(/Preview \(nothing written yet\)/).waitFor();
await page.waitForTimeout(500);
await shot('09-import-preview');
await page.getByRole('button', { name: 'Start over' }).click();

// 10 · linked numbers -----------------------------------------------------------------------------
await go('/link', 760);
await mark([[1, page.getByRole('link', { name: 'Add a number' }).or(page.getByRole('button', { name: 'Add a number' }))], [2, page.getByText('Healthy').first()], [3, page.getByText('Advisory mode')]]);
await shot('10-link');

// 11 · campaigns ----------------------------------------------------------------------------------
await go('/broadcast', 760);
await shot('11-campaigns');
await go('/broadcast/new', 1500);
await page.locator('input[name="name"]').fill('Friday walk-in reminder');
await page.locator('textarea[name="body"]').fill('{Hi|Hello} {{name}}, a reminder that our walk-in interview is this Friday at 10am. Reply YES if you can make it.');
const tagOptions = await page.locator('select[name="fromTagId"] option').allTextContents();
const leads = tagOptions.find((t) => t.includes('seed-leads'));
if (leads !== undefined) await page.locator('select[name="fromTagId"]').selectOption({ label: leads });
await mark([
  [1, page.getByLabel('Write with AI', { exact: true })],
  [2, page.locator('input[name="name"]')],
  [3, page.locator('textarea[name="body"]')],
  [4, page.getByRole('tab', { name: 'A tag' })],
  [5, page.getByRole('tab', { name: 'Build a filter' })]
]);
await shot('12-campaign-new');

await go('/broadcast', 760);
await page.locator('a[href^="/broadcast/"]').filter({ hasText: 'Friday walk-in reminder' }).first().click();
await page.waitForURL(/\/broadcast\/[0-9a-f-]{36}/);
await page.getByText('Dry run').waitFor();
await page.waitForTimeout(600);
await page.setViewportSize({ width: 1360, height: 1100 });
await shot('13-campaign-detail');

// 14 · team ---------------------------------------------------------------------------------------
await go('/team', 760);
await shot('14-team');

// 15 · AI assistant -------------------------------------------------------------------------------
await go('/ai', 1500);
await mark([
  [1, page.getByLabel('Instruction for the assistant')],
  [2, page.getByRole('heading', { name: 'Queue' })],
  [3, page.getByRole('button', { name: 'Cancel' }).first()],
  [4, page.getByText('I understand that contact messages are shared with the AI provider.')],
  [5, page.getByLabel('AI assistant is on')],
  [6, page.getByLabel('What it may talk about, and how')],
  [7, page.getByLabel(/may start and resume campaigns by itself/)]
]);
await shot('15-ai');

// 16 · security -----------------------------------------------------------------------------------
await go('/security', 900);
await shot('16-security');

await browser.close();
process.stdout.write(`screenshots saved in ${out}\n`);
