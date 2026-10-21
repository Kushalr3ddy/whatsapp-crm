import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';
import { isBlankMarker, normalisePhoneCell, type CsvTable } from '@crm/shared';

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
  /** Build the name from two columns, a first and a last name, instead of reading one name column (see `joinName`). */
  readonly nameParts?: { readonly first: string; readonly last: string };
  /**
   * Ordered. **First rule that matches wins** — deliberately not "email OR phone", which
   * cannot express which one is authoritative when they disagree (docs/07-ingestion.md).
   */
  readonly identities: readonly IdentityMapping[];
  /** For phone parsing. A file of Indian mobiles without a country code needs this. */
  readonly defaultCountry?: string;
  /** `keep` preserves the whole row on `import_row.raw` for inspection. */
  readonly unmapped?: 'keep' | 'drop';
  /**
   * Columns to keep **on each contact** as custom fields, so they show on Contacts and can be searched.
   * A field is created for a column that has none yet (text); a value never overwrites one already there.
   */
  readonly fields?: ReadonlyArray<{ readonly from: string }>;
}

/** What happened to one row. */
export interface RowOutcome {
  readonly rowNumber: number;
  readonly outcome: 'created' | 'updated' | 'skipped' | 'error';
  readonly contactId: string | null;
  readonly error: string | null;
  /** A row that imported but lost something (a bad second number). Kept in the ledger's text column. */
  readonly note?: string | null;
  readonly raw: Record<string, string> | null;
}

/** What happened to a whole run. */
export interface ImportSummary {
  readonly read: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: number;
  /** Rows that imported but dropped something, e.g. a second phone number that was not valid. */
  readonly warnings: number;
  readonly dryRun: boolean;
}

/** The longest value kept in a custom field; the same limit `checkFieldValue` applies to text. */
const MAX_FIELD_VALUE = 500;

/** A column kept as a custom field: where it comes from and the key and label it is stored under. */
export interface KeptField { readonly from: string; readonly key: string; readonly label: string }

/**
 * Turns the columns a person chose to keep into field keys (`Total Experience` → `total_experience`).
 *
 * Keys are lower-case slugs (`FIELD_KEY`), starting with a letter and at most 40 long; two headers that
 * slug to the same key get `_2`, `_3`… so neither is lost.
 */
