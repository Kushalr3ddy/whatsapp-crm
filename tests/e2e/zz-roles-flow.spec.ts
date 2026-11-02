import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { signIn, CREDS_MISSING, EMAIL } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * Real WhatsApp mode. Off by default, so `npm run verify` and CI use the fake number and nothing
 * leaves the machine. `npm run test:roles:live` sets it: the messages then go out from the linked
 * number to `LIVE_SEND_TO` (the operator's own phone, from `.env`), and nowhere else.
 */
const LIVE = process.env.ROLES_LIVE === '1';
const LIVE_TO = (process.env.LIVE_SEND_TO ?? '').trim();

/**
 * The fixed agent used by this suite. A test-only login for the local/CI test org; created on
 * the first run and reused afterwards so repeated runs do not pile up users.
 */
const AGENT_EMAIL = process.env.ROLES_AGENT_EMAIL ?? 'roles-agent@test.local';
const AGENT_PASSWORD = process.env.ROLES_AGENT_PASSWORD ?? 'roles-agent-pass-1234';
const AGENT_NAME = 'Role Agent';

/** What an API call returned: the status and the parsed body (empty for a 204). */
interface CallResult { status: number; json: Record<string, unknown> }

/** A request-capable principal: a signed-in page plus the CSRF header its writes need. */
interface Actor {
  page: Page;
  name: string;
  userId: string;
  /** Calls the API as this person and returns status + parsed body. */
  call: (method: string, path: string, body?: unknown) => Promise<CallResult>;
}

/** Signs a page in through the real login form and returns once the app chrome is showing. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Contacts', exact: true }))
    .toBeVisible();
}

/** Wraps a signed-in page as an actor that can call the API with its own session. */
async function actorFor(page: Page, name: string): Promise<Actor> {
  const csrf = async (): Promise<string> =>
    (await page.context().cookies()).find((c) => c.name === 'crm_csrf')?.value ?? '';
  const call: Actor['call'] = async (method, path, body) => {
    const r = await page.request.fetch(`${API}${path}`, {
      method,
      headers: { 'x-csrf-token': await csrf(), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { data: body })
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* empty body, e.g. 204 */ }
    return { status: r.status(), json };
  };
  const me = (await call('GET', '/auth/me')).json.data as { userId: string };
  return { page, name, userId: me.userId, call };
}

/** Opens a second, isolated browser session: its own cookies, so two people can be signed in. */
async function newPerson(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/**
 * Two people, one chat, one phone number: an admin and an agent each use the product against
 * the same conversation, and every admin action is checked from both sides.
 *
 * The order is a story: the admin writes to the number, both open the chat and see each other,
 * the agent is locked out of a chat that is not theirs and refused every admin-only action,
 * then the admin brings them on as a participant, takes them off, and hands the chat over.
 *
 * The `zz-` prefix is deliberate: Playwright runs files alphabetically, and this one queues a
 * handful of messages that the gateway drains a few seconds apart. Run last, they cannot
 * delay the other send tests' single message past its wait.
 *
 * Typing and the "send anyway?" warning (D-54) are exercised too: each person sees the other
 * typing, and a second reply seconds after the first is held until acknowledged.
 */
test.describe('two roles on one chat: admin and agent', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');
  test.skip(LIVE && LIVE_TO === '', 'ROLES_LIVE=1 needs LIVE_SEND_TO in .env (your own phone)');

  test('assign, lock, participants, authorship, presence, typing, collision and refusals', async ({ page, browser }) => {
    test.setTimeout(LIVE ? 8 * 60_000 : 3 * 60_000);

    // ── cast ───────────────────────────────────────────────────────────────────────────
    await signIn(page);
    const adminBase = await actorFor(page, 'admin');
    const users = (await adminBase.call('GET', '/users')).json.data as Array<{ id: string; displayName: string }>;
    const adminName = users.find((u) => u.id === adminBase.userId)?.displayName ?? EMAIL;
    const admin: Actor = { ...adminBase, name: adminName };

    // The agent: create on first run (409 means they already exist, which is fine).
    const made = await admin.call('POST', '/admin/users', {
      email: AGENT_EMAIL, password: AGENT_PASSWORD, displayName: AGENT_NAME, role: 'agent'
    });
    expect([201, 409], `creating the agent: ${JSON.stringify(made.json)}`).toContain(made.status);

    const second = await newPerson(browser);
    await signInAs(second.page, AGENT_EMAIL, AGENT_PASSWORD);
    const agent = await actorFor(second.page, AGENT_NAME);
    expect(agent.userId).not.toBe(admin.userId);

    // ── the number and the person they text ────────────────────────────────────────────
    const senders = (await admin.call('GET', '/senders')).json.data as Array<{
      id: string; label: string; provider: string; connectionState: string | null;
    }>;
    const sender = LIVE
      ? senders.find((s) => s.provider === 'baileys' && s.connectionState === 'open')
      : senders.find((s) => s.label === 'Seed number' && s.connectionState === 'open');
    test.skip(sender === undefined, LIVE
      ? 'needs a linked, connected WhatsApp number (run the real gateway: npm run dev:all)'
      : 'needs the seeded fake number connected (npm run local:seed, gateway with GATEWAY_CHANNEL=fake)');
    // One fixed number in a corner of the fiction range no other spec or seed uses (0103 to 0109),
    // so it can never be a contact another test flagged do-not-contact or already messaged.
    const to = LIVE ? LIVE_TO : '+12025550105';

    const first = await admin.call('POST', '/messages', {
      to, body: `roles test ${String(Date.now())}: admin opens the chat`, senderId: sender!.id
    });
    expect(first.status, JSON.stringify(first.json)).toBe(202);
    const conv = (first.json.data as { conversationId: string }).conversationId;

    // Start from a known state, whatever a previous run left on this chat.
    await admin.call('PATCH', `/conversations/${conv}`, { assigneeUserId: null });
    const before = (await admin.call('GET', `/conversations/${conv}`)).json.data as {
      participants: Array<{ userId: string }>; contactId: string;
    };
    for (const p of before.participants) await admin.call('DELETE', `/conversations/${conv}/participants/${p.userId}`);
    await admin.call('PUT', `/contacts/${before.contactId}/do-not-contact`, { value: false });

    // Replies from the two people land seconds apart in this story, which the collision warning
    // (D-54) is built to hold; those steps acknowledge it, and the collision step tests it.
    const reply = (who: Actor, text: string) =>
      who.call('POST', '/messages', {
        conversationId: conv, body: `${text} ${String(Date.now())}`, acknowledgeCollision: true
      });

    // ── 1 · the first message was accepted (live: it really reaches your phone) ────────
    // On the fake number the gateway spaces messages a few seconds apart, and delivery speed is send-flow's concern, so here
    // "accepted" is enough. On the real number the point is that your phone buzzes, so wait.
    await test.step(LIVE ? 'the admin’s message reaches the real number' : 'the admin’s message is accepted', async () => {
      await expect.poll(async () => {
        const rows = (await admin.call('GET', `/conversations/${conv}/messages`)).json.data as Array<{ status: string }>;
        return rows.at(-1)?.status ?? 'none';
      }, { timeout: LIVE ? 240_000 : 20_000, intervals: [2_000] })
        .toMatch(LIVE ? /^(sent|delivered|read)$/ : /^(queued|sent|delivered|read)$/);
    });

    // ── 2 · authorship: the thread says who sent it ───────────────────────────────────
    await test.step('authorship names the sender', async () => {
      const rows = (await admin.call('GET', `/conversations/${conv}/messages`)).json.data as Array<{
        direction: string; sentByName: string | null;
      }>;
      expect(rows.filter((m) => m.direction === 'outbound').at(-1)?.sentByName).toBe(adminName);
    });

    // ── 3 · presence: each sees the other has the chat open ───────────────────────────
    await test.step('presence: each person sees the other viewing', async () => {
      await page.goto(`/inbox/${conv}`);
      await second.page.goto(`/inbox/${conv}`);
      // Heartbeat every 12 s plus the inbox's 5 s refresh, so allow a few cycles.
      await expect(page.getByText(new RegExp(`${AGENT_NAME}.*viewing`))).toBeVisible({ timeout: 45_000 });
      await expect(second.page.getByText(new RegExp(`${adminName}.*viewing`))).toBeVisible({ timeout: 45_000 });
    });

    // ── 4 · assignment and the lock ───────────────────────────────────────────────────
    await test.step('the admin takes the chat; the agent is locked out', async () => {
      const assign = await admin.call('PATCH', `/conversations/${conv}`, { assigneeUserId: admin.userId });
      expect(assign.status).toBe(200);
      const refused = await reply(agent, 'agent tries to reply');
      expect(refused.status).toBe(409);
      expect(refused.json.code).toBe('THREAD_ASSIGNED');
      // The agent's inbox does not list it under Mine.
      const mine = (await agent.call('GET', '/conversations?assignee=me')).json.data as Array<{ id: string }>;
      expect(mine.map((c) => c.id)).not.toContain(conv);
    });

    // ── 5 · every admin-only action, attempted by the agent, is refused ───────────────
    await test.step('the agent is refused every admin-only action', async () => {
      const refusals: Array<[string, CallResult]> = [
        ['add a participant', await agent.call('POST', `/conversations/${conv}/participants`, { userId: agent.userId })],
        ['remove a participant', await agent.call('DELETE', `/conversations/${conv}/participants/${admin.userId}`)],
        ['create a user', await agent.call('POST', '/admin/users', {
          email: 'nobody@test.local', password: 'x'.repeat(14), displayName: 'Nobody', role: 'admin' })],
        ['override a campaign gate', await agent.call('POST', '/campaigns/00000000-0000-4000-8000-000000000000/start',
          { overrideGates: ['cooldown'], reason: 'agent trying to skip the cooldown' })]
      ];
      for (const [what, r] of refusals) expect(r.status, `agent should not be able to ${what}`).toBe(403);
    });

    await test.step('do-not-contact: the agent cannot override it, the admin can', async () => {
      // The thread lock answers before do-not-contact does, so free the chat for this step: the
      // agent must be allowed to reply for do-not-contact to be what stops them.
      await admin.call('PATCH', `/conversations/${conv}`, { assigneeUserId: null });
      await admin.call('PUT', `/contacts/${before.contactId}/do-not-contact`, { value: true });
      const plain = await agent.call('POST', '/messages', { conversationId: conv, body: 'should not go' });
      expect(plain.status).toBe(422);
      expect(plain.json.code).toBe('DO_NOT_CONTACT');
      const sneaky = await agent.call('POST', '/messages', {
        conversationId: conv, body: 'should not go', overrideDnc: true, overrideReason: 'agent trying to override'
      });
      expect(sneaky.status).toBe(403);
      // The admin may, with a reason, and it is audited server-side.
      const allowed = await admin.call('POST', '/messages', {
        conversationId: conv, body: `admin override ${String(Date.now())}`,
        overrideDnc: true, overrideReason: 'roles test: admin override is allowed',
        acknowledgeCollision: true
      });
      expect(allowed.status).toBe(202);
      await admin.call('PUT', `/contacts/${before.contactId}/do-not-contact`, { value: false });
      // And back to the admin's own chat for the participant steps.
      await admin.call('PATCH', `/conversations/${conv}`, { assigneeUserId: admin.userId });
    });

    // ── 6 · participants: the admin brings the agent on, then takes them off ──────────
    await test.step('the admin adds the agent as a participant; they can reply and see it in Mine', async () => {
      const added = await admin.call('POST', `/conversations/${conv}/participants`, { userId: agent.userId });
      expect(added.status).toBe(201);
      const replied = await reply(agent, 'agent replies as a participant');
      expect(replied.status).toBe(202);
      const mine = (await agent.call('GET', '/conversations?assignee=me')).json.data as Array<{ id: string }>;
      expect(mine.map((c) => c.id)).toContain(conv);
      const rows = (await agent.call('GET', `/conversations/${conv}/messages`)).json.data as Array<{
        direction: string; sentByName: string | null;
      }>;
      expect(rows.filter((m) => m.direction === 'outbound').some((m) => m.sentByName === AGENT_NAME)).toBe(true);
    });

    await test.step('typing: each person sees the other typing', async () => {
      // The agent drafts a reply: the admin's open thread says so within a poll or two.
      expect((await agent.call('POST', `/conversations/${conv}/typing`)).status).toBe(204);
      await expect(page.getByText(new RegExp(`${AGENT_NAME} is typing`))).toBeVisible({ timeout: 20_000 });
      // And the other way round, on the agent's page.
      expect((await admin.call('POST', `/conversations/${conv}/typing`)).status).toBe(204);
      await expect(second.page.getByText(new RegExp(`${adminName} is typing`))).toBeVisible({ timeout: 20_000 });
    });

    await test.step('collision: a second reply seconds after the first asks "send anyway?"', async () => {
      // Get the admin's box ready first, so the page work cannot eat into the 15 s window.
      // A fresh stack briefly reads the number as down, which drops the box to Note mode and does
      // not switch back by itself, so choose Reply explicitly once it can send.
      const replyTab = page.getByRole('button', { name: 'Reply', exact: true });
      await expect(replyTab).toBeEnabled({ timeout: 30_000 });
      await replyTab.click();
      const text = `admin answers via the box ${String(Date.now())}`;
      const box = page.locator('form textarea').first();
      await box.fill(text);

      // Now the agent replies; moments later the admin tries to as well.
      expect((await reply(agent, 'agent answers first')).status).toBe(202);
      const held = await admin.call('POST', '/messages', { conversationId: conv, body: 'admin answers too' });
      expect(held.status).toBe(409);
      expect(held.json.code).toBe('COLLISION');
      expect(String(held.json.detail)).toContain(AGENT_NAME);

      // In the box: Enter shows the warning, and "Send anyway" sends.
      await box.press('Enter');
      await expect(page.getByText(/just replied to this chat/)).toBeVisible();
      await page.getByRole('button', { name: 'Send anyway' }).click();
      await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
    });

    await test.step('the admin removes the agent; they are locked out again', async () => {
      const removed = await admin.call('DELETE', `/conversations/${conv}/participants/${agent.userId}`);
      expect(removed.status).toBe(204);
      expect((await reply(agent, 'agent tries again')).status).toBe(409);
    });

    // ── 7 · hand-over: reassigning gives the agent the chat ───────────────────────────
    await test.step('the admin hands the chat to the agent; the old owner can still step in as admin', async () => {
      const handed = await admin.call('PATCH', `/conversations/${conv}`, { assigneeUserId: agent.userId });
      expect(handed.status).toBe(200);
      expect((await reply(agent, 'agent replies as the new owner')).status).toBe(202);
      expect((await reply(admin, 'admin steps in')).status).toBe(202);
      const mine = (await agent.call('GET', '/conversations?assignee=me')).json.data as Array<{ id: string }>;
      expect(mine.map((c) => c.id)).toContain(conv);
    });

    await second.context.close();
  });
});
