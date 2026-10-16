import { isBlankMarker, normalisePhoneCell } from './phone.js';

/** What a column's sampled values look like. Shares are 0 to 1 of the non-blank cells sampled. */
export interface ColumnProfile {
  readonly header: string;
  /** How many non-blank cells were looked at. */
  readonly sampled: number;
  /** Share of sampled cells holding at least one valid phone number. */
  readonly phoneShare: number;
  /** Share of sampled cells that look like an email address. */
  readonly emailShare: number;
}

/** The columns the importer suggests, or null where nothing convincing was found. */
export interface ColumnSuggestions {
  readonly phone: string | null;
  readonly email: string | null;
  readonly name: string | null;
}

/** Rows looked at per column. Enough to be sure, small enough that a 50,000-row file costs nothing. */
const SAMPLE_ROWS = 200;
/** A column is only suggested as phone or email when at least this share of its values fit. */
const MIN_SHARE = 0.6;

const PHONE_HEADER = /phone|mobile|\bmob\b|\bph\b|contact\s*(no|num)|whatsapp|cell/i;
const EMAIL_HEADER = /e-?mail/i;
const NAME_HEADER = /name/i;
const EMAIL_VALUE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/** Measures what the first rows of every column look like. */
export function profileColumns(
  headers: readonly string[], rows: readonly Record<string, string>[], defaultCountry: string
): ColumnProfile[] {
  const sample = rows.slice(0, SAMPLE_ROWS);
  return headers.map((header) => {
    let sampled = 0, phones = 0, emails = 0;
    for (const row of sample) {
      const cell = (row[header] ?? '').trim();
      if (cell === '' || isBlankMarker(cell)) continue;
      sampled += 1;
      if (EMAIL_VALUE.test(cell.toLowerCase())) emails += 1;
      else if (normalisePhoneCell(cell, defaultCountry).numbers.length > 0) phones += 1;
    }
    return {
      header, sampled,
      phoneShare: sampled === 0 ? 0 : phones / sampled,
      emailShare: sampled === 0 ? 0 : emails / sampled
    };
  });
}

/**
 * Picks the phone, email and name columns by looking at the values first and the header second.
 *
 * Values decide because headers lie or are missing (`Mob`, `Ph`, `Contact Person`, a blank header):
 * the phone column is the one whose cells actually parse as phone numbers. The header name only
 * breaks a tie. A suggestion is a starting point the person can change, never a silent choice.
 * Name has no reliable value test, so it follows the header and avoids a column already taken.
 */
export function suggestColumns(profiles: readonly ColumnProfile[]): ColumnSuggestions {
  // Among columns that qualify, the one with the most matching cells wins (an "Alt" column with one
  // number must not beat the main column with a hundred), then a matching header breaks a tie.
  const best = (share: (p: ColumnProfile) => number, headerRe: RegExp): string | null => {
    const count = (p: ColumnProfile): number => Math.round(share(p) * p.sampled);
    const ranked = profiles
      .filter((p) => share(p) >= MIN_SHARE)
      .sort((a, b) => count(b) - count(a)
        || Number(headerRe.test(b.header)) - Number(headerRe.test(a.header)));
    return ranked[0]?.header ?? null;
  };
  const phone = best((p) => p.phoneShare, PHONE_HEADER);
  const email = best((p) => p.emailShare, EMAIL_HEADER);
  const name = profiles.find((p) => NAME_HEADER.test(p.header) && p.header !== phone && p.header !== email
    && p.phoneShare < MIN_SHARE && p.emailShare < MIN_SHARE)?.header ?? null;
  return { phone, email, name };
}
