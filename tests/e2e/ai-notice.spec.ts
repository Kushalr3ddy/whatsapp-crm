import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { signIn, EMAIL, CREDS_MISSING } from './helpers';

/**
 * The AI assistant's warning in a thread: when the assistant's reply is held back the thread
 * says so with no override, and for a do-not-contact contact an admin sees the "allow anyway (ban risk)"
 * button, which needs a written reason. The rows the assistant would have written are seeded straight into the
 * dev database, because producing them for real needs a live WhatsApp inbound.
 */
test.describe('ai assistant warning in a thread', () => {
  test.skip(CREDS_MISSING || process.env.DATABASE_URL === undefined, 'set TEST_EMAIL / TEST_PASSWORD / DATABASE_URL in .env');

  /** Seeds an AI-owned conversation in the test admin's org and returns its id. */
  async function seed(sql: postgres.Sql, kind: 'held' | 'dnc'): Promise<string> {
    const [who] = await sql`
      SELECT m.org_id AS org, s.bot_user_id AS bot FROM app_user u JOIN org_membership m ON m.user_id = u.id
      LEFT JOIN ai_setting s ON s.org_id = m.org_id WHERE u.email = ${EMAIL}`;
    if (who?.bot === undefined || who.bot === null) throw new Error('turn the AI assistant on for the test org first (the ai-assistant spec does)');
    const tag = randomBytes(4).toString('hex');
    const [sender] = await sql`SELECT id FROM sender_identity WHERE org_id = ${who.org} LIMIT 1`;
    if (sender === undefined) throw new Error('the test org needs a number');
    const [contact] = await sql`INSERT INTO contact (org_id, display_name, source, do_not_contact) VALUES (${who.org}, ${`AI warn ${tag}`}, 'e2e', ${kind === 'dnc'}) RETURNING id`;
    const [conv] = await sql`INSERT INTO conversation (org_id, contact_id, sender_identity_id, assignee_user_id) VALUES (${who.org}, ${contact!.id}, ${sender.id}, ${who.bot}) RETURNING id`;
    await sql`INSERT INTO message (org_id, conversation_id, direction, status, content_type, provider_message_id) VALUES (${who.org}, ${conv!.id}, 'inbound', 'received', 'text', ${`e2e-${tag}`})`;
    if (kind === 'held') {
      await sql`INSERT INTO message (org_id, conversation_id, direction, status, content_type, sent_by, sent_by_user_id, hold_reason) VALUES (${who.org}, ${conv!.id}, 'outbound', 'queued', 'text', 'agent', ${who.bot}, 'sender_not_connected')`;
    } else {
      await sql`INSERT INTO ai_run (org_id, conversation_id, kind, outcome, reason) VALUES (${who.org}, ${conv!.id}, 'reply', 'blocked', 'do_not_contact')`;
    }
    return conv!.id as string;
  }

  test('a held reply is a warning with no override; do-not-contact offers the admin override with a reason', async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const held = await seed(sql, 'held');
      const dnc = await seed(sql, 'dnc');
      await signIn(page);

      await page.goto(`/inbox/${held}`);
      const banner = page.getByRole('alert', { name: 'AI assistant warning' });
      await expect(banner).toContainText('the number isn’t connected');
      await expect(banner.getByRole('button')).toHaveCount(0);

      await page.goto(`/inbox/${dnc}`);
      await expect(banner).toContainText('do-not-contact');
      await expect(banner).toContainText('risk of reports and a ban');
      await banner.getByRole('button', { name: /Allow reply anyway/ }).click();
      // A reason is required: a too-short one cannot be submitted, so the form stays and nothing is sent.
      await banner.getByLabel(/Why is this OK/).fill('short');
      await banner.getByRole('button', { name: 'Allow this one reply' }).click();
      await expect(banner.getByRole('button', { name: 'Allow this one reply' })).toBeVisible();
      await expect(banner).toContainText('do-not-contact');
    } finally {
      await sql.end({ timeout: 2 });
    }
  });
});
