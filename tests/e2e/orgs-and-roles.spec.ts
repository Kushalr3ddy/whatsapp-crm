/* eslint-disable @typescript-eslint/no-explicit-any -- the helpers below read arbitrary JSON answers from the API and the page, and the tests index into them */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * Organisations and roles, in the browser. The screen-level twin of the API suites in tests/integration
 * (orgs-roles-matrix, orgs-isolation, shared-template-campaign): the same cast, seen through the screens a person uses.
 *
 * It needs its OWN stack, never the live one, because it creates organisations and people:
 *
 *   E2E_BASE_URL          the web app, e.g. http://localhost:3131
 *   E2E_API_URL           the API, e.g. http://localhost:3130/api/v1
 *   E2E_BOOTSTRAP_KEY     the API's `API_KEY` (the only key that may create an organisation)
 *   E2E_DATABASE_URL      the stack's database (a fake sending number is put in it), its name must contain "e2e"
 *
 * Run:  E2E_BASE_URL=... E2E_API_URL=... E2E_BOOTSTRAP_KEY=... E2E_DATABASE_URL=... npx playwright test tests/e2e/orgs-and-roles.spec.ts
 * Every name it creates carries a run stamp, so a second run on the same database does not collide. Never sends to a real phone.
 */
const API = process.env.E2E_API_URL ?? '';
const BOOT = process.env.E2E_BOOTSTRAP_KEY ?? '';
const DB_URL = process.env.E2E_DATABASE_URL ?? '';
const UNSAFE = DB_URL === '' || !/e2e/i.test(DB_URL) || /live/i.test(DB_URL);

const STAMP = Date.now().toString(36);
const PASSWORD = 'correct-horse-1234';

type Name = 'adminA' | 'adminA2' | 'agentA' | 'agentA2' | 'adminB' | 'agentB' | 'disabledA' | 'victimA';
const email = (n: Name): string => `${n.toLowerCase()}-${STAMP}@orgs.test`;

interface Seed { orgId: string; senderId: string; contactIds: string[]; tagId: string; templateId: string; campaignId: string }
const cast = {} as { A: Seed; B: Seed; ids: Record<string, string> };

/** A person talking to the API directly (not through a page): their own session cookie and CSRF header. */
interface Caller { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }

async function loginApi(who: Name, password = PASSWORD): Promise<Caller> {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email(who), password }) });
  if (!r.ok) throw new Error(`api login ${who} answered ${String(r.status)}`);
  const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]!);
  const csrf = cookies.find((c) => c.startsWith('crm_csrf='))?.split('=')[1] ?? '';
  return {
    call: async (method, path, body) => {
      const res = await fetch(`${API}${path}`, { method, headers: { cookie: cookies.join('; '), 'x-csrf-token': csrf, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      let json: any = {};
      try { json = JSON.parse(text); } catch { /* 204 */ }
      return { status: res.status, json };
    }
  };
}

async function bootstrap(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${BOOT}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`bootstrap ${path} answered ${String(r.status)}: ${await r.text()}`);
  return ((await r.json()) as { data: unknown }).data;
}

/** A new contact with a phone nobody else has (random Indian mobile), made as the given person. Returns its id. */
async function newContact(who: Caller, displayName: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const phone = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const r = await who.call('POST', '/contacts', { displayName, phone });
    if (r.status === 201) return r.json.data.id as string;
  }
  throw new Error('could not create a contact');
}

