import { sql, type SQL } from 'drizzle-orm';
import { buildSegmentPredicate, type SegmentDefinition } from './segments.js';

/**
 * Mass tagging: add or remove one tag across many contacts in a single set-based statement.
 *
 * The audience is a **target** resolved on the server — never a list of ids posted from a page that
 * only ever shows 50 people. Targets: everyone, everyone matching a search / tag filter (the exact
 * rule the contact list uses), everyone a saved segment matches, or an explicit list of ids. Tagging is
 * not messaging, so do-not-contact people are tagged like anyone else; the send gate is what stops a
 * message to them.
 */
export type TagTarget =
  | { readonly kind: 'all' }
  | ({ readonly kind: 'search' } & ContactFilter)
  | { readonly kind: 'segment'; readonly segmentId: string }
  | { readonly kind: 'ids'; readonly ids: readonly string[] };

/**
 * What the contact list can be narrowed by. `from` / `to` are calendar days (`YYYY-MM-DD`, both included)
 * and apply to the day the person was added, or to the day they were last imported (`dateBy`).
 */
export interface ContactFilter {
  readonly q?: string | undefined;
  readonly tagId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly dateBy?: 'added' | 'imported' | undefined;
}

/** Anything that can run a query — a request's tenant transaction. */
interface Executor { execute: (q: SQL) => Promise<unknown> }

/**
 * The list screen's search and tag-filter rule, over a contact aliased `c`. One definition shared by
 * the contact list, its count and bulk tagging, so "the 37 people I can see" and "the 37 people it
 * will tag" can never drift apart.
 */
export function searchPredicate(orgId: string, filter: ContactFilter): SQL {
  const like = filter.q === undefined || filter.q === '' ? null : `%${filter.q}%`;
  const tagId = filter.tagId ?? null;
  const from = filter.from === undefined || filter.from === '' ? null : filter.from;
  const to = filter.to === undefined || filter.to === '' ? null : filter.to;
  const imported = filter.dateBy === 'imported';
  return sql`c.org_id = ${orgId} AND c.deleted_at IS NULL
    AND (${like}::text IS NULL
         OR c.display_name ILIKE ${like}
         OR EXISTS (SELECT 1 FROM jsonb_each_text(c.custom_fields) cf WHERE cf.value ILIKE ${like})
         OR EXISTS (SELECT 1 FROM contact_identity ci2
                    WHERE ci2.contact_id = c.id AND ci2.value_normalized ILIKE ${like}))
    AND (${tagId}::uuid IS NULL
         OR EXISTS (SELECT 1 FROM contact_tag ct2
                    WHERE ct2.contact_id = c.id AND ct2.tag_id = ${tagId}::uuid))
    AND (${from}::date IS NULL AND ${to}::date IS NULL
         OR (NOT ${imported}
             AND (${from}::date IS NULL OR c.created_at >= ${from}::date)
             AND (${to}::date IS NULL OR c.created_at < ${to}::date + 1))
         OR (${imported} AND EXISTS (
               SELECT 1 FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
               WHERE ir.contact_id = c.id
                 AND (${from}::date IS NULL OR r.created_at >= ${from}::date)
                 AND (${to}::date IS NULL OR r.created_at < ${to}::date + 1))))`;
}

/** Turns a target into a predicate over `c`, or null when it names a segment that does not exist. */
export async function resolveTarget(tx: Executor, orgId: string, target: TagTarget): Promise<SQL | null> {
  switch (target.kind) {
    case 'all':
      return sql`c.org_id = ${orgId} AND c.deleted_at IS NULL`;
    case 'search':
      return searchPredicate(orgId, target);
    case 'ids':
      return sql`c.org_id = ${orgId} AND c.deleted_at IS NULL
        AND c.id = ANY(ARRAY[${sql.join(target.ids.map((i) => sql`${i}`), sql`, `)}]::uuid[])`;
    case 'segment': {
      const rows = await tx.execute(sql`
        SELECT definition FROM segment WHERE id = ${target.segmentId} AND org_id = ${orgId}`);
      const def = (rows as unknown as Array<{ definition: SegmentDefinition }>)[0]?.definition;
      // A segment never includes do-not-contact people (that is its own rule), so a segment target
      // tags fewer people than "everyone" would; the preview count says so.
      return def === undefined ? null : sql`c.org_id = ${orgId} AND (${buildSegmentPredicate(def, orgId)})`;
    }
  }
}

