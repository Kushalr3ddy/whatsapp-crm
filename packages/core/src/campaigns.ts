import { resolveSendAsset } from './campaign-media.js';
import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import { missingFillIns, planFirstMessage, renderRecipientBody } from './antiban/campaign-text.js';
import { fillInKeys } from './body-variation.js';
import { loadCustomFields } from './custom-fields.js';
import { drawGapMs } from './antiban/gap.js';
import { buildSegmentPredicate, type SegmentDefinition } from './segments.js';
import type { TenantWork } from './ingestion.js';
import { blockingPolicyGate, POLICY_SKIP_REASON, COOLDOWN_DAYS } from './policy-gates.js';

/**
 * Bulk sends.
 *
 * The shape of this is decided by one fact: **a campaign must not be able to bury an agent's reply, and must not
 * be a burst.**
 *
 * So a campaign does not queue its messages at launch. Fifty thousand queued rows would sit ahead of a
 * human's reply in the same queue and would have to be individually cancelled to stop the campaign. Instead the
 * `campaign_recipient` rows **are** the queue, and a dispatcher converts them into messages a small batch at a time
 * (how many is the anti-ban policy's say, `campaignBatch`).
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

/**
 * THE audience rule, written once: who is in an audience (a contact aliased `c`) given where each of its four ways of being chosen
 * is read from (a campaign's columns, or bound values). The dry run, the freeze at start and the fill-in report all use it, so a
 * change to who an audience contains changes all three. Exactly one way is set; with none set, nobody is in it ("never everyone").
 */
export function audienceRule(
  orgId: string,
  cols: { importRun: SQL; explicit: SQL; tag: SQL; segment: SQL },
  segmentPredicate: SQL | undefined
): SQL {
  return sql`(
    -- Either everyone a named import run actually created or updated …
    (${cols.importRun} IS NOT NULL AND EXISTS (
      SELECT 1 FROM import_row ir
      WHERE ir.import_run_id = ${cols.importRun} AND ir.contact_id = c.id AND ir.outcome IN ('created', 'updated')
    ))
    -- … or exactly the contacts that were listed …
    OR (${cols.explicit} IS NOT NULL AND ${cols.explicit} @> to_jsonb(c.id::text))
    -- … or everyone carrying a named tag, resolved at start so later tagging never changes a running campaign …
    OR (${cols.tag} IS NOT NULL AND EXISTS (
      SELECT 1 FROM contact_tag ct WHERE ct.tag_id = ${cols.tag} AND ct.contact_id = c.id AND ct.org_id = ${orgId}
    ))
    -- … or everyone a dynamic segment's filter matches.
    ${segmentPredicate === undefined ? sql`` : sql`OR (${cols.segment} IS NOT NULL AND (${segmentPredicate}))`}
  )`;
}

/** A dynamic segment resolves in TypeScript (its stored filter becomes a bound predicate); undefined when there is none. */
export async function segmentPredicateFor(tx: Transaction, orgId: string, segmentId: string | null): Promise<SQL | undefined> {
  if (segmentId === null) return undefined;
  const def = (await tx.execute(sql`
    SELECT definition FROM segment WHERE id = ${segmentId} AND org_id = ${orgId}`
  ) as unknown as Array<{ definition: SegmentDefinition }>)[0]?.definition;
  return def === undefined ? undefined : buildSegmentPredicate(def, orgId);
}

/** The audience rule for a campaign row (`cp`), which is how the dry run and the freeze read it. */
async function campaignAudienceWhere(tx: Transaction, orgId: string, campaignId: string): Promise<SQL> {
  const seg = (await tx.execute(sql`
    SELECT from_segment_id AS "id" FROM campaign WHERE id = ${campaignId} AND org_id = ${orgId}`
  ) as unknown as Array<{ id: string | null }>)[0]?.id ?? null;
  return audienceRule(orgId, {
    importRun: sql`cp.from_import_run_id`, explicit: sql`cp.explicit_contact_ids`, tag: sql`cp.from_tag_id`, segment: sql`cp.from_segment_id`
  }, await segmentPredicateFor(tx, orgId, seg));
}

