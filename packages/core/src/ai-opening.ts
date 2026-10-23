import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import type { LlmDriver } from '@crm/llm';
import { systemText } from './ai-reply.js';

/**
 * The AI writes the first message of a campaign that has an AI template, one per person, instead of the CRM sending a fixed body.
 *
 * Before a sweep queues messages (`dispatchCampaign`), `writeOpenings` gives each pending recipient of such a campaign an opening
 * (`campaign_recipient.opening_enc`, encrypted like a message body). Dispatch then sends only recipients that have one, and sends
 * that text. Writing happens here, outside the dispatch transaction, so a slow model never holds a database transaction open.
 *
 * A failure (the model errored or answered with nothing) is counted per recipient; after `MAX_TRIES` the recipient is skipped
 * with the reason `ai_opening_failed` so it is reported, never silently dropped.
 */

/** Longest opening kept, in characters; the same ceiling as a reply. */
const MAX_OPENING_CHARS = 1500;
/** Output budget for one opening, thinking included (a reasoning model needs room, see R-012). */
const MAX_OPENING_TOKENS = 3000;
/** How many times writing one person's opening may fail before they are skipped. */
const MAX_TRIES = 3;
/** The most openings written in one call, so one sweep does not hold the gateway for minutes. */
const DEFAULT_BATCH = 5;

/** The fixed rules for an opening, added to the same safety text a reply gets. */
const OPENING_RULES = [
  'This is the FIRST message you send this person: you are starting the conversation, not answering anything.',
  'Greet them by name if a name is given, say in one or two sentences who you are and why you are writing, and end with ONE short question that fits the goal in the instructions.',
  'Write only the message itself: no quotes, no labels, no explanation. Do not invent facts about the person.'
].join('\n');

/** True for a campaign that has an AI template: its first messages are written by the AI. */
export async function campaignWritesOpenings(db: Database, orgId: string, campaignId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM campaign WHERE id = ${campaignId} AND org_id = ${orgId} AND ai_template_id IS NOT NULL`);
  return (rows as unknown as unknown[]).length > 0;
}

/**
 * Writes openings for up to `limit` pending recipients of one campaign. Returns how many were written.
 * Does nothing (returns 0) when the campaign has no AI template or the AI is switched off.
 */
export async function writeOpenings(
  deps: { db: Database; kms: KmsDriver; llm: LlmDriver },
  input: { orgId: string; campaignId: string; limit?: number }
): Promise<number> {
  const { db, kms, llm } = deps;
  const { orgId, campaignId } = input;
  const limit = input.limit ?? DEFAULT_BATCH;

  const setup = (await db.execute(sql`
    SELECT c.body AS "brief", t.instructions AS "instructions", o.name AS "orgName", s.enabled AS "aiOn"
    FROM campaign c
    JOIN ai_template t ON t.id = c.ai_template_id AND t.org_id = c.org_id
    JOIN org o ON o.id = c.org_id
    LEFT JOIN ai_setting s ON s.org_id = c.org_id
    WHERE c.id = ${campaignId} AND c.org_id = ${orgId}`) as unknown as Array<{
    brief: string; instructions: string; orgName: string; aiOn: boolean | null;
  }>)[0];
  if (setup === undefined || setup.aiOn !== true) return 0;

  const people = await db.execute(sql`
    SELECT cr.id, c.display_name AS "name", c.custom_fields AS "fields"
    FROM campaign_recipient cr
    JOIN contact c ON c.id = cr.contact_id AND c.org_id = cr.org_id
    WHERE cr.campaign_id = ${campaignId} AND cr.org_id = ${orgId} AND cr.status = 'pending' AND cr.opening_enc IS NULL
    ORDER BY cr.id LIMIT ${limit}`) as unknown as Array<{ id: string; name: string | null; fields: Record<string, unknown> | null }>;

  let written = 0;
  for (const person of people) {
    // What the model may know about this person: their name and the columns stored on them. Never anything about other people.
    const known = Object.entries(person.fields ?? {}).slice(0, 40).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`);
    const brief = [
      `Person's name: ${person.name ?? '(not known)'}`,
      known.length > 0 ? `What is known about them:\n${known.join('\n')}` : 'Nothing else is known about them.',
      setup.brief.trim() === '' ? '' : `The campaign's own outline of what to say (reword it for this person, do not copy it):\n${setup.brief.trim()}`
    ].filter((x) => x !== '').join('\n\n');

    let text = '';
    try {
      const answer = await llm.complete({
        system: `${systemText(setup.orgName, setup.instructions)}\n\n${OPENING_RULES}`,
        messages: [{ role: 'user', content: brief }], maxTokens: MAX_OPENING_TOKENS
      });
      text = answer.text.trim().slice(0, MAX_OPENING_CHARS);
    } catch { text = ''; }

    if (text === '') {
      await db.execute(sql`
        UPDATE campaign_recipient
        SET opening_tries = opening_tries + 1,
            status = CASE WHEN opening_tries + 1 >= ${MAX_TRIES} THEN 'skipped' ELSE status END,
            skip_reason = CASE WHEN opening_tries + 1 >= ${MAX_TRIES} THEN 'ai_opening_failed' ELSE skip_reason END
        WHERE id = ${person.id} AND org_id = ${orgId} AND status = 'pending'`);
      continue;
    }
    await db.execute(sql`
      UPDATE campaign_recipient SET opening_enc = ${Buffer.from(kms.encrypt(new TextEncoder().encode(text)))}
      WHERE id = ${person.id} AND org_id = ${orgId} AND status = 'pending'`);
    written += 1;
  }
  return written;
}