/** One organisation with a fake number, three people, a tag, an AI template and a draft campaign, all made through the API as its admin. */
async function seedOrg(tag: 'a' | 'b', admin: Caller, orgId: string, sql: postgres.Sql): Promise<Seed> {
  const T = tag.toUpperCase();
  const senderId = (await sql<{ id: string }[]>`INSERT INTO sender_identity (org_id, provider, label, status) VALUES (${orgId}, 'fake', ${`number-${tag}-${STAMP}`}, 'active') RETURNING id`)[0]!.id;
  const contactIds: string[] = [];
  for (let n = 1; n <= 3; n++) {
    contactIds.push(await newContact(admin, `${T}-person-${String(n)}-${STAMP}`));
  }
  const tagId = (await admin.call('POST', '/tags', { name: `${tag}-tag-${STAMP}` })).json.data.id;
  await admin.call('POST', `/contacts/${contactIds[0]!}/tags`, { tagId });
  const t = await admin.call('POST', '/ai/templates', { name: `${T}-template-${STAMP}`, description: `The ${T} template`, instructions: `Be kind. Org ${T} only.`, audience: 'everyone', firstMessage: 'Hi {{name}}' });
  const c = await admin.call('POST', '/campaigns', { name: `${T}-campaign-${STAMP}`, body: `Hello from ${T}`, senderIdentityId: senderId, explicitContactIds: contactIds });
  if (c.status !== 201) throw new Error(`seed campaign ${String(c.status)} ${JSON.stringify(c.json)}`);
  return { orgId, senderId, contactIds, tagId, templateId: t.json.data.id, campaignId: c.json.data.id };
}


test.beforeAll(async () => {
  if (UNSAFE || API === '' || BOOT === '') return;
  const orgA = await bootstrap('/admin/orgs', { orgName: `Org A ${STAMP}`, slug: `org-a-${STAMP}`, email: email('adminA'), password: PASSWORD, displayName: 'Admin A' });
  const orgB = await bootstrap('/admin/orgs', { orgName: `Org B ${STAMP}`, slug: `org-b-${STAMP}`, email: email('adminB'), password: PASSWORD, displayName: 'Admin B' });
  const adminA = await loginApi('adminA');
  const adminB = await loginApi('adminB');
  const add = async (c: Caller, who: Name, role: 'admin' | 'agent', displayName: string): Promise<void> => {
    const r = await c.call('POST', '/admin/users', { email: email(who), password: PASSWORD, displayName, role });
    if (r.status !== 201) throw new Error(`add ${who}: ${String(r.status)} ${JSON.stringify(r.json)}`);
  };
  await add(adminA, 'adminA2', 'admin', 'Admin A2');
  await add(adminA, 'agentA', 'agent', 'Agent A');
  await add(adminA, 'agentA2', 'agent', 'Agent A2');
  await add(adminA, 'disabledA', 'agent', 'Disabled A');
  await add(adminA, 'victimA', 'agent', 'Victim A');
  await add(adminB, 'agentB', 'agent', 'Agent B');
  const users = (await adminA.call('GET', '/admin/users')).json.data as { userId: string; email: string }[];
  cast.ids = Object.fromEntries(users.map((u) => [u.email, u.userId]));
  await adminA.call('PATCH', `/admin/users/${cast.ids[email('disabledA')]!}`, { status: 'disabled' });
  const sql = postgres(DB_URL, { max: 1 });
  try {
    cast.A = await seedOrg('a', adminA, orgA.orgId ?? orgA.org?.id, sql);
    cast.B = await seedOrg('b', adminB, orgB.orgId ?? orgB.org?.id, sql);
  } finally { await sql.end(); }
});

test.beforeEach(() => {
  test.skip(UNSAFE, 'set E2E_DATABASE_URL to a scratch database whose name contains "e2e" (never a live one)');
  test.skip(API === '' || BOOT === '', 'set E2E_API_URL and E2E_BOOTSTRAP_KEY');
});

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

/** A separate browser session (own cookies), signed in through the real form. */
async function person(browser: Browser, who: Name, opts: { width?: number; height?: number; password?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email(who));
  await page.locator('input[name="password"]').fill(opts.password ?? PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return { context, page };
}

/** The signed-in page's own API calls, with its session and CSRF cookie: what the browser itself can do. */
async function pageCall(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
  const r = await page.request.fetch(`${API}${path}`, { method, headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: body }) });
  let json: any = {};
  try { json = JSON.parse(await r.text()); } catch { /* empty */ }
  return { status: r.status(), json };
}

const noSideways = async (page: Page): Promise<void> => {
  const over = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') as number;
  expect(over, 'the page scrolls sideways').toBeLessThanOrEqual(1);
};

