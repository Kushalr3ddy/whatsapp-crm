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
      // A landline cannot receive WhatsApp. Catching it here saves a send attempt, a
      // delivery failure, and the delivery-ratio penalty that failure would cost the
      // sender's health score (docs/08-antiban.md).
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
