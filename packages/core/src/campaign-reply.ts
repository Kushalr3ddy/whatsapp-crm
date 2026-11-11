import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { writeAudit, AUDIT } from './audit.js';

/**
 * Replies to a campaign (R-011). A campaign can carry an AI template (`campaign.ai_template_id`); the people it messages
 * who reply should be answered by the assistant, using that template, not left waiting for a person.
 *
 * Two small rules, kept together here:
 *  - `claimCampaignReply`: when a reply arrives in a chat nobody owns, and the last thing sent in it was a campaign message
 *    from a campaign with an AI template, hand the chat to the assistant (if the AI is switched on).
 *  - `campaignTemplateFor`: which template's instructions the assistant should use in a chat: the one of the latest
 *    campaign message sent in it (campaign over the organisation-wide default, D-85).
 */

/** What a chat needs from the template of the campaign whose message it last received. */
export interface CampaignTemplate {
  readonly templateId: string;
  readonly campaignId: string;
  readonly instructions: string;
  /** The columns of the person's row the AI may see. */
  readonly visibleColumns: readonly string[];
  /** The team member a chat is handed to, when set and still in the team; null otherwise. */
  readonly fallbackUserId: string | null;
  readonly fallbackName: string | null;
  readonly fallbackPhone: string;
  /** The owner stopped the AI on this campaign. */
  readonly aiStopped: boolean;
}

/** The AI template of the campaign whose message this chat last received, or null when there is none. */
export async function campaignTemplateFor(
  db: Database, orgId: string, conversationId: string
): Promise<CampaignTemplate | null> {
  const rows = await db.execute(sql`
    SELECT t.id AS "templateId", c.id AS "campaignId", t.instructions, t.visible_columns AS "visibleColumns",
           u.id AS "fallbackUserId", u.display_name AS "fallbackName", t.fallback_phone AS "fallbackPhone", c.ai_stopped AS "aiStopped"
    FROM message m
    JOIN campaign c ON c.id = m.campaign_id AND c.org_id = m.org_id
    JOIN ai_template t ON t.id = c.ai_template_id AND t.org_id = m.org_id
    LEFT JOIN org_membership om ON om.user_id = t.fallback_user_id AND om.org_id = m.org_id
    LEFT JOIN app_user u ON u.id = om.user_id
    WHERE m.org_id = ${orgId} AND m.conversation_id = ${conversationId}
      AND m.direction = 'outbound' AND m.campaign_id IS NOT NULL AND m.status <> 'failed'
    ORDER BY m.created_at DESC LIMIT 1`);
  const hit = (rows as unknown as CampaignTemplate[])[0];
  return hit ?? null;
}

/**
 * Gives a campaign reply to the assistant. Returns true when it assigned the chat.
 *
 * It does nothing unless ALL of these hold: the AI is switched on and has its assistant user; nobody owns the chat (a person who
 * took it keeps it); the contact is not marked do-not-contact; and the **last message sent in the chat** is a campaign message
 * from a campaign that has an AI template (so a person who has written since keeps the conversation).
 */
export async function claimCampaignReply(db: Database, orgId: string, conversationId: string): Promise<boolean> {
  // A campaign whose AI was stopped: its replies go to the person the template names, not to the AI.
  const stopped = (await db.execute(sql`
    SELECT u.id AS "to"
    FROM message m JOIN campaign c ON c.id = m.campaign_id AND c.org_id = m.org_id AND c.ai_stopped
    JOIN ai_template t ON t.id = c.ai_template_id AND t.org_id = m.org_id
    JOIN org_membership om ON om.user_id = t.fallback_user_id AND om.org_id = m.org_id
    JOIN app_user u ON u.id = om.user_id
    JOIN conversation v ON v.id = m.conversation_id AND v.org_id = m.org_id AND v.assignee_user_id IS NULL
    WHERE m.org_id = ${orgId} AND m.conversation_id = ${conversationId} AND m.direction = 'outbound' AND m.status <> 'failed'
      AND m.created_at = (SELECT max(m2.created_at) FROM message m2 WHERE m2.conversation_id = m.conversation_id AND m2.org_id = m.org_id
                            AND m2.direction = 'outbound' AND m2.status <> 'failed')
    LIMIT 1`) as unknown as Array<{ to: string }>)[0];
  if (stopped !== undefined) {
    await db.execute(sql`UPDATE conversation SET assignee_user_id = ${stopped.to}, updated_at = now() WHERE id = ${conversationId} AND org_id = ${orgId} AND assignee_user_id IS NULL`);
    return false;
  }
  const rows = await db.execute(sql`
    SELECT s.bot_user_id AS "botUserId", v.assignee_user_id AS "assignee", c.do_not_contact AS "dnc",
           (SELECT c2.ai_template_id IS NOT NULL AND NOT c2.ai_stopped
              FROM message m LEFT JOIN campaign c2 ON c2.id = m.campaign_id AND c2.org_id = m.org_id
             WHERE m.org_id = v.org_id AND m.conversation_id = v.id AND m.direction = 'outbound' AND m.status <> 'failed'
             ORDER BY m.created_at DESC LIMIT 1) AS "lastIsAiCampaign"
    FROM conversation v
    JOIN contact c ON c.id = v.contact_id
    JOIN ai_setting s ON s.org_id = v.org_id AND s.enabled
    WHERE v.id = ${conversationId} AND v.org_id = ${orgId}`);
  const row = (rows as unknown as Array<{ botUserId: string | null; assignee: string | null; dnc: boolean; lastIsAiCampaign: boolean | null }>)[0];
  if (row === undefined || row.botUserId === null || row.assignee !== null || row.dnc || row.lastIsAiCampaign !== true) return false;

  return db.transaction(async (tx) => {
    const done = await tx.execute(sql`
      UPDATE conversation SET assignee_user_id = ${row.botUserId}, status = 'open', updated_at = now()
      WHERE id = ${conversationId} AND org_id = ${orgId} AND assignee_user_id IS NULL
      RETURNING id`);
    if ((done as unknown as unknown[]).length === 0) return false;
    await writeAudit(tx, {
      orgId, actor: { type: 'agent', id: row.botUserId! }, action: AUDIT.conversationAssigned,
      targetType: 'conversation', targetId: conversationId,
      before: { assigneeUserId: null }, after: { assigneeUserId: row.botUserId, reason: 'a reply to a campaign with an AI template' }
    });
    return true;
  });
}