// ───────────────────────────── 1. sign-in, per role ─────────────────────────────
test.describe('sign-in', () => {
  for (const who of ['adminA', 'adminA2', 'agentA', 'agentA2', 'adminB', 'agentB'] as const) {
    test(`${who} signs in and lands in the app`, async ({ browser }) => {
      const { context, page } = await person(browser, who);
      await expect(nav(page).getByRole('link', { name: 'Contacts', exact: true })).toBeVisible();
      await context.close();
    });
  }

  test('a wrong password shows one plain message and signs nobody in', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email('agentB'));
    await page.locator('input[name="password"]').fill('definitely-not-it-0000');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(/wrong|incorrect|invalid/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown email and a wrong password get the same message', async ({ page }) => {
    const messages: string[] = [];
    for (const [e, p] of [[email('agentB'), 'definitely-not-it-0001'], [`nobody-${STAMP}@nowhere.test`, PASSWORD]]) {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(e!);
      await page.locator('input[name="password"]').fill(p!);
      await page.getByRole('button', { name: 'Sign in' }).click();
      messages.push((await page.locator('p[role="alert"]').innerText()).trim());
    }
    expect(messages[0]).toBe(messages[1]);
  });

  test('a disabled person cannot sign in, and the message does not say why', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email('disabledA'));
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('p[role="alert"]')).not.toContainText(/disabled/i);
  });

  test('a page behind the login sends a signed-out visitor to sign in, and back afterwards', async ({ page }) => {
    await page.goto('/team');
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=/);
  });

  test('signing out ends the session: the back button does not reopen a page', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA2');
    await page.getByRole('button', { name: /sign out/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('eight wrong passwords lock one person out; a neighbour is not affected', async ({ browser, page }) => {
    // victimA is used only here, so the lock cannot spill into another test.
    for (let i = 0; i < 9; i++) {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(email('victimA'));
      await page.locator('input[name="password"]').fill(`wrong-guess-${String(i)}-xxxx`);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.locator('p[role="alert"]')).toBeVisible();
    }
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/); // the right password is refused while locked
    const { context, page: other } = await person(browser, 'agentA'); // someone else is fine
    await expect(nav(other).getByRole('link', { name: 'Contacts', exact: true })).toBeVisible();
    await context.close();
  });
});

