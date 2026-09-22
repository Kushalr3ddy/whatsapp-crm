import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import { normalisePhone, type CsvTable } from '@crm/shared';

/**
 * Turning a spreadsheet into contacts.
 *
 * The whole design is a reaction to how this goes wrong. The system this replaces hardcoded
 * one job board's column names, normalised phone numbers everywhere except on the way in, let
 * a sparse file overwrite richer data, and aborted a whole import on the first bad row
 * (docs/00-prior-art.md, M3/M4/M7/M8/M9). Every choice below is one of those, inverted.
 */

/** The transforms a mapping may name. An allowlist, never an expression — never `eval`. */
export type Transform = 'trim' | 'lower' | 'upper' | 'digits';

/** Which column feeds one field, and what to do to it on the way. */
export interface FieldMapping {
  readonly from: string;
  readonly transform?: readonly Transform[];
}

/** One identity rule: where to find it, and what kind of thing it is. Order is significant. */
export interface IdentityMapping extends FieldMapping {
  readonly kind: 'phone' | 'email' | 'external';
}

/** How a file's columns become a contact. Versioned so a stored mapping stays readable. */
export interface ImportMapping {
  readonly version: 1;
  readonly displayName?: FieldMapping;
  /**
   * Ordered. **First rule that matches wins** — deliberately not "email OR phone", which
   * cannot express which one is authoritative when they disagree (docs/07-ingestion.md).
   */
  readonly identities: readonly IdentityMapping[];
  /** For phone parsing. A file of Indian mobiles without a country code needs this. */
  readonly defaultCountry?: string;
  /** `keep` preserves the whole row on `import_row.raw` for inspection. */
  readonly unmapped?: 'keep' | 'drop';
}

/** What happened to one row. */
export interface RowOutcome {
  readonly rowNumber: number;
  readonly outcome: 'created' | 'updated' | 'skipped' | 'error';
  readonly contactId: string | null;
  readonly error: string | null;
  readonly raw: Record<string, string> | null;
}

/** What happened to a whole run. */
export interface ImportSummary {
  readonly read: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: number;
  readonly dryRun: boolean;
}

/** Rows committed per transaction. The spec's number, and small enough to resume from. */
const BATCH = 500;

/**
 * Runs one unit of work in a tenant-scoped transaction.
 *
 * Exactly the shape of `req.tenant`, and taken as an argument rather than a `Database` so this
 * keeps the property the request path relies on: the data routes hold no pool handle, and so
 * cannot query outside a transaction that has `app.org_id` set. One call per batch, not one
 * for the whole import — a fifty-thousand-row file must not hold a single transaction open.
 */
export type TenantWork = <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;

/** Applies an allowlisted transform chain. Unknown transforms are refused when validated. */
function applyTransforms(value: string, transforms: readonly Transform[] = []): string {
  let out = value;
  for (const t of transforms) {
    if (t === 'trim') out = out.trim();
    else if (t === 'lower') out = out.toLowerCase();
    else if (t === 'upper') out = out.toUpperCase();
    else if (t === 'digits') out = out.replace(/\D/g, '');
  }
  return out;
}

/** One resolved identity, ready to match against `contact_identity`. */
interface ResolvedIdentity {
  readonly kind: string;
  readonly value: string;
}

/**
 * Turns one row into the identities it claims, in rule order.
 *
 * **Phone normalisation is not optional** (M8). An unparseable number becomes a row error with
 * the original preserved, never a silently stored string — one person becoming three contacts
 * because the same number was written three ways is the exact failure this prevents.
 */
function identitiesFor(
  row: Record<string, string>, mapping: ImportMapping
): { identities: ResolvedIdentity[]; error: string | null } {
  const identities: ResolvedIdentity[] = [];

  for (const rule of mapping.identities) {
    const raw = applyTransforms(row[rule.from] ?? '', rule.transform);
    // Empty never matches anything. Enforced in the database too, by the CHECK on
    // contact_identity (M7) — a blank cell must not resolve to "the contact with no phone".
    if (raw === '') continue;

    if (rule.kind === 'phone') {
      const phone = normalisePhone(raw, mapping.defaultCountry ?? 'IN');
      if (!phone.ok) {
        return { identities, error: `${rule.from}: ${phone.message}` };
      }
      identities.push({ kind: 'phone', value: phone.value.e164 });
    } else if (rule.kind === 'email') {
      const email = raw.toLowerCase();
      if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
        return { identities, error: `${rule.from}: "${raw}" is not an email address` };
      }
      identities.push({ kind: 'email', value: email });
    } else {
      identities.push({ kind: 'external', value: raw });
    }
  }
  return { identities, error: null };
}

/**
 * Runs a mapping over a parsed file.
 *
 * **A run always completes.** A bad row is recorded and the import carries on — a single
 * unparseable phone number must never abort fifty thousand rows (M4). The only way this throws
 * is if the database itself is unreachable.
 *
 * `dryRun` does everything except write a contact, including the identity lookups, so the
 * preview is produced by the same code that would do the work rather than by a second
 * implementation that can disagree with it.
 */
