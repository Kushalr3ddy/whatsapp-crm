import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '@crm/db';
import { AUDIT, writeAudit, type AuditActor } from './audit.js';

/**
 * AI credits. 1 credit = 1 AI message the AI writes: an opening, a reply, a template draft or an example. Every call to the model
 * records one `ai_run` row with its real token counts, the campaign and the template, so a money figure can be added later from
 * the stored tokens. A reply the app sends without the model (a customer's photo) is not a credit.
 */

/** Replies per person assumed when a campaign has no history to learn from. */
export const AI_ASSUMED_REPLIES = 3;

/** One AI call to record. */
export interface AiRunInput {
  readonly orgId: string;
  /** `opening`, `reply`, `handover`, `draft`, `example`, `fillins`, or `fixed_reply` (no model, not a credit). */
  readonly kind: string;
  /** `sent` and `blocked` count toward the daily limit of messages; `written` and `done` do not. */
  readonly outcome: string;
  readonly reason?: string | null;
  readonly model?: string | null;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly conversationId?: string | null;
  readonly campaignId?: string | null;
  readonly templateId?: string | null;
  /** The person who asked for it; none when the assistant acted by itself. */
  readonly userId?: string | null;
}

/** Writes one `ai_run` row. */
export async function recordAiRun(db: Database, run: AiRunInput): Promise<void> {
  const usage = run.usage ?? { inputTokens: 0, outputTokens: 0 };
  await db.execute(sql`
    INSERT INTO ai_run (org_id, conversation_id, campaign_id, template_id, user_id, kind, outcome, reason, model, input_tokens, output_tokens)
    VALUES (${run.orgId}, ${run.conversationId ?? null}, ${run.campaignId ?? null}, ${run.templateId ?? null}, ${run.userId ?? null}, ${run.kind}, ${run.outcome},
            ${run.reason ?? null}, ${run.model ?? null}, ${usage.inputTokens}, ${usage.outputTokens})`);
}

/** What an AI campaign would use: each person's opening plus about three replies, an estimate. */
export function estimateAiCredits(people: number): { people: number; openings: number; replies: number; credits: number } {
  const openings = Math.max(0, Math.floor(people));
  const replies = openings * AI_ASSUMED_REPLIES;
  return { people: openings, openings, replies, credits: openings + replies };
}

/** What a campaign has used so far: one credit for each call that reached the model. */
export interface CampaignAiUsage {
  readonly credits: number;
  readonly openings: number;
  readonly replies: number;
}

