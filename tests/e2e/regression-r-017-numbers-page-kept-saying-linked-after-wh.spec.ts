import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { CREDS_MISSING, EMAIL, signIn } from './helpers';

/**
 * R-017 (2026-10-30, area: numbers, found by: Mikhil, live test 2026-10-30)
 * What broke: Numbers page kept saying Linked after WhatsApp removed the device
 *
 * Steps to reproduce: link a number, leave the Numbers page open, remove the device on the phone
 * (Linked devices). The gateway records `logged_out` within a second, but the page was drawn once and
 * never read the state again, so it kept saying "Linked" until someone reloaded it.
 *
 * The test plays the gateway's part by writing the same rows it writes, while the page stays open.
 */
test.skip(CREDS_MISSING, 'TEST_EMAIL / TEST_PASSWORD are not set');

/** Longer than one status check (5 s) plus a page refresh, shorter than anyone would wait. */
const CATCH_UP_MS = 15_000;

/** A linked, connected number in the test admin's org, as the gateway leaves one after a scan. */
async function seedLinked(sql: postgres.Sql, label: string): Promise<string> {
  const [who] = await sql`
    SELECT m.org_id AS org FROM app_user u JOIN org_membership m ON m.user_id = u.id WHERE u.email = ${EMAIL}`;
  if (who === undefined) throw new Error('the test admin has no org');
  const [sender] = await sql`
    INSERT INTO sender_identity (org_id, provider, label, status)
    VALUES (${who.org}, 'baileys', ${label}, 'active') RETURNING id`;
  await sql`
    INSERT INTO channel_session (sender_identity_id, connection_state, last_connected_at)
    VALUES (${sender!.id}, 'open', now())`;
  await sql`
    INSERT INTO channel_auth_state (sender_identity_id, key, value_enc)
    VALUES (${sender!.id}, 'creds', ${Buffer.from('e2e')})`;
  return sender!.id as string;
}

/** What the gateway writes when WhatsApp ends the session (401) and it clears the dead credentials. */
async function dropLink(sql: postgres.Sql, senderId: string): Promise<void> {
  await sql`
    UPDATE channel_session SET connection_state = 'logged_out', disconnect_reason = 'logged_out',
      updated_at = now()
    WHERE sender_identity_id = ${senderId}`;
  await sql`UPDATE sender_identity SET status = 'linking' WHERE id = ${senderId}`;
  await sql`DELETE FROM channel_auth_state WHERE sender_identity_id = ${senderId}`;
}

/** One number's card on the Numbers page. */
const card = (page: Page, label: string) => page.locator('li', { hasText: label }).first();

test.describe('[R-017] the connection state follows the gateway without a reload', () => {
  let sql: postgres.Sql;
  let senderId: string | null = null;
  test.beforeEach(() => { sql = postgres(process.env.DATABASE_URL!, { max: 1 }); });
  test.afterEach(async () => {
    if (senderId !== null) await sql`DELETE FROM sender_identity WHERE id = ${senderId}`;
    senderId = null;
    await sql.end({ timeout: 2 });
  });

  test('[R-017] Numbers page: Linked turns to Not linked when WhatsApp drops the number', async ({ page }) => {
    const label = `R017 ${randomBytes(3).toString('hex')}`;
    senderId = await seedLinked(sql, label);
    await signIn(page);
    await page.goto('/link');
    await expect(card(page, label).getByText('Linked', { exact: true })).toBeVisible();
    await expect(card(page, label).getByRole('button', { name: 'Link this number' })).toBeDisabled();

    await dropLink(sql, senderId);

    // No reload: the open page has to notice on its own.
    await expect(card(page, label).getByText('Not linked', { exact: true })).toBeVisible({ timeout: CATCH_UP_MS });
    await expect(card(page, label).getByRole('button', { name: 'Link this number' })).toBeEnabled();
    await expect(card(page, label).getByText(/^Linked\. If it stops receiving/)).toHaveCount(0);
  });

  test('[R-017] Overview: the connected count drops when a number is dropped', async ({ page }) => {
    const label = `R017 ${randomBytes(3).toString('hex')}`;
    senderId = await seedLinked(sql, label);
    await signIn(page);
    await page.goto('/');
    const stat = page.getByRole('link', { name: /Linked numbers.*connected/ });
    const before = await stat.innerText();

    await dropLink(sql, senderId);

    await expect(stat).not.toHaveText(before, { timeout: CATCH_UP_MS });
  });
});