/** The prospective audience of a draft, worked out without freezing it — a dry run's counts. */
export interface AudiencePreview {
  /** Everyone the audience rule matches right now. */
  readonly total: number;
  /** Of those, how many have a number to reach — the ones that would actually be messaged. */
  readonly reachable: number;
  /** The rest — no phone/`wa_*` identity, so they would be recorded as skipped, never dropped. */
  readonly unreachable: number;
  /**
   * Reachable people sent a different campaign from this same number in the last 14 days, with nothing live: a warning only,
   * they are sent (CW-6.6a AC3).
   */
  readonly recentlyMessaged: number;
  /** The campaign that most of them were messaged by, or null when none. */
  readonly recentCampaign: string | null;
  /** Reachable people still waiting in a live campaign on this same number: the red confirm names them (CW-6.6a AC1). */
  readonly sameNumberLive: number;
  /** The live campaign most of them are in, or null when none. */
  readonly sameNumberLiveCampaign: string | null;
  /** The phone number this campaign sends from, for the confirm's wording. */
  readonly senderPhone: string | null;
  /** Reachable people (not counted above) already in a campaign or messaged lately from a different number: a small note (CW-6.6a AC4). */
  readonly otherNumberOverlap: number;
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
  // The same rule snapshotAudience uses, so the dry-run count matches what start would freeze.
  const who = await campaignAudienceWhere(tx, orgId, campaignId);
  // "Recently" is the campaign's own number of days, else the org's default, else 14.
  const recentDays = (await tx.execute(sql`
    SELECT coalesce(cp.recent_days, (SELECT recent_days FROM antiban_setting WHERE org_id = ${orgId}), ${COOLDOWN_DAYS})::int AS d
    FROM campaign cp WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId}`) as unknown as Array<{ d: number }>)[0]?.d ?? COOLDOWN_DAYS;

  const rows = await tx.execute(sql`
    WITH audience AS (
      SELECT c.id AS contact_id,
             EXISTS (
               SELECT 1 FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                 AND ci.kind IN ('phone', 'wa_jid', 'wa_lid')
             ) AS reachable,
             -- The latest other campaign that already messaged this person from THIS number inside the cooldown window, if any.
             (SELECT cp2.name FROM message m
                JOIN conversation v ON v.id = m.conversation_id
                JOIN campaign cp2 ON cp2.id = m.campaign_id
              WHERE v.org_id = ${orgId} AND v.contact_id = c.id AND v.sender_identity_id = cp.sender_identity_id
                AND m.direction = 'outbound' AND m.campaign_id <> cp.id AND m.status <> 'failed'
                AND m.created_at > now() - make_interval(days => ${recentDays})
              ORDER BY m.created_at DESC LIMIT 1) AS recent_campaign,
             -- A live campaign on this same number that still has this person waiting (CW-6.6a AC1).
             (SELECT cp3.name FROM campaign_recipient cr3 JOIN campaign cp3 ON cp3.id = cr3.campaign_id
              WHERE cr3.org_id = ${orgId} AND cr3.contact_id = c.id AND cr3.campaign_id <> cp.id
                AND cr3.status IN ('pending', 'queued') AND cp3.status IN ('running', 'paused')
                AND cp3.sender_identity_id = cp.sender_identity_id
              ORDER BY cp3.created_at DESC LIMIT 1) AS live_campaign,
             -- Messaged by a campaign, or waiting in a live one, from a DIFFERENT number (CW-6.6a AC4): only a note.
             (EXISTS (
                SELECT 1 FROM message m
                  JOIN conversation v ON v.id = m.conversation_id
                WHERE v.org_id = ${orgId} AND v.contact_id = c.id AND v.sender_identity_id <> cp.sender_identity_id
                  AND m.direction = 'outbound' AND m.campaign_id IS NOT NULL AND m.campaign_id <> cp.id AND m.status <> 'failed'
                  AND m.created_at > now() - make_interval(days => ${recentDays}))
              OR EXISTS (
                SELECT 1 FROM campaign_recipient cr4 JOIN campaign cp4 ON cp4.id = cr4.campaign_id
                WHERE cr4.org_id = ${orgId} AND cr4.contact_id = c.id AND cr4.campaign_id <> cp.id
                  AND cr4.status IN ('pending', 'queued') AND cp4.status IN ('running', 'paused')
                  AND cp4.sender_identity_id <> cp.sender_identity_id)) AS other_number
      FROM campaign cp
      JOIN contact c ON c.org_id = cp.org_id
      WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId} AND (${who})
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE reachable)::int AS reachable,
           count(*) FILTER (WHERE NOT reachable)::int AS unreachable,
           -- Messaged from this number lately with nothing live: a warning line, they are sent (CW-6.6a AC3).
           count(*) FILTER (WHERE reachable AND recent_campaign IS NOT NULL AND live_campaign IS NULL)::int AS "recentlyMessaged",
           (SELECT recent_campaign FROM audience WHERE reachable AND recent_campaign IS NOT NULL AND live_campaign IS NULL
            GROUP BY recent_campaign ORDER BY count(*) DESC LIMIT 1) AS "recentCampaign",
           count(*) FILTER (WHERE reachable AND live_campaign IS NOT NULL)::int AS "sameNumberLive",
           (SELECT live_campaign FROM audience WHERE reachable AND live_campaign IS NOT NULL
            GROUP BY live_campaign ORDER BY count(*) DESC LIMIT 1) AS "sameNumberLiveCampaign",
           (SELECT si.phone_e164 FROM campaign cp5 JOIN sender_identity si ON si.id = cp5.sender_identity_id
            WHERE cp5.id = ${campaignId} AND cp5.org_id = ${orgId}) AS "senderPhone",
           count(*) FILTER (WHERE reachable AND other_number AND recent_campaign IS NULL AND live_campaign IS NULL)::int AS "otherNumberOverlap"
    FROM audience`);
  const row = (rows as unknown as AudiencePreview[])[0];
  return row ?? {
    total: 0, reachable: 0, unreachable: 0, recentlyMessaged: 0, recentCampaign: null,
    sameNumberLive: 0, sameNumberLiveCampaign: null, senderPhone: null, otherNumberOverlap: 0
  };
}