/** How many contacts a predicate matches. */
export async function countMatching(tx: Executor, predicate: SQL): Promise<number> {
  const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM contact c WHERE ${predicate}`);
  return (rows as unknown as Array<{ n: number }>)[0]!.n;
}

/** Adds the tag to everyone the predicate matches; returns how many did not already carry it. */
export async function bulkTag(tx: Executor, orgId: string, tagId: string, predicate: SQL): Promise<number> {
  const rows = await tx.execute(sql`
    WITH ins AS (
      INSERT INTO contact_tag (org_id, contact_id, tag_id)
      SELECT ${orgId}, c.id, ${tagId} FROM contact c WHERE ${predicate}
      ON CONFLICT (contact_id, tag_id) DO NOTHING
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  return (rows as unknown as Array<{ n: number }>)[0]!.n;
}

/** Removes the tag from everyone the predicate matches; returns how many carried it. */
export async function bulkUntag(tx: Executor, orgId: string, tagId: string, predicate: SQL): Promise<number> {
  const rows = await tx.execute(sql`
    WITH del AS (
      DELETE FROM contact_tag ct USING contact c
      WHERE ct.org_id = ${orgId} AND ct.tag_id = ${tagId} AND c.id = ct.contact_id AND ${predicate}
      RETURNING 1)
    SELECT count(*)::int AS n FROM del`);
  return (rows as unknown as Array<{ n: number }>)[0]!.n;
}

/**
 * Tags everyone a committed import run created, updated or matched (outcome `created`, `updated` or
 * `skipped`; errors have no contact). Idempotent, so a retried commit tags nobody twice.
 */
export async function tagImportRun(tx: Executor, orgId: string, runId: string, tagId: string): Promise<number> {
  const rows = await tx.execute(sql`
    WITH ins AS (
      INSERT INTO contact_tag (org_id, contact_id, tag_id)
      SELECT DISTINCT ${orgId}::uuid, ir.contact_id, ${tagId}::uuid
      FROM import_row ir JOIN contact c ON c.id = ir.contact_id AND c.deleted_at IS NULL
      WHERE ir.org_id = ${orgId} AND ir.import_run_id = ${runId}
        AND ir.contact_id IS NOT NULL AND ir.outcome IN ('created', 'updated', 'skipped')
      ON CONFLICT (contact_id, tag_id) DO NOTHING
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  return (rows as unknown as Array<{ n: number }>)[0]!.n;
}

/** Finds a tag by name, creating it if new. Names are matched exactly. */
export async function ensureTag(tx: Executor, orgId: string, name: string): Promise<string> {
  await tx.execute(sql`
    INSERT INTO tag (org_id, name) VALUES (${orgId}, ${name}) ON CONFLICT (org_id, name) DO NOTHING`);
  const rows = await tx.execute(sql`SELECT id FROM tag WHERE org_id = ${orgId} AND name = ${name}`);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}

/**
 * Deletes a tag. People who carried it are untagged (the `contact_tag` links cascade away); the people
 * themselves are never deleted, and campaigns that were built from the tag only lose the pointer to it.
 * Returns the tag's name and how many people carried it, or null when there is no such tag in the org.
 */
export async function deleteTag(
  tx: Executor, orgId: string, tagId: string
): Promise<{ name: string; contactCount: number } | null> {
  const rows = await tx.execute(sql`
    WITH n AS (SELECT count(*)::int AS n FROM contact_tag WHERE tag_id = ${tagId} AND org_id = ${orgId}),
         del AS (DELETE FROM tag WHERE id = ${tagId} AND org_id = ${orgId} RETURNING name)
    SELECT del.name, n.n AS "contactCount" FROM del, n`);
  return (rows as unknown as Array<{ name: string; contactCount: number }>)[0] ?? null;
}
