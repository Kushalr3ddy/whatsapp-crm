import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import { AUDIT, writeAudit, type AuditActor } from './audit.js';
import { campaignProgress, forecast, snapshotAudience, type CampaignForecast, type CampaignProgress } from './campaigns.js';
import type { PolicyGate } from './policy-gates.js';

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
}

/** The sender's ceilings, for the forecast shown when a campaign starts. */
export interface CampaignLimits { readonly perMinute: number; readonly perDay: number }

/** Creates a draft. Nothing is sent and no audience is frozen until it is started. */
export async function createCampaignDraft(
  tx: Transaction, orgId: string, ctx: ActionContext, input: NewCampaign
): Promise<{ id: string } | { error: 'no_sender' | 'no_tag' | 'no_segment' }> {
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

  const rows = await tx.execute(sql`
    INSERT INTO campaign (org_id, name, body, sender_identity_id, from_import_run_id,
                          explicit_contact_ids, from_tag_id, from_segment_id, status)
    VALUES (${orgId}, ${input.name}, ${input.body}, ${input.senderIdentityId}, ${input.fromImportRunId ?? null},
            ${input.explicitContactIds === undefined ? null : JSON.stringify(input.explicitContactIds)}::jsonb,
            ${input.fromTagId ?? null}, ${input.fromSegmentId ?? null}, 'draft')
    RETURNING id`);
  const id = (rows as unknown as Array<{ id: string }>)[0]!.id;
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignCreated, targetType: 'campaign', targetId: id,
    after: { name: input.name, senderIdentityId: input.senderIdentityId }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return { id };
}

/** The outcome of starting: how far along it is, and how long the rest will take. */
export interface StartedCampaign { readonly progress: CampaignProgress; readonly outlook: CampaignForecast }

/**
 * Starts a draft, or resumes a paused campaign: freezes the audience (first start only) and lets the gateway begin.
 *
 * The forecast comes back with it, because how long this will take is a fact the operator needs at the moment of
 * starting. Lifting policy gates is an admin's decision made by the caller: pass `override` only for a signed-in admin
 * (the assistant never does).
 */
export async function startCampaign(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string, limits: CampaignLimits,
  override?: { gates: readonly PolicyGate[]; reason: string }
): Promise<StartedCampaign | { error: 'not_found' | 'already_running' | 'finished' }> {
  const rows = await tx.execute(sql`
    SELECT status, sender_identity_id AS "senderIdentityId" FROM campaign
    WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`);
  const campaign = (rows as unknown as Array<{ status: string; senderIdentityId: string }>)[0];
  if (!campaign) return { error: 'not_found' };
  if (campaign.status === 'running') return { error: 'already_running' };
  if (campaign.status === 'completed' || campaign.status === 'cancelled') return { error: 'finished' };

  // Only on the first start. Resuming a paused campaign must not re-snapshot, or contacts added since would silently
  // join an audience somebody already approved.
  if (campaign.status === 'draft') await snapshotAudience(tx, orgId, id);

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
  const senderLimits = await tx.execute(sql`
    SELECT warmup_started_at AS "warmupStartedAt", daily_cap_override AS "dailyCapOverride", last_inbound_at AS "lastInboundAt"
    FROM sender_identity WHERE id = ${campaign.senderIdentityId} AND org_id = ${orgId}`);
  const s = (senderLimits as unknown as Array<{
    warmupStartedAt: string | null; dailyCapOverride: number | null; lastInboundAt: string | null;
  }>)[0]!;
  const outlook = await forecast(tx, campaign.senderIdentityId, progress.pending, {
    perMinute: limits.perMinute, perDay: limits.perDay, dailyCapOverride: s.dailyCapOverride,
    warmupStartedAt: s.warmupStartedAt === null ? null : new Date(s.warmupStartedAt),
    lastInboundAt: s.lastInboundAt === null ? null : new Date(s.lastInboundAt)
  });

  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignStarted, targetType: 'campaign', targetId: id,
    after: { ...progress, ...outlook }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return { progress, outlook };
}

/**
 * Pauses or cancels a campaign that has not finished. Cancelling is permanent and turns everything still pending into
 * `skipped` with a reason, so the totals keep adding up; messages already queued are left alone.
 */
export async function setCampaignStatus(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string, to: 'paused' | 'cancelled'
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE campaign SET status = ${to}, updated_at = now(),
                        completed_at = CASE WHEN ${to} = 'cancelled' THEN now() ELSE completed_at END
    WHERE id = ${id} AND org_id = ${orgId} AND status IN ('running', 'paused', 'draft')
    RETURNING id`);
  if ((rows as unknown as unknown[]).length === 0) return false;
  if (to === 'cancelled') {
    await tx.execute(sql`
      UPDATE campaign_recipient SET status = 'skipped', skip_reason = 'cancelled'
      WHERE campaign_id = ${id} AND org_id = ${orgId} AND status = 'pending'`);
  }
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: to === 'paused' ? AUDIT.campaignPaused : AUDIT.campaignCancelled,
    targetType: 'campaign', targetId: id, after: { status: to }, ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return true;
}

/**
 * Changes a campaign's name or wording. Only while it is a draft or paused: a running campaign is mid-send, and
 * rewording it under the gateway would make one audience see two different messages, so pause it first.
 */
export async function editCampaign(
  tx: Transaction, orgId: string, ctx: ActionContext, id: string, change: { name?: string | undefined; body?: string | undefined }
): Promise<'ok' | 'not_found' | 'not_editable'> {
  const found = (await tx.execute(sql`
    SELECT status, name, body FROM campaign WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`) as unknown as Array<{
    status: string; name: string; body: string;
  }>)[0];
  if (found === undefined) return 'not_found';
  if (found.status !== 'draft' && found.status !== 'paused') return 'not_editable';
  const name = change.name ?? found.name;
  const body = change.body ?? found.body;
  await tx.execute(sql`UPDATE campaign SET name = ${name}, body = ${body}, updated_at = now() WHERE id = ${id} AND org_id = ${orgId}`);
  await writeAudit(tx, {
    orgId, actor: ctx.actor, action: AUDIT.campaignEdited, targetType: 'campaign', targetId: id,
    // The wording itself is not logged, only that it changed and how long it is now.
    before: { name: found.name, bodyLength: found.body.length }, after: { name, bodyLength: body.length },
    ip: ctx.ip ?? null, requestId: ctx.requestId ?? null
  });
  return 'ok';
}