export async function runImport(
  tenant: TenantWork,
  input: {
    orgId: string; importRunId: string; table: CsvTable;
    mapping: ImportMapping; dryRun: boolean;
  }
): Promise<ImportSummary> {
  const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
  const rows = input.table.rows;

  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const outcomes: RowOutcome[] = [];

    await tenant(async (tx) => {
      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = start + i + 1;
        const row = chunk[i]!;
        const outcome = await importOneRow(tx, input.orgId, rowNumber, row, input.mapping, input.dryRun);
        outcomes.push(outcome);
        counts[outcome.outcome === 'error' ? 'errors' : outcome.outcome] += 1;
      }
      await recordRows(tx, input.orgId, input.importRunId, outcomes, input.mapping);
    });
  }

  return { read: rows.length, ...counts, dryRun: input.dryRun };
}

/** Maps, resolves and (unless this is a dry run) writes one row. Never throws for bad data. */
async function importOneRow(
  tx: Transaction, orgId: string, rowNumber: number, row: Record<string, string>,
  mapping: ImportMapping, dryRun: boolean
): Promise<RowOutcome> {
  const raw = mapping.unmapped === 'drop' ? null : row;
  const { identities, error } = identitiesFor(row, mapping);

  if (error !== null) {
    return { rowNumber, outcome: 'error', contactId: null, error, raw };
  }
  if (identities.length === 0) {
    // Not an error in the file — a row with nothing to identify a person by simply cannot
    // become a contact, and saying so beats inventing one keyed on a display name.
    return {
      rowNumber, outcome: 'error', contactId: null,
      error: 'no usable identity: every identity column was empty', raw
    };
  }

  const displayName = mapping.displayName === undefined
    ? '' : applyTransforms(row[mapping.displayName.from] ?? '', mapping.displayName.transform);

  // First rule that matches an existing contact wins, in the order the mapping declared.
  let contactId: string | null = null;
  for (const identity of identities) {
    const found = await tx.execute(sql`
      SELECT contact_id AS "contactId" FROM contact_identity
      WHERE org_id = ${orgId} AND kind = ${identity.kind}
        AND value_normalized = ${identity.value} LIMIT 1`);
    const hit = (found as unknown as Array<{ contactId: string }>)[0];
    if (hit) { contactId = hit.contactId; break; }
  }

  if (dryRun) {
    return {
      rowNumber, outcome: contactId === null ? 'created' : 'updated',
      contactId, error: null, raw
    };
  }

  if (contactId === null) {
    const created = await tx.execute(sql`
      INSERT INTO contact (org_id, display_name, source)
      VALUES (${orgId}, ${displayName === '' ? identities[0]!.value : displayName}, 'import')
      RETURNING id`);
    contactId = (created as unknown as Array<{ id: string }>)[0]!.id;

    for (const [index, identity] of identities.entries()) {
      await tx.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${orgId}, ${contactId}, ${identity.kind}, ${identity.value}, ${index === 0})
        ON CONFLICT DO NOTHING`);
    }
    return { rowNumber, outcome: 'created', contactId, error: null, raw };
  }

  // An existing contact. **A sparse file must never destroy richer data** (M9), so a name is
  // filled in only where there is nothing already — never overwritten. Richer merge policies
  // are per-field and come with `contact_field_def`; this is the safe default until then.
  const touched = await tx.execute(sql`
    UPDATE contact SET display_name = ${displayName}, updated_at = now()
    WHERE id = ${contactId} AND org_id = ${orgId}
      AND ${displayName} <> ''
      AND (display_name IS NULL OR display_name = '' OR display_name = ${identities[0]!.value})
    RETURNING id`);

  // Any identity the row carried that this contact did not: additive, because learning
  // somebody's email from a second file is the point of importing it.
  for (const identity of identities) {
    await tx.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      VALUES (${orgId}, ${contactId}, ${identity.kind}, ${identity.value}, false)
      ON CONFLICT DO NOTHING`);
  }

  const changed = (touched as unknown as unknown[]).length > 0;
  return {
    rowNumber, outcome: changed ? 'updated' : 'skipped', contactId, error: null, raw
  };
}

/** Writes the ledger for one batch. Every row gets a record, including the ones that worked. */
async function recordRows(
  tx: Transaction, orgId: string, importRunId: string, outcomes: readonly RowOutcome[],
  mapping: ImportMapping
): Promise<void> {
  for (const o of outcomes) {
    await tx.execute(sql`
      INSERT INTO import_row (org_id, import_run_id, row_number, outcome, contact_id, error, raw)
      VALUES (${orgId}, ${importRunId}, ${o.rowNumber}, ${o.outcome}, ${o.contactId},
              ${o.error}, ${mapping.unmapped === 'drop' || o.raw === null
                ? null : JSON.stringify(o.raw)}::jsonb)
      ON CONFLICT (import_run_id, row_number) DO UPDATE
        SET outcome = EXCLUDED.outcome, contact_id = EXCLUDED.contact_id,
            error = EXCLUDED.error, raw = EXCLUDED.raw`);
  }
}