export function keptFieldsFor(mapping: ImportMapping): KeptField[] {
  const taken = new Set<string>();
  const out: KeptField[] = [];
  for (const { from } of mapping.fields ?? []) {
    let base = from.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(base)) base = `f_${base}`;
    base = base.slice(0, 36).replace(/_+$/, '') || 'field';
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${String(n)}`;
    taken.add(key);
    out.push({ from, key, label: from.trim().slice(0, 80) || key });
  }
  return out;
}

/** One kept field's cleaned value, or null when the cell is empty or only a "no value" marker. */
function fieldValue(row: Record<string, string>, from: string): string | null {
  const v = (row[from] ?? '').trim();
  return v === '' || isBlankMarker(v) ? null : v.slice(0, MAX_FIELD_VALUE);
}

/**
 * Joins a first and a last name without changing either.
 *
 * Names are never shortened or reformatted: `Anita` + `Sharma` is `Anita Sharma`, with the sheet's own spelling and
 * case. Only when the first name is already a single letter (already an initial) is it joined with a dot and no
 * space: `a` + `sharma` is `a.sharma`. If only one of the two is filled in, that one is the name.
 */
export function joinName(first: string, last: string): string {
  const f = isBlankMarker(first.trim()) ? '' : first.trim();
  const l = isBlankMarker(last.trim()) ? '' : last.trim();
  if (f === '') return l;
  if (l === '') return f;
  const initial = f.replace(/\.$/, '');
  return initial.length === 1 ? `${initial}.${l}` : `${f} ${l}`;
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

/** What a usable email address looks like: something@domain.tld, no spaces. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/** Splits an email cell that holds more than one address (comma, semicolon, slash, pipe, line break or space). */
function splitEmailCell(raw: string): string[] {
  return raw.toLowerCase().split(/[,;/|\s]+/).map((e) => e.trim()).filter((e) => e !== '');
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
): { identities: ResolvedIdentity[]; error: string | null; note: string | null } {
  const identities: ResolvedIdentity[] = [];
  const notes: string[] = [];

  for (const rule of mapping.identities) {
    const raw = applyTransforms(row[rule.from] ?? '', rule.transform);
    // Empty never matches anything. Enforced in the database too, by the CHECK on
    // contact_identity (M7) — a blank cell must not resolve to "the contact with no phone".
    // `NA`, `N/A`, `-` and friends mean "no value" in exported sheets, never a value.
    if (raw === '' || isBlankMarker(raw)) continue;

    if (rule.kind === 'phone') {
      // One cell may hold several numbers (`98…, +91…`); each valid one becomes an identity on the
      // same contact, in the order written, so the first is the primary.
      const cell = normalisePhoneCell(raw, mapping.defaultCountry ?? 'IN');
      if (cell.numbers.length === 0) {
        // Nothing but a stray country code is an empty cell, not a bad number.
        if (cell.firstFailure === null) continue;
        return { identities, error: `${rule.from}: ${cell.firstFailure.message}`, note: null };
      }
      if (cell.dropped.length > 0) {
        notes.push(`${rule.from}: not imported, not a valid number: ${cell.dropped.join(', ')}`);
      }
      for (const number of cell.numbers) {
        if (!identities.some((i) => i.kind === 'phone' && i.value === number.e164)) {
          identities.push({ kind: 'phone', value: number.e164 });
        }
      }
    } else if (rule.kind === 'email') {
      // One cell may hold several addresses (`a@x.in, a@x.in`). Use the first that is valid; the row
      // only fails when none of them is.
      const candidates = splitEmailCell(raw);
      const index = candidates.findIndex((c) => EMAIL_SHAPE.test(c));
      if (index === -1) {
        return { identities, error: `${rule.from}: "${raw}" is not an email address`, note: null };
      }
      if (index > 0) notes.push(`${rule.from}: first address "${candidates[0] ?? ''}" is not valid, used "${candidates[index] ?? ''}"`);
      identities.push({ kind: 'email', value: candidates[index] ?? '' });
    } else {
      identities.push({ kind: 'external', value: raw });
    }
  }
  return { identities, error: null, note: notes.length === 0 ? null : notes.join('; ') };
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
  let warnings = 0;
  const rows = input.table.rows;
  const kept = input.dryRun ? [] : await ensureKeptFields(tenant, input.orgId, keptFieldsFor(input.mapping));

  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const outcomes: RowOutcome[] = [];

    await tenant(async (tx) => {
      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = start + i + 1;
        const row = chunk[i]!;
        const outcome = await importOneRow(tx, input.orgId, rowNumber, row, input.mapping, input.dryRun, kept);
        outcomes.push(outcome);
        counts[outcome.outcome === 'error' ? 'errors' : outcome.outcome] += 1;
        if (outcome.outcome !== 'error' && outcome.note) warnings += 1;
      }
      await recordRows(tx, input.orgId, input.importRunId, outcomes, input.mapping);
    });
  }

  return { read: rows.length, ...counts, warnings, dryRun: input.dryRun };
}

/**
 * Makes sure each kept column has a text field definition, and returns the ones that can be written to.
 * A column whose key already exists as another type (number, date, select) is left out rather than
 * guessed at: its values would need that type's checks.
 */
async function ensureKeptFields(tenant: TenantWork, orgId: string, wanted: readonly KeptField[]): Promise<KeptField[]> {
  if (wanted.length === 0) return [];
  return tenant(async (tx) => {
    for (const f of wanted) {
      await tx.execute(sql`
        INSERT INTO custom_field (org_id, key, label, type, options)
        VALUES (${orgId}, ${f.key}, ${f.label}, 'text', ARRAY[]::text[])
        ON CONFLICT (org_id, key) DO NOTHING`);
    }
    const defs = await tx.execute(sql`
      SELECT key FROM custom_field
      WHERE org_id = ${orgId} AND type = 'text' AND key = ANY(${sql`ARRAY[${sql.join(wanted.map((f) => sql`${f.key}`), sql`, `)}]::text[]`})`);
    const usable = new Set((defs as unknown as Array<{ key: string }>).map((d) => d.key));
    return wanted.filter((f) => usable.has(f.key));
  });
}

/** Maps, resolves and (unless this is a dry run) writes one row. Never throws for bad data. */
async function importOneRow(
  tx: Transaction, orgId: string, rowNumber: number, row: Record<string, string>,
  mapping: ImportMapping, dryRun: boolean, kept: readonly KeptField[]
): Promise<RowOutcome> {
  const raw = mapping.unmapped === 'drop' ? null : row;
  const { identities, error, note } = identitiesFor(row, mapping);

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

  const rawName = mapping.nameParts !== undefined
    ? joinName(row[mapping.nameParts.first] ?? '', row[mapping.nameParts.last] ?? '')
    : mapping.displayName === undefined
      ? '' : applyTransforms(row[mapping.displayName.from] ?? '', mapping.displayName.transform);
  const displayName = isBlankMarker(rawName) ? '' : rawName;

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
      contactId, error: null, note, raw
    };
  }

  const keptValues: Record<string, string> = {};
  for (const f of kept) {
    const v = fieldValue(row, f.from);
    if (v !== null) keptValues[f.key] = v;
  }

  if (contactId === null) {
    const created = await tx.execute(sql`
      INSERT INTO contact (org_id, display_name, source, custom_fields)
      VALUES (${orgId}, ${displayName === '' ? identities[0]!.value : displayName}, 'import',
              ${JSON.stringify(keptValues)}::jsonb)
      RETURNING id`);
    contactId = (created as unknown as Array<{ id: string }>)[0]!.id;

    for (const [index, identity] of identities.entries()) {
      await tx.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${orgId}, ${contactId}, ${identity.kind}, ${identity.value}, ${index === 0})
        ON CONFLICT DO NOTHING`);
    }
    return { rowNumber, outcome: 'created', contactId, error: null, note, raw };
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

  // Kept columns fill gaps only: `new || existing` leaves any value already on the contact as it was.
  let fieldsAdded = false;
  if (Object.keys(keptValues).length > 0) {
    const filled = await tx.execute(sql`
      UPDATE contact SET custom_fields = ${JSON.stringify(keptValues)}::jsonb || custom_fields, updated_at = now()
      WHERE id = ${contactId} AND org_id = ${orgId} AND NOT (custom_fields @> ${JSON.stringify(keptValues)}::jsonb)
      RETURNING id`);
    fieldsAdded = (filled as unknown as unknown[]).length > 0;
  }

  const changed = (touched as unknown as unknown[]).length > 0 || fieldsAdded;
  return {
    rowNumber, outcome: changed ? 'updated' : 'skipped', contactId, error: null, note, raw
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
              ${o.error ?? o.note ?? null}, ${mapping.unmapped === 'drop' || o.raw === null
                ? null : JSON.stringify(o.raw)}::jsonb)
      ON CONFLICT (import_run_id, row_number) DO UPDATE
        SET outcome = EXCLUDED.outcome, contact_id = EXCLUDED.contact_id,
            error = EXCLUDED.error, raw = EXCLUDED.raw`);
  }
}