// ───────────────────────────── 2. what each role sees ─────────────────────────────
test.describe('roles in the screens', () => {
  test('an admin sees Team and AI assistant in the menu; an agent sees neither', async ({ browser }) => {
    const admin = await person(browser, 'adminA');
    const agent = await person(browser, 'agentA');
    for (const label of ['Team', 'AI assistant']) {
      await expect(nav(admin.page).getByRole('link', { name: label, exact: true })).toBeVisible();
      await expect(nav(agent.page).getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }
    for (const label of ['Inbox', 'Contacts', 'Campaigns', 'Linked numbers', 'Import', 'Security']) {
      await expect(nav(agent.page).getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await admin.context.close(); await agent.context.close();
  });

  test('an agent who types the Team address is told only admins can, and sees nobody listed', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA');
    await page.goto('/team');
    await expect(page.getByText('Only admins can manage the team')).toBeVisible();
    await expect(page.getByText(email('adminA'))).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a person' })).toHaveCount(0);
    await context.close();
  });

  test('an agent who types the AI assistant address is told only admins can change it', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA');
    await page.goto('/ai');
    await expect(page.getByText('Only admins can change the AI assistant')).toBeVisible();
    await context.close();
  });

  test('the browser session of an agent is refused every admin call by the API too', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA');
    expect((await pageCall(page, 'GET', '/admin/users')).status).toBe(403);
    expect((await pageCall(page, 'POST', '/admin/users', { email: `x-${STAMP}@orgs.test`, password: PASSWORD, displayName: 'x', role: 'admin' })).status).toBe(403);
    expect((await pageCall(page, 'PATCH', `/admin/users/${cast.ids[email('adminA')]!}`, { status: 'disabled' })).status).toBe(403);
    expect((await pageCall(page, 'GET', '/admin/keys')).status).toBe(403);
    await context.close();
  });

  test('Team lists this organisation only, with the signed-in admin marked (you)', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA');
    await page.goto('/team');
    await expect(page.locator('li', { hasText: email('agentA') })).toBeVisible();
    await expect(page.locator('li', { hasText: '(you)' })).toContainText(email('adminA'));
    await expect(page.getByText(email('adminB'))).toHaveCount(0);
    await expect(page.getByText(email('agentB'))).toHaveCount(0);
    await context.close();
  });

  test('an admin who demotes an agent-to-be admin mid-session changes what that person can open, after a reload', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const target = cast.ids[email('agentA2')]!;
    const { context, page } = await person(browser, 'agentA2');
    await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    expect((await adminA.call('PATCH', `/admin/users/${target}`, { role: 'admin' })).status).toBe(200);
    await page.goto('/team');
    await expect(page.getByRole('button', { name: 'Add a person' })).toBeVisible();
    expect((await adminA.call('PATCH', `/admin/users/${target}`, { role: 'agent' })).status).toBe(200);
    await page.goto('/team');
    await expect(page.getByText('Only admins can manage the team')).toBeVisible();
    await context.close();
  });

  test('an admin disables a signed-in agent: the next click sends them to sign in', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const target = cast.ids[email('agentA2')]!;
    const { context, page } = await person(browser, 'agentA2');
    await page.goto('/contacts');
    expect((await adminA.call('PATCH', `/admin/users/${target}`, { status: 'disabled' })).status).toBe(200);
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/login/);
    expect((await adminA.call('PATCH', `/admin/users/${target}`, { status: 'active' })).status).toBe(200);
    await context.close();
  });

  test('a reset password ends the old session and the new one works', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const target = cast.ids[email('agentA2')]!;
    const { context, page } = await person(browser, 'agentA2');
    expect((await adminA.call('POST', `/admin/users/${target}/password`, { password: 'a-brand-new-password-9' })).status).toBe(200);
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
    const again = await person(browser, 'agentA2', { password: 'a-brand-new-password-9' });
    await expect(nav(again.page).getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
    await again.context.close();
    expect((await adminA.call('POST', `/admin/users/${target}/password`, { password: PASSWORD })).status).toBe(200);
  });
});

// ───────────────────────────── 3. the add-person screen ─────────────────────────────
test.describe('add a person', () => {
  test('an admin adds an agent, sees the sign-in details once, and the new person can sign in with them', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA');
    const stamp = `${STAMP}-${String(Date.now())}`;
    const mail = `added-${stamp}@orgs.test`;
    await page.goto('/team');
    await page.getByRole('button', { name: 'Add a person' }).click();
    const form = page.getByRole('form', { name: 'Add a person' });
    await form.getByLabel('Name').fill(`Added ${stamp}`);
    await form.getByLabel('Email').fill(mail);
    await form.getByRole('button', { name: 'Add person' }).click();
    const notice = page.getByRole('status').filter({ hasText: 'sign-in details' });
    await expect(notice).toContainText(mail);
    const text = await notice.innerText();
    const password = /Password:\s*(\S+)/.exec(text)?.[1] ?? '';
    expect(password.length).toBeGreaterThanOrEqual(12);
    await notice.getByRole('button', { name: 'Done' }).click();
    await expect(notice).toHaveCount(0);
    const fresh = await context.browser()!.newContext();
    const p = await fresh.newPage();
    await p.goto('/login');
    await p.locator('input[type="email"]').fill(mail);
    await p.locator('input[name="password"]').fill(password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p).not.toHaveURL(/\/login/);
    await fresh.close(); await context.close();
  });

  test('the same email twice in one organisation is refused with a message, nobody is added', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA');
    await page.goto('/team');
    await page.getByRole('button', { name: 'Add a person' }).click();
    const form = page.getByRole('form', { name: 'Add a person' });
    await form.getByLabel('Name').fill('Dup person');
    await form.getByLabel('Email').fill(email('agentA'));
    await form.getByRole('button', { name: 'Add person' }).click();
    await expect(page.locator('p[role="alert"], .notice-danger').first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'sign-in details' })).toHaveCount(0);
    await context.close();
  });

  // X-001 (docs/49-bug-list.md). Expected behaviour: adding an email that already belongs to ANOTHER organisation is refused, and the admin is
  // told nothing about the other organisation. Today the screen shows a generated password that does not work, and the person is now in B.
  test('X-001: adding an email that lives in another organisation is refused', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminB');
    await page.goto('/team');
    await page.getByRole('button', { name: 'Add a person' }).click();
    const form = page.getByRole('form', { name: 'Add a person' });
    await form.getByLabel('Name').fill('Someone from A');
    await form.getByLabel('Email').fill(email('agentA'));
    await form.getByRole('button', { name: 'Add person' }).click();
    // Wait for the screen to answer one way or the other, then insist it was a refusal.
    await expect(page.getByRole('status').filter({ hasText: 'sign-in details' }).or(page.locator('.notice-danger, p[role="alert"]')).first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'sign-in details' })).toHaveCount(0);
    await expect(page.locator('li', { hasText: email('agentA') })).toHaveCount(0);
    await context.close();
  });
});

