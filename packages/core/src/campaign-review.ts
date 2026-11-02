import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import { audienceRule, fillInReportWhere, sampleText, segmentPredicateFor, type FillInReportField } from './campaigns.js';
import { loadCustomFields } from './custom-fields.js';
import { COOLDOWN_DAYS } from './policy-gates.js';
import { loadAntiBanSettings } from './antiban/settings.js';
import { GAP_MAX_MS, GAP_MIN_MS } from './antiban/constants.js';
import type { QuietHoursSetting } from './antiban.js';

/**
 * The New campaign review: what a campaign WOULD reach, worked out before any draft exists.
 *
 * The page lets a person pick several files, tags or "everyone"; the review reads those picks through the one audience rule the dry
 * run, the freeze and the fill-in report already share, so what the review says is what start will freeze. Nothing is written.
 */

/** One thing picked as an audience: an import file, a tag, a saved list, or every contact. */
export type ReviewTarget =
  | { readonly kind: 'import'; readonly id: string }
  | { readonly kind: 'tag'; readonly id: string }
  | { readonly kind: 'segment'; readonly id: string }
  | { readonly kind: 'people'; readonly ids: readonly string[] }
  | { readonly kind: 'everyone' };

/** The audience rule for several picks: a person in more than one is one person. No picks means nobody ("never everyone by accident"). */
export async function targetsRule(tx: Transaction, orgId: string, targets: readonly ReviewTarget[]): Promise<SQL> {
  const parts: SQL[] = [];
  for (const t of targets) {
    if (t.kind === 'everyone') { parts.push(sql`true`); continue; }
    parts.push(audienceRule(orgId, {
      importRun: t.kind === 'import' ? sql`${t.id}::uuid` : sql`NULL::uuid`,
      explicit: t.kind === 'people' ? sql`${JSON.stringify(t.ids)}::jsonb` : sql`NULL::jsonb`,
      tag: t.kind === 'tag' ? sql`${t.id}::uuid` : sql`NULL::uuid`,
      segment: t.kind === 'segment' ? sql`${t.id}::uuid` : sql`NULL::uuid`
    }, t.kind === 'segment' ? await segmentPredicateFor(tx, orgId, t.id) : undefined));
  }
  if (parts.length === 0) return sql`false`;
  return sql.join(parts.map((p) => sql`(${p})`), sql` OR `);
}

