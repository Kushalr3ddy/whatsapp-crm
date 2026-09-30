import { sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '@crm/db';

/**
 * Dynamic segments — the criteria-based audience filter (docs/21-deferred.md D-28).
 *
 * A segment stores a small **allowlisted** definition; this module turns it into a SQL predicate.
 * That translation is the one genuinely risky seam in the whole product — JSON becoming SQL — and it
 * is closed **by construction**, not by sanitising:
 *
 *   - Only known keys emit anything. An unknown key contributes no SQL at all.
 *   - Every value is a **bound parameter** through the `sql` tag, never string-concatenated. A tag
 *     id or a day count cannot carry SQL into the query however malformed the stored definition is.
 *
 * So even a hand-tampered `definition` row can filter wrongly but can never inject. The API also
 * validates the shape with zod for a clean rejection, but safety does not depend on that.
 *
 * Deliberately small — a CRM, not a query language. Criteria are AND-combined; `do_not_contact` and
 * soft-deleted contacts are always excluded; an empty definition matches everyone otherwise eligible.
 */

/** The allowlisted filter a dynamic segment stores. Every field optional; absent means "don't filter". */
export interface SegmentDefinition {
  /** The contact must carry ALL of these tags. */
  readonly tagIds?: readonly string[] | undefined;
  /** `ever` — has sent at least one inbound message; `never` — has sent none. */
  readonly replied?: 'ever' | 'never' | undefined;
  /** The contact was last messaged (outbound) within this many days. */
  readonly lastContactedWithinDays?: number | undefined;
}

/**
 * Builds the segment's SQL predicate over a contact aliased `c`, as one bound fragment.
 *
 * The base clauses (`deleted_at IS NULL`, `do_not_contact = false`) are always present, so a segment
 * can never target a removed or un-messageable person. `orgId` scopes every subquery explicitly, on
 * top of the row-level security the surrounding query already runs under.
 */
export function buildSegmentPredicate(def: SegmentDefinition, orgId: string): SQL {
  const clauses: SQL[] = [sql`c.deleted_at IS NULL`, sql`c.do_not_contact = false`];

  if (def.tagIds !== undefined) {
    for (const tagId of def.tagIds) {
      clauses.push(sql`EXISTS (SELECT 1 FROM contact_tag ct
        WHERE ct.contact_id = c.id AND ct.org_id = ${orgId} AND ct.tag_id = ${tagId})`);
    }
  }

  if (def.replied === 'ever') {
    clauses.push(sql`EXISTS (SELECT 1 FROM conversation v JOIN message m ON m.conversation_id = v.id
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND m.direction = 'inbound')`);
  } else if (def.replied === 'never') {
    clauses.push(sql`NOT EXISTS (SELECT 1 FROM conversation v JOIN message m ON m.conversation_id = v.id
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND m.direction = 'inbound')`);
  }

  if (typeof def.lastContactedWithinDays === 'number' && def.lastContactedWithinDays > 0) {
    clauses.push(sql`EXISTS (SELECT 1 FROM conversation v JOIN message m ON m.conversation_id = v.id
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND m.direction = 'outbound'
        AND m.sent_at IS NOT NULL
        AND m.sent_at > now() - make_interval(days => ${def.lastContactedWithinDays}))`);
  }

  return sql.join(clauses, sql` AND `);
}

/** Counts the contacts a segment matches right now, in the given org. */
export async function countSegmentMatches(
  db: Database | Transaction, orgId: string, def: SegmentDefinition
): Promise<number> {
  const predicate = buildSegmentPredicate(def, orgId);
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM contact c WHERE c.org_id = ${orgId} AND (${predicate})`);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}
