import { resolveSendAsset } from './campaign-media.js';
import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import { dailyCeiling, type PacingLimits } from './pacing.js';
import { renderBody } from './body-variation.js';
import { buildSegmentPredicate, type SegmentDefinition } from './segments.js';
import type { TenantWork } from './ingestion.js';
import { blockingPolicyGate, POLICY_SKIP_REASON, COOLDOWN_DAYS } from './policy-gates.js';

/**
 * Bulk sends.
 *
 * The shape of this is decided by one fact: **a campaign cannot be allowed to outrun the
 * anti-ban ceiling, and it must not be able to bury an agent's reply either.**
 *
 * So a campaign does not queue its messages at launch. Fifty thousand queued rows would be
 * re-evaluated by the pacing gate on every sweep, would sit ahead of a human's reply in the
 * same queue, and would have to be individually cancelled to stop the campaign. Instead the
 * `campaign_recipient` rows **are** the queue, and a dispatcher converts them into messages
 * only as fast as the sender's remaining allowance permits (`docs/08-antiban.md`).
 *
 * Pausing is then instant and costs nothing: the dispatcher simply stops looking at it.
 */

/** What a campaign is doing right now, and how far through it is. */
export interface CampaignProgress {
  readonly total: number;
  readonly pending: number;
  readonly queued: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

/** How long the rest of a campaign will take, given the ceiling it is subject to. */
export interface CampaignForecast {
  /** Sends still to make. */
  readonly remaining: number;
  /** What this sender may still send today, after what it has already sent. */
  readonly allowanceToday: number;
  /** Whole days before the last message goes out. 0 means it finishes today. */
  readonly daysToFinish: number;
  /**
   * True while the sender is still ramping. Worth surfacing loudly: a new number is capped at
   * 20 a day, so a 5,000-person campaign on a fresh number is a **months**-long proposition
   * and nobody should discover that after starting it.
   */
  readonly inWarmup: boolean;
}

/** The prospective audience of a draft, worked out without freezing it — a dry run's counts. */
export interface AudiencePreview {
  /** Everyone the audience rule matches right now. */
  readonly total: number;
  /** Of those, how many have a number to reach — the ones that would actually be messaged. */
  readonly reachable: number;
  /** The rest — no phone/`wa_*` identity, so they would be recorded as skipped, never dropped. */
  readonly unreachable: number;
  /** Reachable people already sent a different campaign inside the cooldown window (they would be skipped). */
  readonly recentlyMessaged: number;
  /** The campaign that most of them were messaged by, or null when none. */
  readonly recentCampaign: string | null;
}

/**
 * Counts the audience a draft *would* freeze, without writing a single `campaign_recipient` row.
 *
 * The dry run (F5 AC-1): it runs the exact same audience rule as {@link snapshotAudience} — import
 * run, explicit list, or tag — but as a COUNT split by reachability, so an operator sees who and
 * how many before committing to start. Because it shares the rule, the preview cannot drift from
 * what start actually snapshots.
 */
export async function previewAudience(
  tx: Transaction, orgId: string, campaignId: string
): Promise<AudiencePreview> {
  // Same segment branch as snapshotAudience, so the dry-run count matches what start would freeze.
  const segRows = await tx.execute(sql`
    SELECT s.definition AS "definition"
    FROM campaign cp JOIN segment s ON s.id = cp.from_segment_id
    WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId}`);
  const segDef = (segRows as unknown as Array<{ definition: SegmentDefinition }>)[0]?.definition;
  const segmentBranch = segDef === undefined
    ? sql``
    : sql`OR (cp.from_segment_id IS NOT NULL AND (${buildSegmentPredicate(segDef, orgId)}))`;

  const rows = await tx.execute(sql`
    WITH audience AS (
      SELECT c.id AS contact_id,
             EXISTS (
               SELECT 1 FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                 AND ci.kind IN ('phone', 'wa_jid', 'wa_lid')
             ) AS reachable,
             -- The latest other campaign that already messaged this person inside the cooldown window, if any.
             (SELECT cp2.name FROM message m
                JOIN conversation v ON v.id = m.conversation_id
                JOIN campaign cp2 ON cp2.id = m.campaign_id
              WHERE v.org_id = ${orgId} AND v.contact_id = c.id
                AND m.direction = 'outbound' AND m.campaign_id <> cp.id AND m.status <> 'failed'
                AND m.created_at > now() - make_interval(days => ${COOLDOWN_DAYS})
              ORDER BY m.created_at DESC LIMIT 1) AS recent_campaign
      FROM campaign cp
      JOIN contact c ON c.org_id = cp.org_id
      WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId}
        AND (
          (cp.from_import_run_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM import_row ir
            WHERE ir.import_run_id = cp.from_import_run_id
              AND ir.contact_id = c.id AND ir.outcome IN ('created', 'updated')
          ))
          OR (cp.explicit_contact_ids IS NOT NULL
              AND cp.explicit_contact_ids @> to_jsonb(c.id::text))
          OR (cp.from_tag_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM contact_tag ct
            WHERE ct.tag_id = cp.from_tag_id AND ct.contact_id = c.id AND ct.org_id = ${orgId}
          ))
          ${segmentBranch}
        )
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE reachable)::int AS reachable,
           count(*) FILTER (WHERE NOT reachable)::int AS unreachable,
           count(*) FILTER (WHERE reachable AND recent_campaign IS NOT NULL)::int AS "recentlyMessaged",
           (SELECT recent_campaign FROM audience WHERE reachable AND recent_campaign IS NOT NULL
            GROUP BY recent_campaign ORDER BY count(*) DESC LIMIT 1) AS "recentCampaign"
    FROM audience`);
  const row = (rows as unknown as AudiencePreview[])[0];
  return row ?? { total: 0, reachable: 0, unreachable: 0, recentlyMessaged: 0, recentCampaign: null };
}

/** Counts every recipient of a campaign by status. */
export async function campaignProgress(
  tx: Transaction, orgId: string, campaignId: string
): Promise<CampaignProgress> {
  const rows = await tx.execute(sql`
    SELECT
      count(*)::int                                        AS total,
      count(*) FILTER (WHERE status = 'pending')::int      AS pending,
      count(*) FILTER (WHERE status = 'queued')::int       AS queued,
      count(*) FILTER (WHERE status = 'sent')::int         AS sent,
      count(*) FILTER (WHERE status = 'failed')::int       AS failed,
      count(*) FILTER (WHERE status = 'skipped')::int      AS skipped
    FROM campaign_recipient WHERE campaign_id = ${campaignId} AND org_id = ${orgId}`);
  const row = (rows as unknown as CampaignProgress[])[0];
  return row ?? { total: 0, pending: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
}

/**
 * Works out how long the remaining sends will take.
 *
 * **This is the number an operator needs before pressing start, not after.** A campaign that
 * will take three weeks because the number is four days old is a decision, and it should be
 * made knowingly rather than discovered.
 */
export async function forecast(
  tx: Transaction, senderIdentityId: string, remaining: number, limits: PacingLimits, now = new Date()
): Promise<CampaignForecast> {
  const rows = await tx.execute(sql`
    SELECT count(*) FILTER (WHERE m.sent_at > now() - interval '1 day')::int AS "sentToday",
           max(m.sent_at) AS "lastSentAt"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${senderIdentityId}
      AND m.direction = 'outbound' AND m.sent_at IS NOT NULL`);
  const row = (rows as unknown as Array<{ sentToday: number; lastSentAt: string | null }>)[0];
  const sentToday = row?.sentToday ?? 0;
  const lastSentAt = row?.lastSentAt === null || row?.lastSentAt === undefined
    ? null : new Date(row.lastSentAt);

  const ceiling = dailyCeiling(limits, lastSentAt, now);
  const allowanceToday = Math.max(0, ceiling - sentToday);
  const afterToday = Math.max(0, remaining - allowanceToday);

  // Tomorrow's ceiling is at least today's, and usually higher while ramping — so this is a
  // deliberate over-estimate rather than an optimistic one. Better to promise slower.
  const daysToFinish = afterToday === 0 ? 0 : Math.ceil(afterToday / Math.max(1, ceiling));

  return {
    remaining, allowanceToday, daysToFinish,
    inWarmup: ceiling < limits.perDay
  };
}

/**
 * Freezes the audience into `campaign_recipient` rows.
 *
 * Snapshotting is the point: an import that grows after launch, or a contact deleted
 * mid-flight, must not change who this campaign is messaging.
 *
 * **A contact with no phone number is recorded as skipped, not dropped.** Silently shrinking
 * the audience is how an operator stops trusting the totals.
 */
export async function snapshotAudience(
  tx: Transaction, orgId: string, campaignId: string
): Promise<number> {
  // A dynamic segment resolves in TypeScript (the filter engine turns its stored definition into a
  // bound predicate) and is composed into the audience WHERE as one more branch. Fetched first so
  // the branch is empty for the other targeting modes, leaving their SQL untouched.
  const segRows = await tx.execute(sql`
    SELECT s.definition AS "definition"
    FROM campaign cp JOIN segment s ON s.id = cp.from_segment_id
    WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId}`);
  const segDef = (segRows as unknown as Array<{ definition: SegmentDefinition }>)[0]?.definition;
  const segmentBranch = segDef === undefined
    ? sql``
    : sql`OR (cp.from_segment_id IS NOT NULL AND (${buildSegmentPredicate(segDef, orgId)}))`;

  const rows = await tx.execute(sql`
    WITH audience AS (
      SELECT c.id AS contact_id,
             EXISTS (
               SELECT 1 FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                 AND ci.kind IN ('phone', 'wa_jid', 'wa_lid')
             ) AS reachable,
             -- The sending number itself: WhatsApp cannot deliver a linked device's message to its own account,
             -- the phone shows "Waiting for this message" and retries forever (measured 2026-10-22).
             EXISTS (
               SELECT 1 FROM contact_identity ci
               JOIN sender_identity own ON own.id = cp.sender_identity_id
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                 AND ci.kind = 'phone' AND ci.value_normalized = own.phone_e164
             ) AS own_number
      FROM campaign cp
      JOIN contact c ON c.org_id = cp.org_id
      WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId}
        AND (
          -- Either everyone a named import run actually created or updated …
          (cp.from_import_run_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM import_row ir
            WHERE ir.import_run_id = cp.from_import_run_id
              AND ir.contact_id = c.id AND ir.outcome IN ('created', 'updated')
          ))
          -- … or exactly the contacts that were listed. Never "everyone" implicitly.
          OR (cp.explicit_contact_ids IS NOT NULL
              AND cp.explicit_contact_ids @> to_jsonb(c.id::text))
          -- … or everyone carrying a named tag, resolved here so adding a contact to the tag
          -- after launch never changes who a running campaign is messaging.
          OR (cp.from_tag_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM contact_tag ct
            WHERE ct.tag_id = cp.from_tag_id AND ct.contact_id = c.id AND ct.org_id = ${orgId}
          ))
          -- … or everyone a dynamic segment's filter matches, resolved and frozen here.
          ${segmentBranch}
        )
    )
    INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status, skip_reason)
    SELECT ${orgId}, ${campaignId}, contact_id,
           CASE WHEN reachable AND NOT own_number THEN 'pending' ELSE 'skipped' END,
           CASE WHEN own_number THEN 'own_number' WHEN reachable THEN NULL ELSE 'no_phone' END
    FROM audience
    ON CONFLICT (campaign_id, contact_id) DO NOTHING
    RETURNING id`);
  return (rows as unknown as unknown[]).length;
}

/**
 * Turns pending recipients into queued messages, up to `limit`.
 *
 * Called by the gateway on each sweep with whatever allowance the sender has left. Returns how
 * many it queued, so the caller can stop when a campaign is done rather than polling it.
 *
 * Idempotent per recipient: the row moves `pending` → `queued` in the same statement that
 * creates the message, so a crash between the two cannot produce a second message for the same
 * person.
 */
export async function dispatchCampaign(
  tenant: TenantWork, kms: KmsDriver,
  input: {
    orgId: string; campaignId: string; senderIdentityId: string; body: string; limit: number;
    /** Most identical message bodies this sender may hold within a rolling 24h (Layer 3 / D-26). */
    identicalBodyCap: number;
    /** Policy gates an admin lifted for this campaign (`engagement`, `cooldown`, `duplicate_campaign`). */
    gateOverrides?: readonly string[];
    /** Advisory sender (D-29): the identical-body cap is computed but not enforced. */
    advisory?: boolean;
  }
): Promise<number> {
  if (input.limit <= 0) return 0;

  return tenant(async (tx) => {
    // A campaign with a picture or GIF sends it to everyone, the message being its caption; a GIF goes as its converted looping clip.
    const withPicture = (await tx.execute(sql`
      SELECT media_asset_id AS "pictureId" FROM campaign WHERE id = ${input.campaignId} AND org_id = ${input.orgId}`
    ) as unknown as Array<{ pictureId: string | null }>)[0]?.pictureId ?? null;
    const asset = withPicture === null ? null : await resolveSendAsset(tx, input.orgId, withPicture);
    if (withPicture !== null && asset === null) throw new Error('campaign_picture_unavailable');

    const rows = await tx.execute(sql`
      SELECT cr.id, cr.contact_id AS "contactId", c.display_name AS "contactName",
             c.custom_fields AS "customFields", cr.opening_enc AS "openingEnc"
      FROM campaign_recipient cr
      JOIN contact c ON c.id = cr.contact_id AND c.org_id = cr.org_id
      WHERE cr.campaign_id = ${input.campaignId} AND cr.org_id = ${input.orgId}
        AND cr.status = 'pending'
        -- A campaign with an AI template sends what the AI wrote for each person (writeOpenings); a person without one yet waits.
        AND (cr.opening_enc IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM campaign cp WHERE cp.id = cr.campaign_id AND cp.org_id = cr.org_id AND cp.ai_template_id IS NOT NULL))
      ORDER BY cr.id
      LIMIT ${input.limit}
      FOR UPDATE OF cr SKIP LOCKED`);
    const batch = rows as unknown as Array<{
      id: string; contactId: string; contactName: string | null;
      customFields: Record<string, unknown> | null; openingEnc: Uint8Array | null;
    }>;

    // Identical-body backstop (docs/08-antiban.md, Layer 3 / D-26): cap how many messages with the
    // SAME body this sender holds within a rolling 24h. Spintax / {{name}} make bodies differ, so
    // this only bites a no-variation blast. The count per body is cached, so a no-variation batch
    // costs one query, not one per recipient.
    const identicalSeen = new Map<string, number>();
    let queued = 0;

    for (const recipient of batch) {
      // Recipient-experience gates: skip with a reported reason unless an admin lifted them.
      const blocked = await blockingPolicyGate(tx, {
        orgId: input.orgId, campaignId: input.campaignId, contactId: recipient.contactId,
        overrides: input.gateOverrides ?? []
      });
      if (blocked !== null) {
        await tx.execute(sql`
          UPDATE campaign_recipient SET status = 'skipped', skip_reason = ${POLICY_SKIP_REASON[blocked]}
          WHERE id = ${recipient.id} AND org_id = ${input.orgId}`);
        continue;
      }

      // Render this recipient's copy first — spintax picks a wording, {{name}} fills from the
      // contact (D-26) — because the identical-body check keys off the rendered body's blind index.
      // {{name}} plus any of the org's custom fields ({{city}}, {{stage}}…); an unset one is blank.
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(recipient.customFields ?? {})) vars[k.toLowerCase()] = String(v);
      // The AI's own opening for this person, when the campaign has an AI template; otherwise the campaign's wording.
      const body = recipient.openingEnc !== null
        ? new TextDecoder().decode(kms.decrypt(recipient.openingEnc))
        : renderBody(input.body, { ...vars, name: recipient.contactName ?? '' });
      const hmac = kms.blindIndex(body);

      let already = identicalSeen.get(hmac);
      if (already === undefined) {
        const c = await tx.execute(sql`
          SELECT count(*)::int AS n FROM message m
          JOIN conversation v ON v.id = m.conversation_id
          WHERE v.sender_identity_id = ${input.senderIdentityId} AND v.org_id = ${input.orgId}
            AND m.body_hmac = ${hmac} AND m.created_at > now() - interval '1 day'`);
        already = (c as unknown as Array<{ n: number }>)[0]!.n;
      }
      if (already >= input.identicalBodyCap && !input.advisory) {
        // Too many identical bodies this window — leave this recipient pending (never failed: it
        // has not gone wrong, it waits for the window to free or for the operator to add variation).
        identicalSeen.set(hmac, already);
        continue;
      }

      // One conversation per contact per sender, reused if it exists — a campaign message
      // belongs in the same thread as everything else, not in a parallel history.
      const conv = await tx.execute(sql`
        INSERT INTO conversation (org_id, contact_id, sender_identity_id)
        VALUES (${input.orgId}, ${recipient.contactId}, ${input.senderIdentityId})
        ON CONFLICT (contact_id, sender_identity_id) DO UPDATE SET updated_at = now()
        RETURNING id`);
      const conversationId = (conv as unknown as Array<{ id: string }>)[0]!.id;

      const created = await tx.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                             body_enc, body_hmac, sent_by, campaign_id, dnc_override, media_id)
        VALUES (${input.orgId}, ${conversationId}, 'outbound', 'queued', ${asset?.contentType ?? 'text'},
                ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
                ${hmac}, 'system', ${input.campaignId},
                ${(input.gateOverrides ?? []).includes('dnc')}, ${asset?.mediaId ?? null})
        RETURNING id`);
      const messageId = (created as unknown as Array<{ id: string }>)[0]!.id;

      await tx.execute(sql`
        UPDATE campaign_recipient
        SET status = 'queued', message_id = ${messageId}, attempted_at = now()
        WHERE id = ${recipient.id} AND org_id = ${input.orgId}`);
      identicalSeen.set(hmac, already + 1);
      queued += 1;
    }
    return queued;
  });
}

/**
 * Brings a campaign's recipient statuses up to date with what actually happened to its
 * messages, and completes it once nothing is left.
 *
 * Kept separate from dispatch because the two answer different questions and run at different
 * times — dispatch is rate-limited, reconciliation is cheap and wants to run every sweep.
 */
export async function reconcileCampaign(
  tx: Transaction, orgId: string, campaignId: string
): Promise<CampaignProgress> {
  await tx.execute(sql`
    UPDATE campaign_recipient cr
    SET status = CASE WHEN m.status = 'failed' THEN 'failed' ELSE 'sent' END
    FROM message m
    WHERE m.id = cr.message_id AND cr.campaign_id = ${campaignId} AND cr.org_id = ${orgId}
      AND cr.status = 'queued' AND m.status IN ('sent', 'delivered', 'read', 'failed')`);

  const progress = await campaignProgress(tx, orgId, campaignId);
  if (progress.pending === 0 && progress.queued === 0) {
    await tx.execute(sql`
      UPDATE campaign SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${campaignId} AND org_id = ${orgId} AND status = 'running'`);
  }
  return progress;
}