/** One fill-in a message can use, for the Insert list (CW-7.6). */
export interface FillInReportField {
  readonly key: string;
  /** What a person sees next to it; the built-ins are "Name" and "First name". */
  readonly label: string;
  /** A real value from one person in the audience, or null when nobody has one. */
  readonly sample: string | null;
  /** How many people in the audience have a value. */
  readonly have: number;
  /** How the value is read: `text`, `number`, `date` or `select`. The built-in name fields are `text`. */
  readonly type: string;
}

/** The fill-ins for an audience, each with a sample value and how many of the people have it. */
export interface FillInReport {
  /** Everyone the audience matches right now (not only the reachable ones: a fill-in is read for each person). */
  readonly total: number;
  readonly fields: readonly FillInReportField[];
}

/** An audience stated one way, like a campaign's: the report works on a draft's choice before the draft exists. */
export interface FillInAudience {
  readonly fromImportRunId?: string | undefined;
  readonly fromTagId?: string | undefined;
  readonly fromSegmentId?: string | undefined;
  readonly explicitContactIds?: readonly string[] | undefined;
}

/** "2026-11-12" read as a date shows as "12 Nov 2026"; anything else is shown as it was stored. */
export function sampleText(type: string, value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (type !== 'date' || m === null) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(Number(m[3]))} ${months[Number(m[2]) - 1] ?? m[2]!} ${m[1]!}`;
}

/**
 * The fill-ins an audience offers (CW-7.6): `name`, `first_name`, and every field the org defines, each with a real sample value and
 * how many of the people have it. Reads the same people a campaign would freeze, without writing anything.
 */
export async function fillInReport(
  tx: Transaction, orgId: string, audience: FillInAudience
): Promise<FillInReport> {
  const who = audienceRule(orgId, {
    importRun: sql`${audience.fromImportRunId ?? null}::uuid`,
    explicit: sql`${audience.explicitContactIds === undefined ? null : JSON.stringify(audience.explicitContactIds)}::jsonb`,
    tag: sql`${audience.fromTagId ?? null}::uuid`,
    segment: sql`${audience.fromSegmentId ?? null}::uuid`
  }, await segmentPredicateFor(tx, orgId, audience.fromSegmentId ?? null));
  return fillInReportWhere(tx, orgId, who);
}

/** The same report for any audience rule (a contact aliased `c`): the New campaign review reads several picks at once through it. */
export async function fillInReportWhere(tx: Transaction, orgId: string, who: SQL): Promise<FillInReport> {
  const fields = await loadCustomFields(tx, orgId);
  const out: FillInReportField[] = [];

  // Name, then the first word of it: both come from the display name.
  const nameRow = (await tx.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE nullif(trim(c.display_name), '') IS NOT NULL)::int AS have,
           (array_agg(trim(c.display_name) ORDER BY c.id) FILTER (WHERE nullif(trim(c.display_name), '') IS NOT NULL))[1] AS sample
    FROM contact c WHERE c.org_id = ${orgId} AND (${who})`
  ) as unknown as Array<{ total: number; have: number; sample: string | null }>)[0];
  const total = nameRow?.total ?? 0;
  out.push({ key: 'name', label: 'Name', sample: nameRow?.sample ?? null, have: nameRow?.have ?? 0, type: 'text' });
  out.push({
    key: 'first_name', label: 'First name', have: nameRow?.have ?? 0, type: 'text',
    sample: nameRow?.sample?.split(/\s+/)[0] ?? null
  });

  // Every field in one pass over the audience: each person's custom_fields unpacked into (key, value) rows, grouped by key.
  const perKey = new Map((await tx.execute(sql`
    SELECT kv.key AS "key",
           count(*) FILTER (WHERE nullif(trim(kv.value), '') IS NOT NULL)::int AS have,
           (array_agg(kv.value ORDER BY c.id) FILTER (WHERE nullif(trim(kv.value), '') IS NOT NULL))[1] AS sample
    FROM contact c, LATERAL jsonb_each_text(coalesce(c.custom_fields, '{}'::jsonb)) AS kv
    WHERE c.org_id = ${orgId} AND (${who})
    GROUP BY kv.key`
  ) as unknown as Array<{ key: string; have: number; sample: string | null }>).map((r) => [r.key, r]));
  for (const f of fields) {
    const r = perKey.get(f.key);
    out.push({ key: f.key, label: f.label, type: f.type, have: r?.have ?? 0, sample: r?.sample === null || r?.sample === undefined ? null : sampleText(f.type, r.sample) });
  }
  return { total, fields: out };
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
  const who = await campaignAudienceWhere(tx, orgId, campaignId);

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
      WHERE cp.id = ${campaignId} AND cp.org_id = ${orgId} AND (${who})
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
 * Called by the gateway on each sweep with however many the anti-ban policy lets it queue. Returns how
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
    /** Policy gates an admin lifted for this campaign (`engagement`, `cooldown`, `duplicate_campaign`). */
    gateOverrides?: readonly string[];
  }
): Promise<number> {
  if (input.limit <= 0) return 0;

  return tenant(async (tx) => {
    // A campaign with a picture or GIF sends it to everyone, the message being its caption; a GIF goes as its converted looping clip.
    const settings = (await tx.execute(sql`
      SELECT media_asset_id AS "pictureId", media_after_reply AS "mediaAfterReply",
             blank_fill_in_choice AS "blankChoice", fill_in_fallback AS "fallback",
             CASE WHEN leave_out_recent THEN coalesce(recent_days, (SELECT recent_days FROM antiban_setting WHERE org_id = ${input.orgId}), ${COOLDOWN_DAYS}) END AS "leaveOutDays"
      FROM campaign WHERE id = ${input.campaignId} AND org_id = ${input.orgId}`
    ) as unknown as Array<{ pictureId: string | null; mediaAfterReply: boolean; blankChoice: string | null; fallback: string | null; leaveOutDays: number | null }>)[0];
    // What to do when a fill-in has no value for a person (CW-7.7): skip them, fill the gap with the fallback, or (null) leave it blank.
    const blankChoice = settings?.blankChoice ?? null;
    const fallback = blankChoice === 'fallback' ? settings?.fallback ?? null : null;
    const knownFillIns = blankChoice === 'skip' ? fillInKeys((await loadCustomFields(tx, input.orgId)).map((f) => f.key)) : [];
    const withPicture = settings?.pictureId ?? null;
    const mediaAfterReply = settings?.mediaAfterReply ?? true;
    const asset = withPicture === null ? null : await resolveSendAsset(tx, input.orgId, withPicture);
    if (withPicture !== null && asset === null) throw new Error('campaign_picture_unavailable');

    const rows = await tx.execute(sql`
      SELECT cr.id, cr.contact_id AS "contactId", c.display_name AS "contactName",
             c.custom_fields AS "customFields", cr.opening_enc AS "openingEnc", cr.planned_gap_ms AS "plannedGapMs",
             -- Nobody in this chat has ever written to this number: a new chat (F6 AC-7.3).
             NOT EXISTS (
               SELECT 1 FROM message i JOIN conversation v ON v.id = i.conversation_id
               WHERE v.contact_id = cr.contact_id AND v.sender_identity_id = ${input.senderIdentityId}
                 AND i.direction = 'inbound') AS "newChat"
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
      plannedGapMs: number | null; newChat: boolean;
    }>;

    let queued = 0;

    for (const recipient of batch) {
      // Recipient-experience gates: skip with a reported reason unless an admin lifted them.
      const blocked = await blockingPolicyGate(tx, {
        orgId: input.orgId, campaignId: input.campaignId, contactId: recipient.contactId,
        senderIdentityId: input.senderIdentityId, overrides: input.gateOverrides ?? [],
        leaveOutRecentDays: settings?.leaveOutDays ?? null
      });
      if (blocked !== null) {
        await tx.execute(sql`
          UPDATE campaign_recipient SET status = 'skipped', skip_reason = ${POLICY_SKIP_REASON[blocked]}
          WHERE id = ${recipient.id} AND org_id = ${input.orgId}`);
        continue;
      }

      // "Skip them" for a blank fill-in (CW-7.7): someone with no value for a field the message uses is left out, with the reason
      // shown. Only a real column counts; a mistyped key is blank for everyone and is dealt with before launch. The AI's own opening
      // for a person does not use the campaign wording, so it is not checked.
      if (blankChoice === 'skip' && recipient.openingEnc === null && missingFillIns(input.body, {
        campaignId: input.campaignId, contactId: recipient.contactId,
        displayName: recipient.contactName, customFields: recipient.customFields
      }, knownFillIns).length > 0) {
        await tx.execute(sql`
          UPDATE campaign_recipient SET status = 'skipped', skip_reason = 'missing_field'
          WHERE id = ${recipient.id} AND org_id = ${input.orgId}`);
        continue;
      }

      // Render this recipient's copy first — a variant picked from a draw seeded by campaign and contact, {{name}} and
      // {{first_name}} filled from the contact (D-26, F6 AC-7.2) — because the stored blind index is of the rendered body.
      // {{name}} plus any of the org's custom fields ({{city}}, {{stage}}…); an unset one is blank.
      // The AI's own opening for this person, when the campaign has an AI template; otherwise the campaign's wording.
      const rendered = recipient.openingEnc !== null
        ? new TextDecoder().decode(kms.decrypt(recipient.openingEnc))
        : renderRecipientBody(input.body, {
          campaignId: input.campaignId, contactId: recipient.contactId,
          displayName: recipient.contactName, customFields: recipient.customFields, fallback
        });
      // A new chat gets the text alone when the campaign has a picture or a link; they get the rest if they reply (F6 AC-7.3).
      const plan = planFirstMessage({
        rendered, hasMedia: asset !== null, newChat: recipient.newChat, mediaAfterReply: mediaAfterReply
      });
      const body = plan.text;
      const media = plan.withMedia ? asset : null;
      const hmac = kms.blindIndex(body);
      // The gap this message waits was drawn when the campaign launched and stays; one that has none yet (a campaign that was
      // already running) gets its draw now, and keeps it.
      const plannedGapMs = recipient.plannedGapMs ?? drawGapMs();

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
                             body_enc, body_hmac, sent_by, campaign_id, dnc_override, media_id, planned_gap_ms)
        VALUES (${input.orgId}, ${conversationId}, 'outbound', 'queued', ${media?.contentType ?? 'text'},
                ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
                ${hmac}, 'system', ${input.campaignId},
                ${(input.gateOverrides ?? []).includes('dnc')}, ${media?.mediaId ?? null}, ${plannedGapMs})
        RETURNING id`);
      const messageId = (created as unknown as Array<{ id: string }>)[0]!.id;

      await tx.execute(sql`
        UPDATE campaign_recipient
        SET status = 'queued', message_id = ${messageId}, attempted_at = now(),
            planned_gap_ms = ${plannedGapMs}, followup_pending = ${plan.split !== null}
        WHERE id = ${recipient.id} AND org_id = ${input.orgId}`);
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
 * times — dispatch is batched, reconciliation is cheap and wants to run every sweep.
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