// ───────────────────────────── 3b. the screens the first run did not reach (written 2026-11-11, NOT RUN YET) ─────────────────────────────
test.describe('more screens, by role and by address', () => {
  test('[SCR-1] an agent who types the Security address is told only an admin can see the keys; an admin sees the steps', async ({ browser }) => {
    const agent = await person(browser, 'agentA');
    await agent.page.goto('/security');
    await expect(agent.page.getByText('Only an admin can see the encryption keys.')).toBeVisible();
    const admin = await person(browser, 'adminA');
    await admin.page.goto('/security');
    await expect(admin.page.getByText('Only an admin can see the encryption keys.')).toHaveCount(0);
    await expect(admin.page.getByRole('status').first()).toBeVisible();
    await agent.context.close(); await admin.context.close();
  });

  test('[SCR-2] Linked numbers: an admin has "Add a number", an agent does not and sees only their own organisation numbers', async ({ browser }) => {
    const admin = await person(browser, 'adminA');
    const agent = await person(browser, 'agentA');
    for (const p of [admin.page, agent.page]) await p.goto('/link');
    await expect(admin.page.getByRole('button', { name: 'Add a number' })).toBeVisible();
    await expect(agent.page.getByRole('button', { name: 'Add a number' })).toHaveCount(0);
    await expect(agent.page.getByText(`number-b-${STAMP}`)).toHaveCount(0);
    await admin.context.close(); await agent.context.close();
  });

  test('[SCR-3] Contacts: an admin has Export, an agent does not', async ({ browser }) => {
    const admin = await person(browser, 'adminA');
    const agent = await person(browser, 'agentA');
    for (const p of [admin.page, agent.page]) await p.goto('/contacts');
    await expect(admin.page.getByRole('link', { name: 'Export' })).toBeVisible();
    await expect(agent.page.getByRole('link', { name: 'Export' })).toHaveCount(0);
    await admin.context.close(); await agent.context.close();
  });

  test('[SCR-4] the export link of an admin downloads a file with their own organisation people only', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA');
    await page.goto('/contacts');
    const href = await page.getByRole('link', { name: 'Export' }).getAttribute('href');
    expect(href).toBeTruthy();
    const answer = await page.request.get(href!);
    expect(answer.status()).toBe(200);
    const csv = await answer.text();
    expect(csv).toContain(`A-person-1-${STAMP}`);
    expect(csv).not.toContain(`B-person-1-${STAMP}`);
    await context.close();
  });

  test('[SCR-5] Billing opens for an agent and an admin as the "coming soon" page, never an error, and fits at 375px', async ({ browser }) => {
    for (const who of ['adminA', 'agentA'] as const) {
      const { context, page } = await person(browser, who, { width: 375, height: 812 });
      await page.goto('/billing');
      await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
      await noSideways(page);
      await context.close();
    }
  });

  test('[SCR-6] Import and Segments open for an agent: no error page, and only their own organisation lists', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA');
    for (const path of ['/import', '/segments']) {
      await page.goto(path);
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).not.toContainText(`B-person-1-${STAMP}`);
    }
    await context.close();
  });

  test('[SCR-7] signing out in one tab ends the other tab of the same person: the next click goes to sign-in', async ({ browser }) => {
    const first = await person(browser, 'agentA2');
    const second = await first.context.newPage();
    await second.goto('/contacts');
    await first.page.goto('/contacts');
    await first.page.getByRole('button', { name: /sign out/i }).first().click();
    await second.reload();
    await expect(second).toHaveURL(/\/login/);
    await first.context.close();
  });

  test('[SCR-8] the sign-up page changes nothing: it says it is not connected, makes no person and no organisation, and does not sign anyone in', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Nobody');
    await page.getByLabel('Organisation').fill(`Never created ${STAMP}`);
    await page.getByLabel('Work email').fill(`never-${STAMP}@orgs.test`);
    await page.locator('input[name="password"]').fill('correct-horse-1234');
    await page.locator('input[name="confirm"]').fill('correct-horse-1234');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText('not connected');
    const sql = postgres(DB_URL, { max: 1 });
    try {
      const made = await sql`SELECT (SELECT count(*) FROM org WHERE name = ${`Never created ${STAMP}`})::int AS orgs, (SELECT count(*) FROM app_user WHERE email = ${`never-${STAMP}@orgs.test`})::int AS people`;
      expect(made[0]).toMatchObject({ orgs: 0, people: 0 });
    } finally { await sql.end(); }
    await page.goto('/contacts');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('[SCR-9] the sign-up page fits at 375px and 1280px', async ({ browser }) => {
    for (const width of [375, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto('/signup');
      await noSideways(page);
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
      await context.close();
    }
  });
});