/** Who is in the picks, as contact ids: how a draft with more than one pick is stored (one list of people, counted once). */
export async function resolveTargetContactIds(tx: Transaction, orgId: string, targets: readonly ReviewTarget[]): Promise<string[]> {
  const who = await targetsRule(tx, orgId, targets);
  const rows = await tx.execute(sql`SELECT c.id FROM contact c WHERE c.org_id = ${orgId} AND (${who}) ORDER BY c.id`);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/** How a set of picks is stored on a campaign: one file, tag or saved list stays as itself; anything else becomes the one list of people. */
export interface AudienceColumns {
  readonly fromImportRunId?: string | undefined;
  readonly fromTagId?: string | undefined;
  readonly fromSegmentId?: string | undefined;
  readonly explicitContactIds?: readonly string[] | undefined;
}

/**
 * Turns picks into what a campaign stores. One file, tag or saved list is kept as itself, so it is read again when the campaign starts.
 * Several picks, "everyone" or hand-picked people are stored as the people they come to, each counted once. Null when that is nobody.
 */
export async function audienceColumnsFromTargets(tx: Transaction, orgId: string, targets: readonly ReviewTarget[]): Promise<AudienceColumns | null> {
  const only = targets.length === 1 ? targets[0] : undefined;
  if (only?.kind === 'import') return { fromImportRunId: only.id };
  if (only?.kind === 'tag') return { fromTagId: only.id };
  if (only?.kind === 'segment') return { fromSegmentId: only.id };
  const ids = await resolveTargetContactIds(tx, orgId, targets);
  return ids.length === 0 ? null : { explicitContactIds: ids };
}

/** A person of the audience as the preview shows them: their name and a value for each fill-in they have. */
export interface ReviewPerson {
  readonly name: string | null;
  /** fill-in key to the value this person has (a key they have no value for is missing). */
  readonly values: Readonly<Record<string, string>>;
}

/** What the review panel and the fill-in table show. */
export interface CampaignReview {
  /** Everyone the picks match (counted once). */
  readonly total: number;
  /** Who is left out whatever else is chosen, and why. */
  readonly askedToStop: number;
  readonly noNumber: number;
  /** People messaged by another campaign from this number within `recentDays`, who are not already counted above. */
  readonly recentlyMessaged: number;
  readonly recentDays: number;
  /** The org's default for `recentDays`, so the page can say "your default". */
  readonly defaultRecentDays: number;
  /** The org's quiet hours, and the shortest and longest wait between two messages, so the page can say how long it takes and when it ends. */
  readonly quietHours: QuietHoursSetting;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly fields: readonly FillInReportField[];
  /** A few real people to preview the message as. */
  readonly people: readonly ReviewPerson[];
}

/** Reads the review for some picks, from one sending number, with "recently" meaning `days` (or the org's default). */
export async function reviewCampaign(
  tx: Transaction, orgId: string,
  input: { targets: readonly ReviewTarget[]; senderIdentityId: string; days?: number | undefined; sampleSize?: number | undefined }
): Promise<CampaignReview> {
  const who = await targetsRule(tx, orgId, input.targets);
  const defaultRecentDays = (await tx.execute(sql`
    SELECT recent_days AS d FROM antiban_setting WHERE org_id = ${orgId}`) as unknown as Array<{ d: number }>)[0]?.d ?? COOLDOWN_DAYS;
  const recentDays = input.days ?? defaultRecentDays;

  const counts = (await tx.execute(sql`
    WITH audience AS (
      SELECT c.id, c.do_not_contact AS stop,
             EXISTS (SELECT 1 FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                       AND ci.kind IN ('phone', 'wa_jid', 'wa_lid')) AS has_number,
             EXISTS (SELECT 1 FROM message m JOIN conversation v ON v.id = m.conversation_id
                     WHERE v.org_id = ${orgId} AND v.contact_id = c.id AND v.sender_identity_id = ${input.senderIdentityId}
                       AND m.direction = 'outbound' AND m.campaign_id IS NOT NULL AND m.status <> 'failed'
                       AND m.created_at > now() - make_interval(days => ${recentDays})) AS recent
      FROM contact c WHERE c.org_id = ${orgId} AND (${who})
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE stop)::int AS "askedToStop",
           count(*) FILTER (WHERE NOT stop AND NOT has_number)::int AS "noNumber",
           count(*) FILTER (WHERE NOT stop AND has_number AND recent)::int AS "recentlyMessaged"
    FROM audience`) as unknown as Array<{ total: number; askedToStop: number; noNumber: number; recentlyMessaged: number }>)[0]
    ?? { total: 0, askedToStop: 0, noNumber: 0, recentlyMessaged: 0 };

  const report = await fillInReportWhere(tx, orgId, who);
  const defs = await loadCustomFields(tx, orgId);

  const sample = (await tx.execute(sql`
    SELECT trim(c.display_name) AS name, c.custom_fields AS "fields"
    FROM contact c
    WHERE c.org_id = ${orgId} AND (${who}) AND NOT c.do_not_contact
      AND EXISTS (SELECT 1 FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.org_id = ${orgId} AND ci.kind IN ('phone', 'wa_jid', 'wa_lid'))
    ORDER BY c.id LIMIT ${input.sampleSize ?? 6}`) as unknown as Array<{ name: string | null; fields: Record<string, unknown> | null }>);
  const people: ReviewPerson[] = sample.map((r) => {
    const values: Record<string, string> = {};
    const name = r.name === null || r.name === '' ? null : r.name;
    if (name !== null) { values.name = name; values.first_name = name.split(/\s+/)[0] ?? name; }
    for (const d of defs) {
      const v = r.fields?.[d.key];
      if (v !== undefined && v !== null && String(v).trim() !== '') values[d.key] = sampleText(d.type, String(v));
    }
    return { name, values };
  });

  const settings = await loadAntiBanSettings(tx, orgId);
  return {
    ...counts, recentDays, defaultRecentDays, quietHours: settings.quietHours, gapMinMs: GAP_MIN_MS, gapMaxMs: GAP_MAX_MS,
    fields: report.fields, people
  };
}

/** One person who has no value for a fill-in, for the "Download the list to fix" file. */
export interface BlankPerson { readonly name: string | null; readonly phone: string | null }

/** The people the picks reach who have no value for `key` (a fill-in), so they can be fixed in a spreadsheet. */
export async function blankFillInPeople(
  tx: Transaction, orgId: string, targets: readonly ReviewTarget[], key: string
): Promise<BlankPerson[]> {
  const who = await targetsRule(tx, orgId, targets);
  const blank = key === 'name' || key === 'first_name'
    ? sql`nullif(trim(c.display_name), '') IS NULL`
    : sql`nullif(trim(coalesce(c.custom_fields ->> ${key}, '')), '') IS NULL`;
  const rows = await tx.execute(sql`
    SELECT nullif(trim(c.display_name), '') AS name,
           (SELECT ci.value_normalized FROM contact_identity ci
            WHERE ci.contact_id = c.id AND ci.org_id = ${orgId} AND ci.kind IN ('phone', 'wa_jid', 'wa_lid')
            ORDER BY ci.is_primary DESC, ci.id LIMIT 1) AS phone
    FROM contact c
    WHERE c.org_id = ${orgId} AND (${who}) AND NOT c.do_not_contact AND ${blank}
      AND EXISTS (SELECT 1 FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.org_id = ${orgId} AND ci.kind IN ('phone', 'wa_jid', 'wa_lid'))
    ORDER BY c.id LIMIT 50000`);
  return rows as unknown as BlankPerson[];
}

/** The last campaign each file and tag was used for, for the "last campaign: Diwali offer, 2 Nov" line in the picker. */
export interface AudienceHistory {
  readonly imports: Readonly<Record<string, { name: string; at: string }>>;
  readonly tags: Readonly<Record<string, { name: string; at: string }>>;
  readonly segments: Readonly<Record<string, { name: string; at: string }>>;
}

/** Reads the last started campaign that used each import file, tag and saved list. Drafts and cancelled ones do not count: nobody was messaged. */
export async function audienceHistory(tx: Transaction, orgId: string): Promise<AudienceHistory> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (kind, id) kind, id, name, at FROM (
      SELECT 'imports' AS kind, from_import_run_id AS id, name, coalesce(started_at, created_at) AS at FROM campaign
        WHERE org_id = ${orgId} AND from_import_run_id IS NOT NULL AND status IN ('running', 'paused', 'completed')
      UNION ALL
      SELECT 'tags', from_tag_id, name, coalesce(started_at, created_at) FROM campaign
        WHERE org_id = ${orgId} AND from_tag_id IS NOT NULL AND status IN ('running', 'paused', 'completed')
      UNION ALL
      SELECT 'segments', from_segment_id, name, coalesce(started_at, created_at) FROM campaign
        WHERE org_id = ${orgId} AND from_segment_id IS NOT NULL AND status IN ('running', 'paused', 'completed')
    ) u ORDER BY kind, id, at DESC`) as unknown as Array<{ kind: 'imports' | 'tags' | 'segments'; id: string; name: string; at: Date | string }>);
  const out: { imports: Record<string, { name: string; at: string }>; tags: Record<string, { name: string; at: string }>; segments: Record<string, { name: string; at: string }> } =
    { imports: {}, tags: {}, segments: {} };
  for (const r of rows) out[r.kind][r.id] = { name: r.name, at: new Date(r.at).toISOString() };
  return out;
}
