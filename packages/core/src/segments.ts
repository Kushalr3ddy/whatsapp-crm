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
 *     id, a day count, a column name or a typed value cannot carry SQL into the query however
 *     malformed the stored definition is. (A column rule's key is bound too: `custom_fields ->> $key`.)
 *
 * So even a hand-tampered `definition` row can filter wrongly but can never inject. The API also
 * validates the shape with zod for a clean rejection, but safety does not depend on that.
 *
 * Deliberately small — a CRM, not a query language. Criteria are AND-combined. As a campaign audience
 * `do_not_contact` and soft-deleted contacts are always excluded (`buildSegmentPredicate`); the Contacts
 * screen shows those people too, so it uses the criteria alone (`segmentCriteria`).
 */

/** How a column rule compares a contact's saved value with what was typed. */
export type FieldRuleOp = 'is' | 'isnot' | 'has' | 'blank' | 'filled';

/** One rule on a column of the person's saved details (`custom_fields`), for example City is Pune. */
export interface FieldRule {
  /** The saved column's key. Bound as a parameter, never part of the SQL text. */
  readonly key: string;
  readonly op: FieldRuleOp;
  /** What to compare with. Not used by `blank` / `filled`; a rule that needs one and has none is ignored. */
  readonly value?: string | undefined;
}

/** The allowlisted filter a dynamic segment stores. Every field optional; absent means "don't filter". */
export interface SegmentDefinition {
  /** The contact must carry ALL of these tags. */
  readonly tagIds?: readonly string[] | undefined;
  /** `ever` — has sent at least one inbound message; `never` — has sent none. */
  readonly replied?: 'ever' | 'never' | undefined;
  /** The contact was last messaged (outbound) within this many days. */
  readonly lastContactedWithinDays?: number | undefined;
  /** Nobody on our side has messaged the contact within this many days (never messaged counts). */
  readonly notContactedWithinDays?: number | undefined;
  /** They last wrote to us within this many days. */
  readonly activeWithinDays?: number | undefined;
  /** They wrote to us before, but not within this many days. */
  readonly activeOlderThanDays?: number | undefined;
  /** In a chat where the last message is theirs (a resolved chat still counts). */
  readonly waitingForUs?: boolean | undefined;
  /** `some` — has been in a campaign; `never` — has not. */
  readonly campaigns?: 'some' | 'never' | undefined;
  /** Has been in this campaign. */
  readonly campaignId?: string | undefined;
  /** `only` — the do-not-contact people alone; `exclude` — everyone else. */
  readonly dnc?: 'only' | 'exclude' | undefined;
  /** What WhatsApp last said about their number: `yes` on it, `no` not on it, `unchecked` never asked. */
  readonly whatsapp?: 'yes' | 'no' | 'unchecked' | undefined;
  /** Has an email address (`yes`) or none (`no`). */
  readonly email?: 'yes' | 'no' | undefined;
  /** A file touched them within this many days. */
  readonly importedWithinDays?: number | undefined;
  /** Rules on the person's saved columns. */
  readonly fieldRules?: readonly FieldRule[] | undefined;
}

/** A campaign recipient who was (or will be) messaged — not one who was skipped or failed. */
const IN_CAMPAIGN = sql`cr.status IN ('pending', 'queued', 'sent')`;

/** One column rule as SQL over a contact aliased `c`, or null when the rule is incomplete and filters nothing. */
function fieldRuleClause(rule: FieldRule): SQL | null {
  const saved = sql`btrim(coalesce(c.custom_fields ->> ${rule.key}::text, ''))`;
  const typed = (rule.value ?? '').trim();
  switch (rule.op) {
    case 'blank': return sql`${saved} = ''`;
    case 'filled': return sql`${saved} <> ''`;
    case 'is': return typed === '' ? null : sql`lower(${saved}) = lower(${typed}::text)`;
    case 'isnot': return typed === '' ? null : sql`lower(${saved}) <> lower(${typed}::text)`;
    case 'has': return typed === '' ? null : sql`strpos(lower(${saved}), lower(${typed}::text)) > 0`;
    default: return null;
  }
}

/** A positive whole number of days, or null when the definition holds anything else. */
function days(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The definition's criteria over a contact aliased `c`, as separate clauses to AND together — without the
 * "never a removed or do-not-contact person" rule a campaign audience adds. `orgId` scopes every subquery
 * explicitly, on top of the row-level security the surrounding query already runs under.
 */
export function segmentCriteria(def: SegmentDefinition, orgId: string): SQL[] {
  const clauses: SQL[] = [];

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

  const recent = days(def.lastContactedWithinDays);
  if (recent !== null) {
    clauses.push(sql`EXISTS (SELECT 1 FROM conversation v JOIN message m ON m.conversation_id = v.id
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND m.direction = 'outbound'
        AND m.sent_at IS NOT NULL
        AND m.sent_at > now() - make_interval(days => ${recent}))`);
  }

  const quiet = days(def.notContactedWithinDays);
  if (quiet !== null) {
    clauses.push(sql`NOT EXISTS (SELECT 1 FROM conversation v JOIN message m ON m.conversation_id = v.id
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND m.direction = 'outbound'
        AND m.sent_at IS NOT NULL
        AND m.sent_at > now() - make_interval(days => ${quiet}))`);
  }

  const active = days(def.activeWithinDays);
  if (active !== null) {
    clauses.push(sql`c.last_inbound_at IS NOT NULL
      AND c.last_inbound_at > now() - make_interval(days => ${active})`);
  }
  const older = days(def.activeOlderThanDays);
  if (older !== null) {
    clauses.push(sql`c.last_inbound_at IS NOT NULL
      AND c.last_inbound_at <= now() - make_interval(days => ${older})`);
  }

  if (def.waitingForUs === true) {
    clauses.push(sql`EXISTS (SELECT 1 FROM conversation v
      WHERE v.contact_id = c.id AND v.org_id = ${orgId} AND v.last_inbound_at IS NOT NULL
        AND (v.last_outbound_at IS NULL OR v.last_inbound_at > v.last_outbound_at))`);
  }

  if (def.campaigns === 'some') {
    clauses.push(sql`EXISTS (SELECT 1 FROM campaign_recipient cr
      WHERE cr.contact_id = c.id AND cr.org_id = ${orgId} AND ${IN_CAMPAIGN})`);
  } else if (def.campaigns === 'never') {
    clauses.push(sql`NOT EXISTS (SELECT 1 FROM campaign_recipient cr
      WHERE cr.contact_id = c.id AND cr.org_id = ${orgId} AND ${IN_CAMPAIGN})`);
  }
  if (def.campaignId !== undefined) {
    clauses.push(sql`EXISTS (SELECT 1 FROM campaign_recipient cr
      WHERE cr.contact_id = c.id AND cr.org_id = ${orgId} AND cr.campaign_id = ${def.campaignId}
        AND ${IN_CAMPAIGN})`);
  }

  if (def.dnc === 'only') clauses.push(sql`c.do_not_contact = true`);
  else if (def.dnc === 'exclude') clauses.push(sql`c.do_not_contact = false`);

  if (def.whatsapp === 'yes') {
    clauses.push(sql`EXISTS (SELECT 1 FROM contact_identity wi WHERE wi.contact_id = c.id
      AND wi.org_id = ${orgId} AND wi.kind = 'phone' AND wi.wa_registered = true)`);
  } else if (def.whatsapp === 'no') {
    clauses.push(sql`EXISTS (SELECT 1 FROM contact_identity wi WHERE wi.contact_id = c.id
        AND wi.org_id = ${orgId} AND wi.kind = 'phone' AND wi.wa_registered = false)
      AND NOT EXISTS (SELECT 1 FROM contact_identity wi WHERE wi.contact_id = c.id
        AND wi.org_id = ${orgId} AND wi.kind = 'phone' AND wi.wa_registered = true)`);
  } else if (def.whatsapp === 'unchecked') {
    clauses.push(sql`NOT EXISTS (SELECT 1 FROM contact_identity wi WHERE wi.contact_id = c.id
      AND wi.org_id = ${orgId} AND wi.kind = 'phone' AND wi.wa_registered IS NOT NULL)`);
  }

  if (def.email === 'yes') {
    clauses.push(sql`EXISTS (SELECT 1 FROM contact_identity ei
      WHERE ei.contact_id = c.id AND ei.org_id = ${orgId} AND ei.kind = 'email')`);
  } else if (def.email === 'no') {
    clauses.push(sql`NOT EXISTS (SELECT 1 FROM contact_identity ei
      WHERE ei.contact_id = c.id AND ei.org_id = ${orgId} AND ei.kind = 'email')`);
  }

  const imported = days(def.importedWithinDays);
  if (imported !== null) {
    clauses.push(sql`EXISTS (SELECT 1 FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
      WHERE ir.contact_id = c.id AND ir.org_id = ${orgId}
        AND r.created_at > now() - make_interval(days => ${imported}))`);
  }

  for (const rule of def.fieldRules ?? []) {
    const clause = fieldRuleClause(rule);
    if (clause !== null) clauses.push(clause);
  }

  return clauses;
}

/**
 * Builds the segment's SQL predicate over a contact aliased `c`, as one bound fragment.
 *
 * The base clauses (`deleted_at IS NULL`, `do_not_contact = false`) are always present, so a segment
 * used as an audience can never target a removed or un-messageable person.
 */
export function buildSegmentPredicate(def: SegmentDefinition, orgId: string): SQL {
  return sql.join(
    [sql`c.deleted_at IS NULL`, sql`c.do_not_contact = false`, ...segmentCriteria(def, orgId)],
    sql` AND `
  );
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

/**
 * Counts the people a saved list shows on the Contacts screen: its criteria only, do-not-contact people
 * included (they are listed there, marked). A campaign that uses the list still leaves them out.
 */
export async function countSegmentCriteria(
  db: Database | Transaction, orgId: string, def: SegmentDefinition
): Promise<number> {
  const criteria = segmentCriteria(def, orgId);
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM contact c
    WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL
      ${criteria.length === 0 ? sql`` : sql`AND ${sql.join(criteria, sql` AND `)}`}`);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}