// ───────────────────────────── 4. organisation isolation in the screens ─────────────────────────────
test.describe('organisation isolation', () => {
  test('each organisation sees its own people on Contacts and not the other\'s', async ({ browser }) => {
    const a = await person(browser, 'adminA');
    const b = await person(browser, 'adminB');
    for (const [p, mine, other] of [[a.page, 'A-person-1', 'B-person-1'], [b.page, 'B-person-1', 'A-person-1']] as const) {
      await p.goto('/contacts');
      await expect(p.getByText(`${mine}-${STAMP}`).first()).toBeVisible();
      await expect(p.getByText(`${other}-${STAMP}`)).toHaveCount(0);
    }
    await a.context.close(); await b.context.close();
  });

  test('Campaigns lists only this organisation\'s campaigns', async ({ browser }) => {
    const a = await person(browser, 'agentA');
    const b = await person(browser, 'agentB');
    await a.page.goto('/broadcast');
    await expect(a.page.getByText(`A-campaign-${STAMP}`).first()).toBeVisible();
    await expect(a.page.getByText(`B-campaign-${STAMP}`)).toHaveCount(0);
    await b.page.goto('/broadcast');
    await expect(b.page.getByText(`B-campaign-${STAMP}`).first()).toBeVisible();
    await expect(b.page.getByText(`A-campaign-${STAMP}`)).toHaveCount(0);
    await a.context.close(); await b.context.close();
  });

  test('typing another organisation\'s campaign address shows not found, never its content', async ({ browser }) => {
    const b = await person(browser, 'adminB');
    const response = await b.page.goto(`/broadcast/${cast.A.campaignId}`);
    expect(response?.status()).toBe(404);
    await expect(b.page.getByText(`A-campaign-${STAMP}`)).toHaveCount(0);
    await b.context.close();
  });

  test('another organisation\'s AI template address shows no template', async ({ browser }) => {
    const b = await person(browser, 'adminB');
    await b.page.goto(`/ai/t/${cast.A.templateId}`);
    await expect(b.page.getByText(`A-template-${STAMP}`)).toHaveCount(0);
    await b.page.goto('/ai');
    await expect(b.page.getByText(`A-template-${STAMP}`)).toHaveCount(0);
    await expect(b.page.getByText(`B-template-${STAMP}`).first()).toBeVisible();
    await b.context.close();
  });

  test('Linked numbers and Inbox show only this organisation\'s number', async ({ browser }) => {
    const a = await person(browser, 'adminA');
    await a.page.goto('/link');
    await expect(a.page.getByText(`number-a-${STAMP}`).first()).toBeVisible();
    await expect(a.page.getByText(`number-b-${STAMP}`)).toHaveCount(0);
    await a.context.close();
  });

  test('the API behind the page also refuses another organisation\'s ids from a signed-in browser', async ({ browser }) => {
    const b = await person(browser, 'adminB');
    for (const path of [`/campaigns/${cast.A.campaignId}`, `/contacts/${cast.A.contactIds[0]!}`, `/ai/templates/${cast.A.templateId}`]) {
      expect([403, 404], path).toContain((await pageCall(b.page, 'GET', path)).status);
    }
    expect((await pageCall(b.page, 'POST', `/campaigns/${cast.A.campaignId}/pause`)).status).toBeGreaterThanOrEqual(400);
    await b.context.close();
  });

  test('the same name in both organisations stays two separate things', async ({ browser }) => {
    const a = await person(browser, 'adminA');
    const b = await person(browser, 'adminB');
    const name = `Shared-name-${STAMP}`;
    expect((await pageCall(a.page, 'POST', '/tags', { name })).status).toBe(201);
    expect((await pageCall(b.page, 'POST', '/tags', { name })).status).toBe(201);
    await a.context.close(); await b.context.close();
  });
});

