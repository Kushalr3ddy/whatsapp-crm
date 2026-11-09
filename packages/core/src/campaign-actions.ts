import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import { AUDIT, writeAudit, type AuditActor } from './audit.js';
import { campaignProgress, snapshotAudience, type CampaignProgress } from './campaigns.js';
import type { PolicyGate } from './policy-gates.js';
import { GAP_MAX_MS, GAP_MIN_MS } from './antiban/constants.js';
import type { AudienceColumns, ReviewTarget } from './campaign-review.js';

/**
 * The operations on a campaign: create a draft, start or resume it, pause it, cancel it, edit its wording.
 *
 * They live here, not in the HTTP routes, so a person at the keyboard and the AI assistant go through exactly the same
 * code and the same checks. Every function runs inside a transaction the caller opened (already pinned to the org) and
 * writes its own audit row for `actor`.
 */

/** Who did it, and from where, for the audit row. */
export interface ActionContext {
  readonly actor: AuditActor;
  readonly ip?: string | null | undefined;
  readonly requestId?: string | null | undefined;
}

/** The audience, stated exactly once. */
export interface CampaignAudience {
  readonly fromImportRunId?: string | undefined;
  readonly explicitContactIds?: readonly string[] | undefined;
  readonly fromTagId?: string | undefined;
  readonly fromSegmentId?: string | undefined;
}

/** What a new draft needs. */
export interface NewCampaign extends CampaignAudience {
  readonly name: string;
  readonly body: string;
  readonly senderIdentityId: string;
  /** The AI template replies to this campaign follow (D-85); must belong to the org. */
  readonly aiTemplateId?: string | undefined;
  /** A stored campaign picture or GIF sent with every message; must be one of the org's campaign pictures. */
  readonly mediaAssetId?: string | undefined;
  /** Send the picture or link to new chats only after they reply (F6 AC-7.3). On unless said otherwise. */
  readonly mediaAfterReply?: boolean | undefined;
  /** Why these people are being messaged, in a sentence; said in the closing message if one of them opts out (F6 AC-6.2). */
  readonly purpose?: string | null | undefined;
  /** What to do for a person with no value for a fill-in the message uses (CW-7.7): `skip` them, or use `fillInFallback`. Unset = send anyway. */
  readonly blankFillInChoice?: BlankFillInChoice | null | undefined;
  /** The text that fills the gap when `blankFillInChoice` is `fallback`, e.g. "soon". */
  readonly fillInFallback?: string | null | undefined;
  /** What "messaged recently" means for this campaign, in days. Unset = the org's default. */
  readonly recentDays?: number | undefined;
  /** Leave out the people messaged recently from this number. Off = they get the message (a warning, not a block). */
  readonly leaveOutRecent?: boolean | undefined;
  /** The picks the audience was chosen with, kept so the draft can be edited with them back. */
  readonly audienceTargets?: readonly ReviewTarget[] | undefined;
}

/** The three answers to "18 people have no due date": skip them, fill the gap, or send anyway (stored as null). */
export type BlankFillInChoice = 'skip' | 'fallback';

/** What is stored for the 7.7 choice: the fallback only means something with the `fallback` choice; "send anyway" stores nothing. */
function blankChoiceColumns(choice: BlankFillInChoice | null | undefined, fallback: string | null | undefined): [string | null, string | null] {
  if (choice === 'skip') return ['skip', null];
  if (choice === 'fallback' && fallback !== null && fallback !== undefined && fallback.trim() !== '') return ['fallback', fallback.trim()];
  return [null, null];
}