/** The credits a campaign has used so far, from the stored calls. */
export async function campaignAiUsage(db: Database | Transaction, orgId: string, campaignId: string): Promise<CampaignAiUsage> {
  const row = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE model IS NOT NULL)::int AS credits,
           count(*) FILTER (WHERE model IS NOT NULL AND kind = 'opening')::int AS openings,
           count(*) FILTER (WHERE model IS NOT NULL AND kind IN ('reply', 'handover'))::int AS replies
    FROM ai_run WHERE org_id = ${orgId} AND campaign_id = ${campaignId}`) as unknown as CampaignAiUsage[])[0];
  return row ?? { credits: 0, openings: 0, replies: 0 };
}

/**
 * Stops the AI on one campaign. It writes no more openings and answers no more replies of that campaign; chats it holds, and later
 * replies, go to the person the template names (or stay unassigned when it names none). Other campaigns keep their AI.
 * Returns false when the campaign does not exist or has no template.
 */
export async function stopCampaignAi(tx: Transaction, orgId: string, campaignId: string, actor: AuditActor): Promise<boolean> {
  const row = (await tx.execute(sql`
    SELECT c.name, CASE WHEN om.user_id IS NULL THEN NULL ELSE t.fallback_user_id END AS "to", s.bot_user_id AS "bot"
    FROM campaign c JOIN ai_template t ON t.id = c.ai_template_id AND t.org_id = c.org_id
    LEFT JOIN ai_setting s ON s.org_id = c.org_id
    LEFT JOIN org_membership om ON om.org_id = c.org_id AND om.user_id = t.fallback_user_id
    WHERE c.id = ${campaignId} AND c.org_id = ${orgId}`) as unknown as Array<{ name: string; to: string | null; bot: string | null }>)[0];
  if (row === undefined) return false;
  await tx.execute(sql`UPDATE campaign SET ai_stopped = true, updated_at = now() WHERE id = ${campaignId} AND org_id = ${orgId}`);
  if (row.bot !== null) {
    await tx.execute(sql`
      UPDATE conversation v SET assignee_user_id = ${row.to}, updated_at = now()
      WHERE v.org_id = ${orgId} AND v.assignee_user_id = ${row.bot}
        AND (SELECT m.campaign_id FROM message m WHERE m.conversation_id = v.id AND m.org_id = v.org_id AND m.direction = 'outbound'
               AND m.campaign_id IS NOT NULL AND m.status <> 'failed' ORDER BY m.created_at DESC LIMIT 1) = ${campaignId}`);
  }
  await writeAudit(tx, { orgId, actor, action: AUDIT.campaignEdited, targetType: 'campaign', targetId: campaignId, after: { aiStopped: true } });
  return true;
}

/** What one activity used, by kind of call. */
export interface AiUsagePart {
  readonly kind: string;
  readonly count: number;
}

/**
 * One activity in the credit log: a campaign's AI messages for a day, one person's work on a template for a day, or the chats that
 * did not come from a campaign. `credits` is how many AI messages it took.
 */
export interface AiActivity {
  readonly at: string;
  readonly scope: 'campaign' | 'chat' | 'template';
  /** The campaign or template it was for, or null when it has no name (a template not saved yet). */
  readonly name: string | null;
  /** The person who did it, or null when the assistant acted by itself. */
  readonly who: string | null;
  readonly parts: readonly AiUsagePart[];
  readonly models: readonly string[];
  readonly tokens: number;
  readonly credits: number;
}

/** The credit log: totals for today, this month and all time, and the latest activities. */
export interface AiUsageLog {
  readonly today: number;
  readonly month: number;
  readonly total: number;
  readonly activities: readonly AiActivity[];
}

/** A row of the per-kind rollup the log is built from. */
interface KindRow {
  d: string; campaign_id: string | null; template_id: string | null; user_id: string | null; chat: boolean; kind: string;
  n: number; tin: number; tout: number; at: string; models: string[]; campaignName: string | null; templateName: string | null; userName: string | null;
}

/**
 * The org's AI credit log. Calls are only ever appended to `ai_run` (never counted up in place), so people working at the same time
 * cannot overwrite each other's credits. The totals and the rows come from ONE statement, so they always agree even while calls are
 * being added. Only calls that reached the model count; a fixed reply the app sent without the model is not listed.
 */
export async function listAiUsage(db: Database, orgId: string, limit = 100): Promise<AiUsageLog> {
  const out = (await db.execute(sql`
    WITH base AS (SELECT * FROM ai_run WHERE org_id = ${orgId} AND model IS NOT NULL),
    per_kind AS (
      SELECT date_trunc('day', created_at) AS d, campaign_id, template_id, user_id,
             (campaign_id IS NULL AND conversation_id IS NOT NULL) AS chat, kind,
             count(*)::int AS n, sum(input_tokens)::int AS tin, sum(output_tokens)::int AS tout, max(created_at) AS at, array_agg(DISTINCT model) AS models
      FROM base WHERE created_at > now() - interval '90 days' GROUP BY 1, 2, 3, 4, 5, 6
    )
    SELECT (SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now())) FROM base)::int AS today,
           (SELECT count(*) FILTER (WHERE created_at >= date_trunc('month', now())) FROM base)::int AS month,
           (SELECT count(*) FROM base)::int AS total,
           (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
              SELECT pk.d, pk.campaign_id, pk.template_id, pk.user_id, pk.chat, pk.kind, pk.n, pk.tin, pk.tout, pk.at, pk.models,
                     c.name AS "campaignName", t.name AS "templateName", u.display_name AS "userName"
              FROM per_kind pk
              LEFT JOIN campaign c ON c.id = pk.campaign_id AND c.org_id = ${orgId}
              LEFT JOIN ai_template t ON t.id = pk.template_id AND t.org_id = ${orgId}
              LEFT JOIN app_user u ON u.id = pk.user_id
           ) x) AS rows`) as unknown as Array<{ today: number; month: number; total: number; rows: KindRow[] }>)[0]
    ?? { today: 0, month: 0, total: 0, rows: [] };

  // One activity = one day of one campaign / template / person. Its kinds are listed with how many of each.
  const groups = new Map<string, { at: string; scope: AiActivity['scope']; name: string | null; who: string | null; parts: Map<string, number>; models: Set<string>; tokens: number; credits: number }>();
  for (const r of out.rows) {
    const scope: AiActivity['scope'] = r.campaign_id !== null ? 'campaign' : r.chat ? 'chat' : 'template';
    const key = `${r.d}|${r.campaign_id ?? ''}|${r.template_id ?? ''}|${r.user_id ?? ''}|${r.chat ? 'c' : ''}`;
    const g = groups.get(key) ?? {
      at: r.at, scope, name: scope === 'campaign' ? r.campaignName : r.templateName, who: r.userName,
      parts: new Map<string, number>(), models: new Set<string>(), tokens: 0, credits: 0
    };
    if (r.at > g.at) g.at = r.at;
    g.parts.set(r.kind, (g.parts.get(r.kind) ?? 0) + r.n);
    r.models.forEach((m) => g.models.add(m));
    g.tokens += r.tin + r.tout;
    g.credits += r.n;
    groups.set(key, g);
  }
  const activities = [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, Math.min(500, Math.max(1, limit))).map((g): AiActivity => ({
    at: g.at, scope: g.scope, name: g.name, who: g.who, parts: [...g.parts].map(([kind, count]) => ({ kind, count })), models: [...g.models], tokens: g.tokens, credits: g.credits
  }));
  return { today: out.today, month: out.month, total: out.total, activities };
}
