import { sql } from 'drizzle-orm';

/**
 * Custom fields: the fixed vocabulary an org defines for what it knows about its contacts.
 *
 * `contact.custom_fields` is a free-form JSON bag, which drifts the moment two people type
 * `City` / `city` / `town`. Definitions fix that: only defined keys can be set, a value is checked
 * against its type, and a `select` only accepts one of its options. Pure validation lives here so
 * it is tested without a database; the routes load the definitions and call it.
 */
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;
/** One of the four field types. */
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** A defined field, as the routes load it. */
export interface CustomFieldDef {
  readonly key: string;
  readonly label: string;
  readonly type: CustomFieldType;
  readonly options: readonly string[];
}

/** Keys are lower-case slugs, so they are safe as `{{key}}` and as CSV/JSON keys. */
export const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const MAX_TEXT = 500;

/** Checks one value against its definition. Returns the value to store, or an error message. */
export function checkFieldValue(
  def: CustomFieldDef, value: unknown
): { ok: true; value: string | number } | { ok: false; error: string } {
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (String(value).trim() === '' || !Number.isFinite(n)) {
        return { ok: false, error: `${def.key}: must be a number` };
      }
      return { ok: true, value: n };
    }
    case 'date': {
      const text = String(value).trim();
      const real = /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
        && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);
      return real ? { ok: true, value: text } : { ok: false, error: `${def.key}: must be a date as YYYY-MM-DD` };
    }
    case 'select': {
      const text = String(value).trim();
      return def.options.includes(text)
        ? { ok: true, value: text }
        : { ok: false, error: `${def.key}: must be one of ${def.options.join(', ')}` };
    }
    default: {
      const text = String(value).trim();
      if (text.length > MAX_TEXT) return { ok: false, error: `${def.key}: at most ${String(MAX_TEXT)} characters` };
      return { ok: true, value: text };
    }
  }
}

/**
 * Validates a set of values against the definitions. A `null` (or empty string) means "clear this
 * field". Unknown keys are refused rather than stored — that is the whole point.
 */
export function validateCustomFields(
  defs: readonly CustomFieldDef[], input: Record<string, unknown>
): { ok: true; set: Record<string, string | number>; clear: string[] } | { ok: false; errors: string[] } {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const set: Record<string, string | number> = {};
  const clear: string[] = [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const def = byKey.get(key);
    if (!def) { errors.push(`${key}: not a defined field`); continue; }
    if (value === null || value === undefined || String(value).trim() === '') { clear.push(key); continue; }
    const checked = checkFieldValue(def, value);
    if (checked.ok) set[key] = checked.value; else errors.push(checked.error);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, set, clear };
}

/** Anything that can run a query — a request's tenant transaction. */
interface Executor { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }

/** Loads an org's field definitions, in the order they were made. */
export async function loadCustomFields(tx: Executor, orgId: string): Promise<CustomFieldDef[]> {
  const rows = await tx.execute(sql`
    SELECT key, label, type, options FROM custom_field WHERE org_id = ${orgId} ORDER BY created_at`);
  return rows as unknown as CustomFieldDef[];
}