/** Creates a draft. Nothing is sent and no audience is frozen until it is started. */
export async function createCampaignDraft(
  tx: Transaction, orgId: string, ctx: ActionContext, input: NewCampaign
): Promise<{ id: string } | { error: 'no_sender' | 'no_tag' | 'no_segment' | 'no_template' | 'no_picture' }> {
  const sender = await tx.execute(sql`SELECT id FROM sender_identity WHERE id = ${input.senderIdentityId} AND org_id = ${orgId}`);
  if ((sender as unknown as unknown[]).length === 0) return { error: 'no_sender' };

  // A tag or segment audience must exist in this org: a clean "not found" instead of a foreign-key error, and no
  // campaign aimed at another org's tag.
  if (input.fromTagId !== undefined) {
    const t = await tx.execute(sql`SELECT id FROM tag WHERE id = ${input.fromTagId} AND org_id = ${orgId}`);
    if ((t as unknown as unknown[]).length === 0) return { error: 'no_tag' };
  }
  if (input.fromSegmentId !== undefined) {
    const s = await tx.execute(sql`SELECT id FROM segment WHERE id = ${input.fromSegmentId} AND org_id = ${orgId}`);
    if ((s as unknown as unknown[]).length === 0) return { error: 'no_segment' };
  }

  if (input.aiTemplateId !== undefined) {
    const tpl = await tx.execute(sql`SELECT id FROM ai_template WHERE id = ${input.aiTemplateId} AND org_id = ${orgId}`);
    if ((tpl as unknown as unknown[]).length === 0) return { error: 'no_template' };
  }

  if (input.mediaAssetId !== undefined) {
    const pic = await tx.execute(sql`SELECT id FROM media_asset WHERE id = ${input.mediaAssetId} AND org_id = ${orgId} AND campaign_picture`);
    if ((pic as unknown as unknown[]).length === 0) return { error: 'no_picture' };
  }

  // A double click (or ten) must not make ten drafts: an identical draft made in the last 30 seconds is returned instead.
  const twin = await tx.execute(sql`
    SELECT id FROM campaign
    WHERE org_id = ${orgId} AND status = 'draft' AND name = ${input.name} AND body = ${input.body}
      AND sender_identity_id = ${input.senderIdentityId} AND created_at > now() - interval '30 seconds'
    ORDER BY created_at DESC LIMIT 1`);
  const existing = (twin as unknown as Array<{ id: string }>)[0];
  if (existing !== undefined) return { id: existing.id };

  const [blankChoice, fallback] = blankChoiceColumns(input.blankFillInChoice, input.fillInFallback);
  const rows = await tx.execute(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, from_import_run_id,
                          explicit_contact_ids, from_tag_id, from_segment_id, ai_template_id, media_asset_id, media_after_reply, purpose,
                          blank_fill_in_choice, fill_in_fallback, recent_days, leave_out_recent, audience_targets, status)
    VALUES (${orgId}, ${input.name}, ${input.body}, ${input.senderIdentityId}, ${input.fromImportRunId ?? null},
            ${input.explicitContactIds === undefined ? null : JSON.stringify(input.explicitContactIds)}::jsonb,
            ${input.fromTagId ?? null}, ${input.fromSegmentId ?? null}, ${input.aiTemplateId ?? null}, ${input.mediaAssetId ?? null}, ${input.mediaAfterReply ?? true}, ${input.purpose ?? null},
            ${blankChoice}, ${fallback}, ${input.recentDays ?? null}, ${input.leaveOutRecent ?? false},
            ${input.audienceTargets === undefined ? null : JSON.stringify(input.audienceTargets)}::jsonb, 'draft')
    RETURNING id`);
  const id = (rows as unknown as Array<{ id: string }>)[0]!.id;
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignCreated, targetType: 'campaign', targetId: id,
    after: { name: input.name, senderIdentityId: input.senderIdentityId }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return { id };
}

/** The outcome of starting: how far along it is. */
export interface StartedCampaign { readonly progress: CampaignProgress }

/**
 * Starts a draft, or resumes a paused campaign: freezes the audience (first start only) and lets the gateway begin.
 *
 * Lifting policy gates is an admin's decision made by the caller: pass `override` only for a signed-in admin
 * (the assistant never does).
 */
export async function startCampaign(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string,
  override?: { gates: readonly PolicyGate[]; reason: string }
): Promise<StartedCampaign | { error: 'not_found' | 'already_running' | 'finished' }> {
  const rows = await tx.execute(sql`
    SELECT status, started_at AS "startedAt" FROM campaign
    WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`);
  const campaign = (rows as unknown as Array<{ status: string; startedAt: Date | string | null }>)[0];
  if (!campaign) return { error: 'not_found' };
  if (campaign.status === 'running') return { error: 'already_running' };
  if (campaign.status === 'completed' || campaign.status === 'cancelled') return { error: 'finished' };

  // Only on the first start, which is "never started", not "is a draft": a campaign paused before it ever started (older data, R-022)
  // has no audience yet either. Resuming one that did start must not re-snapshot, or contacts added since would silently join an
  // audience somebody already approved.
  if (campaign.startedAt === null) await snapshotAudience(tx, orgId, id);

  // Draw every recipient's gap once, now, and keep it: the lane waits exactly this long before each message, so the schedule
  // and the ETA are known before anything is sent (F6 AC-3.1). A resume only fills the recipients that have none.
  await tx.execute(sql`
    UPDATE campaign_recipient
    SET planned_gap_ms = ${GAP_MIN_MS} + floor(random() * ${GAP_MAX_MS - GAP_MIN_MS + 1})::int
    WHERE campaign_id = ${id} AND org_id = ${orgId} AND planned_gap_ms IS NULL AND status = 'pending'`);

  await tx.execute(sql`
    UPDATE campaign SET status = 'running', started_at = coalesce(started_at, now()), pause_reason = NULL, updated_at = now()
    WHERE id = ${id} AND org_id = ${orgId}`);

  const gates = override === undefined ? [] : [...new Set(override.gates)];
  if (override !== undefined && gates.length > 0) {
    await tx.execute(sql`
      UPDATE campaign SET gate_overrides = ${sql`ARRAY[${sql.join(gates.map((g) => sql`${g}`), sql`, `)}]::text[]`},
                          gate_override_reason = ${override.reason}
      WHERE id = ${id} AND org_id = ${orgId}`);
    await writeAudit(tx, {
      orgId, actor: ctx.actor, action: AUDIT.campaignGatesOverridden, targetType: 'campaign', targetId: id,
      after: { gates, reason: override.reason }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
    });
  }

  const progress = await campaignProgress(tx, orgId, id);

  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignStarted, targetType: 'campaign', targetId: id,
    after: { ...progress }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return { progress };
}

/**
 * What may become what. Cancel ends a campaign at any point before it finishes, a draft included. Pause only stops one that has started:
 * a paused draft would have no frozen audience, and Resume would then "finish" it having messaged nobody (R-022).
 */
const PAUSABLE = ['running', 'paused'] as const;
const CANCELLABLE = ['running', 'paused', 'draft'] as const;

/**
 * Pauses or cancels a campaign that has not finished. Cancelling is permanent and turns everything still pending into
 * `skipped` with a reason, so the totals keep adding up; messages already queued are left alone.
 * `not_started` is a draft asked to pause; `not_found` is a campaign that does not exist or has already finished.
 */
export async function setCampaignStatus(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string, to: 'paused' | 'cancelled'
): Promise<'ok' | 'not_found' | 'not_started'> {
  const from = to === 'paused' ? PAUSABLE : CANCELLABLE;
  const rows = await tx.execute(sql`
    UPDATE campaign SET status = ${to}, updated_at = now(),
                        completed_at = CASE WHEN ${to} = 'cancelled' THEN now() ELSE completed_at END
    WHERE id = ${id} AND org_id = ${orgId} AND status IN (${sql.join(from.map((s) => sql`${s}`), sql`, `)})
    RETURNING id`);
  if ((rows as unknown as unknown[]).length === 0) {
    const found = (await tx.execute(sql`
      SELECT status FROM campaign WHERE id = ${id} AND org_id = ${orgId}`) as unknown as Array<{ status: string }>)[0];
    return found?.status === 'draft' ? 'not_started' : 'not_found';
  }
  if (to === 'cancelled') {
    // Cancel means nothing more goes out. Messages already queued for the campaign are taken back too; only one already handed to
    // WhatsApp (in flight) is past recalling.
    const withdrawn = await tx.execute(sql`
      UPDATE message SET status = 'failed', error_code = 'campaign_cancelled',
          error_detail = 'Not sent: the campaign was cancelled before this message went out.', hold_reason = NULL, hold_until = NULL
      WHERE campaign_id = ${id} AND org_id = ${orgId} AND direction = 'outbound' AND status = 'queued' AND send_started_at IS NULL
      RETURNING id`) as unknown as Array<{ id: string }>;
    if (withdrawn.length > 0) {
      await tx.execute(sql`
        UPDATE campaign_recipient SET status = 'skipped', skip_reason = 'cancelled'
        WHERE campaign_id = ${id} AND org_id = ${orgId} AND status = 'queued'
          AND message_id IN (${sql.join(withdrawn.map((w) => sql`${w.id}`), sql`, `)})`);
    }
    await tx.execute(sql`
      UPDATE campaign_recipient SET status = 'skipped', skip_reason = 'cancelled'
      WHERE campaign_id = ${id} AND org_id = ${orgId} AND status = 'pending'`);
  }
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: to === 'paused' ? AUDIT.campaignPaused : AUDIT.campaignCancelled,
    targetType: 'campaign', targetId: id, after: { status: to }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return 'ok';
}

/** What `editCampaign` can change. Name and wording work on a draft or a paused campaign; the rest only on a draft. */
export interface CampaignEdit {
  readonly name?: string | undefined;
  readonly body?: string | undefined;
  readonly mediaAfterReply?: boolean | undefined;
  /** The 7.7 choice; `null` goes back to "send anyway". Left out = unchanged. */
  readonly blankFillInChoice?: BlankFillInChoice | null | undefined;
  readonly fillInFallback?: string | null | undefined;
  /** Draft only from here down. `null` takes the template or picture off. */
  readonly senderIdentityId?: string | undefined;
  readonly aiTemplateId?: string | null | undefined;
  readonly mediaAssetId?: string | null | undefined;
  readonly recentDays?: number | null | undefined;
  readonly leaveOutRecent?: boolean | undefined;
  /** A new audience, as `audienceColumnsFromTargets` makes it, with the picks it came from. */
  readonly audience?: AudienceColumns | undefined;
  readonly audienceTargets?: readonly ReviewTarget[] | undefined;
}

/** Why an edit was refused. */
export type EditError = 'not_found' | 'not_editable' | 'no_sender' | 'no_tag' | 'no_segment' | 'no_template' | 'no_picture';

/** Checks that what a campaign points at belongs to the org: a clean "not found" instead of a foreign-key error. */
async function missingReference(
  tx: Transaction, orgId: string,
  refs: { sender?: string | undefined; tag?: string | undefined; segment?: string | undefined; template?: string | null | undefined; picture?: string | null | undefined }
): Promise<'no_sender' | 'no_tag' | 'no_segment' | 'no_template' | 'no_picture' | null> {
  const none = async (q: ReturnType<typeof sql>): Promise<boolean> => (await tx.execute(q) as unknown as unknown[]).length === 0;
  if (refs.sender !== undefined && await none(sql`SELECT id FROM sender_identity WHERE id = ${refs.sender} AND org_id = ${orgId}`)) return 'no_sender';
  if (refs.tag !== undefined && await none(sql`SELECT id FROM tag WHERE id = ${refs.tag} AND org_id = ${orgId}`)) return 'no_tag';
  if (refs.segment !== undefined && await none(sql`SELECT id FROM segment WHERE id = ${refs.segment} AND org_id = ${orgId}`)) return 'no_segment';
  if (refs.template !== undefined && refs.template !== null && await none(sql`SELECT id FROM ai_template WHERE id = ${refs.template} AND org_id = ${orgId}`)) return 'no_template';
  if (refs.picture !== undefined && refs.picture !== null && await none(sql`SELECT id FROM media_asset WHERE id = ${refs.picture} AND org_id = ${orgId} AND campaign_picture`)) return 'no_picture';
  return null;
}

/**
 * Changes a campaign. The name and wording can change while it is a draft or paused: a running campaign is mid-send, and rewording it
 * under the gateway would make one audience see two different messages, so pause it first. Everything else (the number, who gets it,
 * the picture, the template, "messaged recently") changes only on a draft, before an audience is frozen.
 */
export async function editCampaign(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string, change: CampaignEdit
): Promise<'ok' | EditError> {
  const found = (await tx.execute(sql`
    SELECT status, name, body FROM campaign WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`) as unknown as Array<{
    status: string; name: string; body: string;
  }>)[0];
  if (found === undefined) return 'not_found';
  if (found.status !== 'draft' && found.status !== 'paused') return 'not_editable';
  const draftOnly = change.senderIdentityId !== undefined || change.aiTemplateId !== undefined || change.mediaAssetId !== undefined
    || change.recentDays !== undefined || change.leaveOutRecent !== undefined || change.audience !== undefined;
  if (draftOnly && found.status !== 'draft') return 'not_editable';

  const missing = await missingReference(tx, orgId, {
    sender: change.senderIdentityId, tag: change.audience?.fromTagId, segment: change.audience?.fromSegmentId,
    template: change.aiTemplateId, picture: change.mediaAssetId
  });
  if (missing !== null) return missing;

  const name = change.name ?? found.name;
  const body = change.body ?? found.body;
  await tx.execute(sql`
    UPDATE campaign SET name = ${name}, body = ${body}, media_after_reply = coalesce(${change.mediaAfterReply ?? null}::boolean, media_after_reply),
                        updated_at = now()
    WHERE id = ${id} AND org_id = ${orgId}`);
  if (change.blankFillInChoice !== undefined || change.fillInFallback !== undefined) {
    const [choice, fallback] = blankChoiceColumns(change.blankFillInChoice, change.fillInFallback);
    await tx.execute(sql`
      UPDATE campaign SET blank_fill_in_choice = ${choice}, fill_in_fallback = ${fallback}
      WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.senderIdentityId !== undefined) {
    await tx.execute(sql`UPDATE campaign SET sender_identity_id = ${change.senderIdentityId} WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.aiTemplateId !== undefined) {
    await tx.execute(sql`UPDATE campaign SET ai_template_id = ${change.aiTemplateId} WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.mediaAssetId !== undefined) {
    await tx.execute(sql`UPDATE campaign SET media_asset_id = ${change.mediaAssetId} WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.recentDays !== undefined) {
    await tx.execute(sql`UPDATE campaign SET recent_days = ${change.recentDays} WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.leaveOutRecent !== undefined) {
    await tx.execute(sql`UPDATE campaign SET leave_out_recent = ${change.leaveOutRecent} WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (change.audience !== undefined) {
    await tx.execute(sql`
      UPDATE campaign SET from_import_run_id = ${change.audience.fromImportRunId ?? null}, from_tag_id = ${change.audience.fromTagId ?? null},
        from_segment_id = ${change.audience.fromSegmentId ?? null},
        explicit_contact_ids = ${change.audience.explicitContactIds === undefined ? null : JSON.stringify(change.audience.explicitContactIds)}::jsonb,
        audience_targets = ${change.audienceTargets === undefined ? null : JSON.stringify(change.audienceTargets)}::jsonb
      WHERE id = ${id} AND org_id = ${orgId}`);
  }
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignEdited, targetType: 'campaign', targetId: id,
    // The wording itself is not logged, only that it changed and how long it is now.
    before: { name: found.name, bodyLength: found.body.length }, after: { name, bodyLength: body.length },
    ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return 'ok';
}
