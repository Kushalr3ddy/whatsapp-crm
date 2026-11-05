import { parsePhoneNumberFromString, parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js/max';
import { err, ok, type Result } from './result.js';

/** Why a phone number could not be normalised. Surfaced per row during an import. */
export type PhoneError = 'empty' | 'no_digits' | 'too_short' | 'unparseable' | 'invalid_for_country';

/** A normalised number and what kind of line it is. */
export interface NormalisedPhone {
  /** Canonical E.164 form, e.g. `+919876543210`. The only form ever stored. */
  readonly e164: string;
  /** Line type from carrier metadata; `unknown` when it cannot be determined. */
  readonly type: 'mobile' | 'fixed_line' | 'voip' | 'other' | 'unknown';
  /** False for line types that cannot receive WhatsApp — checked before a send is attempted. */
  readonly reachableOnWhatsApp: boolean;
}

/**
 * Canonicalises a phone number to E.164, or explains why it cannot be.
 *
 * This is the single normalisation boundary for the whole system. The previous system had
 * an equivalent function and simply never called it on the import path, so "+91 98765 43210",
 * "9876543210" and "919876543210" became three different people (docs/00-prior-art.md, M8).
 * Everything that accepts a phone number goes through here.
 *
 * Empty input is an error rather than an empty string, because an empty value that compares
 * equal to another empty value is exactly how the old dedup merged unrelated contacts (M7).
 *
 * Uses the `max` metadata bundle rather than the default one. The default accepts obvious
 * junk — `1111111111` and `5555555555` both pass as valid Indian numbers — and cannot tell
 * a mobile from a landline. Both matter when the input is a spreadsheet someone typed by
 * hand and the output is a WhatsApp send attempt.
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: string
): Result<NormalisedPhone, PhoneError> {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return err('empty', 'No phone number given.');

  // Strip the decorations humans and spreadsheets add. Keep a leading + and digits;
  // spaces, dashes, brackets, dots and non-breaking spaces are all noise.
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  const digitCount = cleaned.replace(/\D/g, '').length;
  if (digitCount === 0) return err('no_digits', `"${trimmed}" contains no digits.`);
  if (digitCount < 6) return err('too_short', `"${trimmed}" has too few digits to be a phone number.`);

  try {
    const parsed = parsePhoneNumberWithError(cleaned, defaultCountry.toUpperCase() as CountryCode);
    if (!parsed.isValid()) {
      return err('invalid_for_country', `"${trimmed}" is not a valid number for ${defaultCountry}.`);
    }
    const type = toLineType(parsed.getType());
    return ok({
      e164: parsed.number,
      type,
      // A landline cannot receive WhatsApp. Catching it here saves a send attempt and a
      // delivery failure.
      reachableOnWhatsApp: type !== 'fixed_line'
    });
  } catch {
    return err('unparseable', `"${trimmed}" could not be parsed as a phone number.`);
  }
}

/** Collapses libphonenumber's many line types into the few distinctions we act on. */
function toLineType(raw: string | undefined): NormalisedPhone['type'] {
  switch (raw) {
    case 'MOBILE':
    case 'FIXED_LINE_OR_MOBILE':
      return 'mobile';
    case 'FIXED_LINE':
      return 'fixed_line';
    case 'VOIP':
      return 'voip';
    case undefined:
      return 'unknown';
    default:
      return 'other';
  }
}

/**
 * True when a value is usable as an identity for matching. Guards the rule that a blank
 * value never matches anything, wherever identity resolution happens (docs/07-ingestion.md).
 */
export function isMatchableIdentity(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The ISO country (`IN`, `GB`, …) an E.164 number belongs to, or null when it cannot be told.
 * Many countries share one calling code (+1), and libphonenumber resolves those from the number
 * itself, which is why this parses rather than slicing a prefix.
 */
export function phoneCountry(e164: string): string | null {
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

/** Words a spreadsheet uses to say "nothing here" (Naukri writes `NA` in almost every optional column). */
const BLANK_MARKERS = new Set(['na', 'n/a', 'n.a.', 'nil', 'null', 'none', '-', '--', '—']);

/**
 * True when a whole cell is one of the markers a spreadsheet uses for "no value".
 *
 * Matches the **entire** cell, case-insensitively, so a name that merely contains "na" is untouched.
 * The one cost is a person whose entire name is literally "NA"; that is vanishingly rare next to
 * thousands of rows where `NA` means empty.
 */
export function isBlankMarker(value: string): boolean {
  return BLANK_MARKERS.has(value.trim().toLowerCase());
}

/**
 * Splits a phone cell that holds more than one number.
 *
 * A real recruiter export has cells like `98xxxxxxxx, +91…` (36% of one 160-row sample): a bare
 * number, then a second one. The separators are comma, semicolon, slash, pipe and line breaks.
 * Spaces and dashes are *not* separators, because they sit inside a single number.
 */
export function splitPhoneCell(raw: string): string[] {
  return raw.split(/[,;/|\n\r]+/).map((p) => p.trim()).filter((p) => p !== '');
}

/** What `normalisePhoneCell` found in one cell. */
export interface PhoneCellResult {
  /** Distinct valid numbers in the order they were written; the first is the primary one. */
  readonly numbers: readonly NormalisedPhone[];
  /** Set only when the cell had real content and none of it was a usable number. */
  readonly firstFailure: { readonly reason: PhoneError; readonly message: string } | null;
  /** Parts that looked like numbers but were not valid, when at least one other part was. */
  readonly dropped: readonly string[];
}

/**
 * Normalises every number in a cell that may hold several.
 *
 * - A part that is only a bare country code (an optional `+` and up to four digits, e.g. `+91`) is
 *   ignored, not an error: it is what a second, empty number looks like. Anything with letters, or a
 *   too-short number, still counts as a failure.
 * - A part that looks like a number but is not valid is dropped **if another part is valid**, so one
 *   good number is never lost to a bad neighbour. The original cell stays on the row ledger.
 * - If nothing is valid, the first real failure is reported, so the row fails visibly (M8).
 * - The same number written twice (`98…` and `+9198…`) is kept once.
 */
export function normalisePhoneCell(raw: string, defaultCountry: string): PhoneCellResult {
  const numbers: NormalisedPhone[] = [];
  const seen = new Set<string>();
  let firstFailure: PhoneCellResult['firstFailure'] = null;
  const dropped: string[] = [];

  for (const part of splitPhoneCell(raw)) {
    if (/^\+?\s*\d{1,4}$/.test(part)) continue;
    const parsed = normalisePhone(part, defaultCountry);
    if (!parsed.ok) {
      firstFailure ??= { reason: parsed.reason, message: parsed.message };
      dropped.push(part);
      continue;
    }
    if (seen.has(parsed.value.e164)) continue;
    seen.add(parsed.value.e164);
    numbers.push(parsed.value);
  }
  return {
    numbers, firstFailure: numbers.length > 0 ? null : firstFailure,
    dropped: numbers.length > 0 ? dropped : []
  };
}
