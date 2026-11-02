import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import { resolveSendAsset } from './campaign-media.js';
import { renderRecipientBody } from './antiban/campaign-text.js';
import { splitFirstMessage } from './antiban/first-message.js';
import { drawGapMs } from './antiban/gap.js';

/**
 * A new chat got a campaign's text alone, and its picture or link was held back (F6 AC-7.3). They have just written to us:
 * queue what was held back, as a message of the same campaign. It goes in the lane like any other, and since the contact has
 * written in the last 24 hours it is a reply and goes first. Returns whether one was queued; asking twice queues one.
 */
export async function queueCampaignFollowUp(
  db: Database, kms: KmsDriver, orgId: string, conversationId: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The claim and the insert are one step: the recipient row is flipped first, so a second inbound message finds nothing.
    const claimed = (await tx.execute(sql`
      UPDATE campaign_recipient cr SET followup_pending = false
      FROM conversation v, campaign cp
      WHERE v.id = ${conversationId} AND v.org_id = ${orgId}
        AND cr.org_id = v.org_id AND cr.contact_id = v.contact_id AND cr.followup_pending
        AND cp.id = cr.campaign_id AND cp.sender_identity_id = v.sender_identity_id
      RETURNING cr.id, cr.campaign_id AS "campaignId", cr.contact_id AS "contactId", cp.body, cp.media_asset_id AS "pictureId",
                 CASE WHEN cp.blank_fill_in_choice = 'fallback' THEN cp.fill_in_fallback END AS "fallback"`
    ) as unknown as Array<{ id: string; campaignId: string; contactId: string; body: string; pictureId: string | null; fallback: string | null }>);
    if (claimed.length === 0) return false;

    const contact = (await tx.execute(sql`
      SELECT display_name AS "displayName", custom_fields AS "customFields", do_not_contact AS "dnc"
      FROM contact WHERE id = ${claimed[0]!.contactId} AND org_id = ${orgId}`
    ) as unknown as Array<{ displayName: string | null; customFields: Record<string, unknown> | null; dnc: boolean }>)[0];
    if (contact === undefined || contact.dnc) return false;

    let queued = false;
    for (const row of claimed) {
      const rendered = renderRecipientBody(row.body, {
        campaignId: row.campaignId, contactId: row.contactId, displayName: contact.displayName, customFields: contact.customFields,
        // The campaign's "use a fallback" choice applies to the rest of the message too (CW-7.7 AC2).
        fallback: row.fallback
      });
      const split = splitFirstMessage(rendered, row.pictureId !== null);
      if (split === null) continue;
      const asset = split.followUp.withMedia && row.pictureId !== null ? await resolveSendAsset(tx, orgId, row.pictureId) : null;
      const text = split.followUp.text;
      await tx.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by,
                             campaign_id, media_id, planned_gap_ms)
        VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', ${asset?.contentType ?? 'text'},
                ${Buffer.from(kms.encrypt(new TextEncoder().encode(text)))}, ${kms.blindIndex(text)}, 'system',
                ${row.campaignId}, ${asset?.mediaId ?? null}, ${drawGapMs()})`);
      queued = true;
    }
    return queued;
  });
}