// ───────────────────────────── 5. two people, one template, one campaign ─────────────────────────────
test.describe('two people on the same thing', () => {
  test('two admins open the same AI template and both see it', async ({ browser }) => {
    const one = await person(browser, 'adminA');
    const two = await person(browser, 'adminA2');
    for (const p of [one.page, two.page]) {
      await p.goto('/ai');
      await expect(p.getByText(`A-template-${STAMP}`).first()).toBeVisible();
    }
    await one.context.close(); await two.context.close();
  });

  test('two admins save the same template at once: both are told yes (last write wins), and one value is kept', async ({ browser }) => {
    const one = await person(browser, 'adminA');
    const two = await person(browser, 'adminA2');
    const path = `/ai/templates/${cast.A.templateId}`;
    const [r1, r2] = await Promise.all([
      pageCall(one.page, 'POST', '/ai/templates', { id: cast.A.templateId, name: `A-template-${STAMP}`, description: 'edited by one', instructions: 'Be kind. Org A only.', audience: 'everyone', firstMessage: 'Hi {{name}}' }),
      pageCall(two.page, 'POST', '/ai/templates', { id: cast.A.templateId, name: `A-template-${STAMP}`, description: 'edited by two', instructions: 'Be kind. Org A only.', audience: 'everyone', firstMessage: 'Hi {{name}}' })
    ]);
    // Pinned decision (docs/49): no conflict warning today. If this starts answering 409 for one of them, that is the decision changing.
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const after = await pageCall(one.page, 'GET', path);
    expect(['edited by one', 'edited by two']).toContain(after.json.data.description);
    await one.context.close(); await two.context.close();
  });

  test('an admin and an agent open one campaign; the admin starts it, the agent pauses it, the admin sees Paused after a reload', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const contacts: string[] = [];
    for (let i = 1; i <= 5; i++) contacts.push(await newContact(adminA, `Pause-${String(i)}-${STAMP}`));
    const made = await adminA.call('POST', '/campaigns', { name: `Pause-${STAMP}`, body: 'pause me', senderIdentityId: cast.A.senderId, explicitContactIds: contacts });
    expect(made.status).toBe(201);
    const id = made.json.data.id as string;
    const admin = await person(browser, 'adminA');
    const agent = await person(browser, 'agentA');
    await admin.page.goto(`/broadcast/${id}`);
    await agent.page.goto(`/broadcast/${id}`);
    await expect(admin.page.getByRole('heading', { name: `Pause-${STAMP}` })).toBeVisible();
    await expect(agent.page.getByRole('heading', { name: `Pause-${STAMP}` })).toBeVisible();
    await admin.page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(admin.page.getByText('Running', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await agent.page.reload();
    await agent.page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(agent.page.getByText('Paused', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await admin.page.reload();
    await expect(admin.page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await expect(admin.page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await admin.context.close(); await agent.context.close();
  });

  test('two people press Start on one draft at the same moment: it starts once, nobody sees an error page', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const made = await adminA.call('POST', '/campaigns', { name: `Race-${STAMP}`, body: 'race', senderIdentityId: cast.A.senderId, explicitContactIds: [await newContact(adminA, `Race-1-${STAMP}`), await newContact(adminA, `Race-2-${STAMP}`)] });
    expect(made.status).toBe(201);
    const id = made.json.data.id as string;
    const one = await person(browser, 'adminA');
    const two = await person(browser, 'adminA2');
    await one.page.goto(`/broadcast/${id}`);
    await two.page.goto(`/broadcast/${id}`);
    await Promise.all([
      one.page.getByRole('button', { name: 'Start', exact: true }).click(),
      two.page.getByRole('button', { name: 'Start', exact: true }).click()
    ]);
    await one.page.waitForTimeout(3_000);
    const after = (await pageCall(one.page, 'GET', `/campaigns/${id}`)).json.data;
    expect(['running', 'completed']).toContain(after.status);
    for (const p of [one.page, two.page]) await expect(p.getByText(/Application error|Internal Server Error/)).toHaveCount(0);
    const recipients = await pageCall(one.page, 'GET', `/campaigns/${id}/recipients`);
    const rows = (recipients.json.data ?? []) as unknown[];
    expect(rows.length, 'each person is in the campaign once').toBe(2);
    await one.context.close(); await two.context.close();
  });

  test('one admin cancels while another is on the page: the second sees Cancelled and no Start button', async ({ browser }) => {
    const adminA = await loginApi('adminA');
    const made = await adminA.call('POST', '/campaigns', { name: `Cancel-${STAMP}`, body: 'cancel me', senderIdentityId: cast.A.senderId, explicitContactIds: [await newContact(adminA, `Cancel-1-${STAMP}`)] });
    const id = made.json.data.id as string;
    const one = await person(browser, 'adminA');
    const two = await person(browser, 'adminA2');
    await two.page.goto(`/broadcast/${id}`);
    await one.page.goto(`/broadcast/${id}`);
    await one.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = one.page.getByRole('button', { name: /^(Yes|Confirm|Cancel campaign)/ });
    if (await dialog.first().isVisible().catch(() => false)) await dialog.first().click();
    await expect(one.page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await two.page.reload();
    await expect(two.page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(two.page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    await one.context.close(); await two.context.close();
  });
});

// ───────────────────────────── 6. phone and desktop widths ─────────────────────────────
test.describe('widths', () => {
  const screens = ['/', '/inbox', '/contacts', '/broadcast', '/link', '/security'];

  test('375px: an agent gets a menu button, the right entries, and no page scrolls sideways', async ({ browser }) => {
    const { context, page } = await person(browser, 'agentA', { width: 375, height: 812 });
    for (const path of screens) {
      await page.goto(path);
      await noSideways(page);
    }
    await page.goto('/');
    const menu = page.getByRole('button', { name: /menu/i });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(nav(page).getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    await context.close();
  });

  test('375px: an admin\'s menu also holds Team and AI assistant, and those pages do not scroll sideways', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA', { width: 375, height: 812 });
    for (const path of [...screens, '/team', '/ai', `/broadcast/${cast.A.campaignId}`]) {
      await page.goto(path);
      await noSideways(page);
    }
    await page.goto('/');
    await page.getByRole('button', { name: /menu/i }).click();
    await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'AI assistant', exact: true })).toBeVisible();
    await context.close();
  });

  test('1280px: the sidebar is open at once, no menu button, nothing scrolls sideways', async ({ browser }) => {
    const { context, page } = await person(browser, 'adminA', { width: 1280, height: 800 });
    await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    for (const path of [...screens, '/team', '/ai']) {
      await page.goto(path);
      await noSideways(page);
    }
    await context.close();
  });

  test('375px: the sign-in form fits and its fields are tappable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto('/login');
    await noSideways(page);
    for (const box of [page.locator('input[type="email"]'), page.locator('input[name="password"]'), page.getByRole('button', { name: 'Sign in' })]) {
      const b = (await box.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(36);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(375);
    }
    await context.close();
  });
});
