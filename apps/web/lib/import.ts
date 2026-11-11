import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { ImportProblems, ImportUpload } from './crm';
import { DEFAULT_COUNTRY, dialCodes } from './dial-codes';

/**
 * The logic behind the Import screen (/import), kept apart from the screen so it can be tested without a browser: which
 * columns a file's name and numbers are in, what the check shows, how skipped rows are grouped, and what a download holds.
 */

/** Where the person's name comes from: one column, a first and a last column joined, or nowhere. */
export type NameChoice =
  | { kind: 'column'; column: string }
  | { kind: 'joined'; first: string; last: string }
  | { kind: 'none' };

/** The columns a file is read with. Every other column is kept as it is. */
export interface ColumnChoice {
  /** Every column that holds a number, in the order they are tried. */
  phones: string[];
  name: NameChoice;
  /** Still used to match people who are already in your contacts. */
  email: string | null;
  /** The country for numbers without a country code, as a two-letter code (`IN`). */
  country: string;
}

/** What reading a file's columns found. */
export type ColumnReading =
  | { kind: 'ready'; choice: ColumnChoice }
  /** More than one column holds numbers: the person says which to message before the check is run. */
  | { kind: 'pick'; choice: ColumnChoice; candidates: string[] }
  /** Nothing in the file looks like a mobile number. */
  | { kind: 'no-phone'; headers: string[] };

/** A column is only called a phone column when at least this share of its filled cells hold a number (the server's own bar). */
const MIN_PHONE_SHARE = 0.6;

const PHONE_HEADER = /phone|mobile|\bmob\b|\bph\b|contact\s*(no|num)|whatsapp|cell/i;
const FIRST_HEADER = /^first.?name$|^given.?name$/i;
const LAST_HEADER = /^last.?name$|^sur.?name$|^family.?name$/i;
const EMAIL_HEADER = /e-?mail/i;
const NAME_HEADER = /name/i;

const guess = (headers: readonly string[], pattern: RegExp): string | null => headers.find((h) => pattern.test(h)) ?? null;

/**
 * Reads the columns of a freshly uploaded file.
 *
 * The server judged the columns from their values (`suggestions`, `columns`); the header's wording is only the fallback. A file
 * with two columns of numbers is not guessed at: the person picks, because messaging the wrong one reaches the wrong phone.
 */
export function readColumns(upload: ImportUpload, country: string = DEFAULT_COUNTRY): ColumnReading {
  const { headers } = upload;
  const suggested = upload.suggestions;

  const qualifying = (upload.columns ?? [])
    .filter((c) => c.sampled > 0 && c.phoneShare >= MIN_PHONE_SHARE)
    .map((c) => c.header);
  // A file whose numbers are mostly unreadable still has a column the header calls the phone: use it, the check will say what is wrong.
  const fallback = suggested?.phone ?? guess(headers, PHONE_HEADER);
  const phones = qualifying.length > 0 ? qualifying : fallback === null ? [] : [fallback];
  if (phones.length === 0) return { kind: 'no-phone', headers };

  const first = guess(headers, FIRST_HEADER);
  const last = guess(headers, LAST_HEADER);
  const nameColumn = suggested?.name ?? guess(headers, NAME_HEADER);
  const name: NameChoice = first !== null && last !== null ? { kind: 'joined', first, last }
    : nameColumn !== null && !phones.includes(nameColumn) ? { kind: 'column', column: nameColumn } : { kind: 'none' };

  const email = suggested?.email ?? guess(headers, EMAIL_HEADER);
  const choice: ColumnChoice = { phones, name, email: email !== null && !phones.includes(email) ? email : null, country };
  return phones.length > 1 ? { kind: 'pick', choice, candidates: phones } : { kind: 'ready', choice };
}

/** One way of choosing which number column to message: a single column, or all the candidates together. */
export interface PhoneOption { id: string; label: string; phones: string[]; examples: string }

/**
 * The choices for "Which one should we message?": each column that holds numbers, then all of them together when there are
 * several. A column counts when most of its cells are numbers (the server's bar), when its header says phone, or when a
 * fifth of it looks like numbers, so a file the server misread can still be put right. The column in use is always listed.
 */
export function phoneOptions(upload: ImportUpload, choice: ColumnChoice): PhoneOption[] {
  const profile = new Map((upload.columns ?? []).map((c) => [c.header, c]));
  const listed = upload.headers.filter((h) => {
    const p = profile.get(h);
    return choice.phones.includes(h) || PHONE_HEADER.test(h) || (p !== undefined && p.sampled > 0 && p.phoneShare >= 0.2);
  }).slice(0, 6);
  const single: PhoneOption[] = listed.map((h) => ({ id: h, label: h, phones: [h], examples: exampleValues(upload.sample, h) }));
  if (listed.length < 2) return single;
  const both: PhoneOption = {
    id: ' all', label: bothLabel(listed.length), phones: listed,
    examples: `${listed[0] ?? ''} first; ${listed.slice(1).join(' or ')} when it is empty or not a mobile number`
  };
  return [...single, both];
}

/** The id of the option that matches the columns in use. */
export function phoneOptionId(options: readonly PhoneOption[], phones: readonly string[]): string {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  return options.find((o) => same(o.phones, phones))?.id ?? options[0]?.id ?? '';
}

/** The columns of the file that are not the name, the numbers or the email: kept on every person as they are. */
export function otherColumns(headers: readonly string[], choice: ColumnChoice): string[] {
  const used = new Set<string>(choice.phones);
  if (choice.email !== null) used.add(choice.email);
  if (choice.name.kind === 'column') used.add(choice.name.column);
  if (choice.name.kind === 'joined') { used.add(choice.name.first); used.add(choice.name.last); }
  return headers.filter((h) => !used.has(h));
}

/** The label the choice list gives to using several number columns at once. */
export function bothLabel(count: number): string {
  return count === 2 ? 'Both' : 'All of them';
}

/** "+1 202 555 0101 · +1 202 555 0102 · (empty)": up to three example values from the first rows of a column. */
export function exampleValues(sample: ReadonlyArray<Record<string, string>>, column: string): string {
  return sample.slice(0, 3).map((row) => {
    const v = (row[column] ?? '').trim();
    return v === '' ? '(empty)' : v;
  }).join(' · ');
}

/** One phone cell of the first people, as the server read it. */
export interface NumberExample { raw: string; numbers: string[]; dropped: string[]; problem: string | null }

/** One piece of how a cell is shown: a number that will be saved, a part that will not, the reason nothing could be, or nothing. */
export interface ExamplePart { kind: 'number' | 'dropped' | 'problem' | 'empty'; text: string }

/** The pieces of an example cell, in the order they are shown. */
export function exampleParts(e: NumberExample): ExamplePart[] {
  const parts: ExamplePart[] = [
    ...e.numbers.map((n): ExamplePart => ({ kind: 'number', text: formatNumber(n) })),
    ...e.dropped.map((d): ExamplePart => ({ kind: 'dropped', text: d }))
  ];
  if (parts.length === 0 && e.problem !== null) return [{ kind: 'problem', text: e.problem }];
  return parts.length === 0 ? [{ kind: 'empty', text: '(empty)' }] : parts;
}

/** The countries a number without a code can be read as, India first because it is the default. */
export function countryOptions(): Array<{ code: string; label: string }> {
  const all = dialCodes().map((d) => ({ code: d.code as string, label: `${d.name} (+${d.dial})` }));
  const home = all.find((c) => c.code === DEFAULT_COUNTRY);
  return home === undefined ? all : [home, ...all.filter((c) => c.code !== DEFAULT_COUNTRY)];
}

/** "Drivers Pune.csv" → "Drivers-Pune": the tag everyone in a file gets unless it is changed. */
export function tagFromFile(fileName: string): string {
  const tokens = fileName.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter((t) => t !== '');
  // An export's file name often carries a full date and time (`…_20260622211807_160`): too long to type, and the same for no one.
  const kept = tokens.filter((t) => !/^(19|20)\d{12}$/.test(t));
  return (kept.length > 0 ? kept : tokens).join('-').slice(0, 60);
}

/** Why the tag cannot be used yet, or null when it can. An import never goes without a tag: it is how these people are found later. */
export function tagProblem(tag: string): string | null {
  return tag.trim() === '' ? 'Give the tag a name before you import: every person in this file gets it, and it is how you find them later.' : null;
}

/** What to tell the person about the tag they typed: missing, new, or already there. */
export function tagNote(tag: string, existing: readonly string[]): string {
  const problem = tagProblem(tag);
  if (problem !== null) return problem;
  const name = tag.trim().toLowerCase();
  return existing.some((t) => t.trim().toLowerCase() === name)
    ? 'This tag already exists. Everyone in this file is added to it, next to the people who have it.'
    : 'New tag: it is created when you import. Everyone in this file gets it, so you can find and message them later.';
}

/** Why a row was left out, in the words the check uses. */
export type SkipReason = 'no_number' | 'bad_number' | 'bad_email';

/** The words for each reason (a title for the group, and the sentence that goes with a single row). */
export const SKIP_TEXT: Record<SkipReason, string> = {
  no_number: 'No mobile number in the row',
  bad_number: 'The number can’t be read as a mobile number',
  bad_email: 'The email address can’t be read'
};

/** Sorts the server's error text into a reason. The server does not send a code yet, so this reads the sentence it wrote. */
export function skipReason(error: string): SkipReason {
  if (/no usable identity/i.test(error)) return 'no_number';
  if (/is not an email address/i.test(error)) return 'bad_email';
  return 'bad_number';
}

/** The sheet's row number: the ledger counts people rows, and the sheet's first row is the column names. */
export const sheetRow = (rowNumber: number): number => rowNumber + 1;

/** One row that was left out, as the screen lists it. */
export interface SkippedRow { row: number; name: string; value: string; raw: Record<string, string> | null; reason: SkipReason }

/** A group of skipped rows with the same reason. `count` can be larger than `rows.length` when the server lists only some. */
export interface SkipGroup { reason: SkipReason; title: string; count: number; rows: SkippedRow[] }

/** The name a row shows: the name column, the two joined, or blank. */
function nameOf(raw: Record<string, string> | null, name: NameChoice): string {
  if (raw === null || name.kind === 'none') return '';
  if (name.kind === 'column') return (raw[name.column] ?? '').trim();
  return [raw[name.first] ?? '', raw[name.last] ?? ''].map((p) => p.trim()).filter((p) => p !== '').join(' ');
}

/** What the person typed in the number columns of a row, for "Row 14, Sunil Patil (—)". */
function numberOf(raw: Record<string, string> | null, phones: readonly string[]): string {
  if (raw === null) return '';
  return phones.map((p) => (raw[p] ?? '').trim()).filter((v) => v !== '').join(', ');
}

/**
 * Groups the rows the server left out by reason, biggest group first.
 *
 * `total` is how many rows the dry run left out; the server lists only some of them, and the groups say so rather than
 * counting less than the truth: the rows it did not list are in `unlisted`.
 */
export function groupSkipped(
  problems: ImportProblems, choice: ColumnChoice, total: number
): { groups: SkipGroup[]; unlisted: number } {
  const byReason = new Map<SkipReason, SkippedRow[]>();
  for (const e of problems.errors) {
    const reason = skipReason(e.error);
    const rows = byReason.get(reason) ?? [];
    rows.push({ row: sheetRow(e.rowNumber), name: nameOf(e.raw, choice.name), value: numberOf(e.raw, choice.phones), raw: e.raw, reason });
    byReason.set(reason, rows);
  }
  const groups = [...byReason.entries()]
    .map(([reason, rows]) => ({ reason, title: SKIP_TEXT[reason], count: rows.length, rows }))
    .sort((a, b) => b.count - a.count);
  return { groups, unlisted: Math.max(0, total - problems.errors.length) };
}

/** "Row 14, Sunil Patil (—)": how a skipped row is named in the list. */
export function skippedLine(r: SkippedRow): string {
  const who = r.name === '' ? '' : `, ${r.name}`;
  return `Row ${String(r.row)}${who} (${r.value === '' ? '—' : r.value})`;
}

/** Quotes a value for CSV: wrapped in quotes, with inner quotes doubled. */
const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** A CSV of the skipped rows with the sheet's own columns and the reason, to fix in Excel and import again. */
export function skippedCsv(rows: readonly SkippedRow[], headers: readonly string[]): string {
  const lines = [['Sheet row', ...headers, 'Why it was skipped'].map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([String(r.row), ...headers.map((h) => r.raw?.[h] ?? ''), SKIP_TEXT[r.reason]].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** What the check shows, worked out from the dry run. */
export interface CheckCounts {
  /** People who will be in your contacts after the import: new plus already there. */
  ready: number;
  fresh: number;
  /** Already in your contacts: matched by number or email. */
  existing: number;
  skipped: number;
}

/** The dry run's counts, as the check tiles. A person already in your contacts is a row the run updated or found nothing new for. */
export function checkCounts(summary: { created: number; updated: number; skipped: number; errors: number }): CheckCounts {
  const existing = summary.updated + summary.skipped;
  return { ready: summary.created + existing, fresh: summary.created, existing, skipped: summary.errors };
}

/**
 * What a finished import reports. The people are counted by the tag when there is one: that is each person once, even when a file
 * lists the same person on two rows (the rows would count them twice). Without a tag the rows are all there is to count.
 */
export function doneCounts(
  summary: { created: number; updated: number; skipped: number; errors: number; tagged?: number }
): CheckCounts {
  const rows = checkCounts(summary);
  const ready = summary.tagged ?? rows.ready;
  return { ready, fresh: summary.created, existing: Math.max(0, ready - summary.created), skipped: summary.errors };
}

/** "3 Nov 2026" in the reader's own order of day and month. */
export function dayText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "+12025550100" → "+1 202 555 0100"; anything that cannot be read is shown as it was given. */
export function formatNumber(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** "two", "three" … for a small count of columns, digits after that. */
export function columnCount(n: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n);
}

/** "1 person" / "464 people". */
export function peopleText(n: number): string {
  return `${String(n)} ${n === 1 ? 'person' : 'people'}`;
}

/** True for a cell that is empty or only says "no value" (NA, N/A, nil, a dash): the same test the importer and the counts use. */
export function isGap(value: string): boolean {
  const v = value.trim();
  return v === '' || /^(na|n\/a|n\.a\.|nil|null|none|-|--|—)$/i.test(v);
}

/** What a detail is to the import, so the ones that matter most are listed first. */
export type DetailRole = 'name' | 'phone' | 'email' | 'other';

/** One column that some people leave empty. */
export interface MissingDetail { header: string; blank: number; role: DetailRole }

/** The role a column plays in how the file is read. */
function roleOf(header: string, choice: ColumnChoice): DetailRole {
  if (choice.phones.includes(header)) return 'phone';
  if (choice.email === header) return 'email';
  if (choice.name.kind === 'column' && choice.name.column === header) return 'name';
  if (choice.name.kind === 'joined' && (choice.name.first === header || choice.name.last === header)) return 'name';
  return 'other';
}

/** The columns somebody leaves empty, the name, the number and the email first, then the rest with the most gaps first. */
export function missingDetails(upload: ImportUpload, choice: ColumnChoice): MissingDetail[] {
  const rank: Record<DetailRole, number> = { name: 0, phone: 1, email: 2, other: 3 };
  return (upload.columnFill ?? [])
    .filter((c) => c.blank > 0)
    .map((c) => ({ header: c.header, blank: c.blank, role: roleOf(c.header, choice) }))
    .sort((a, b) => rank[a.role] - rank[b.role] || b.blank - a.blank || a.header.localeCompare(b.header));
}

/** One person from the file, as the screen shows them. */
export interface PersonPeek {
  row: number;
  name: string;
  /** Every detail they have, the name, number and email first. */
  fields: Array<{ header: string; value: string }>;
  /** The columns they leave empty. */
  missing: string[];
}

/** Turns the drawn rows into people to show: the details they have, and the ones they lack. */
export function peekPeople(upload: ImportUpload, choice: ColumnChoice): PersonPeek[] {
  const rank: Record<DetailRole, number> = { name: 0, phone: 1, email: 2, other: 3 };
  return (upload.peek ?? []).map((p) => {
    const filled: Array<{ header: string; value: string }> = [];
    const missing: string[] = [];
    for (const header of upload.headers) {
      const value = (p.values[header] ?? '').trim();
      // The name is the card's title, so it is not listed again.
      if (roleOf(header, choice) === 'name') { if (value === '') missing.push(header); continue; }
      if (isGap(value)) missing.push(header);
      else filled.push({ header, value });
    }
    // A stable sort keeps the file's own order inside each group.
    filled.sort((a, b) => rank[roleOf(a.header, choice)] - rank[roleOf(b.header, choice)]);
    return { row: p.row, name: nameOf(p.values, choice.name), fields: filled, missing };
  });
}

/** The name of the file of the people the table shows, with the details they lack in it so several downloads do not collide. */
export function gapFileName(missing: readonly string[]): string {
  const [first] = missing;
  if (first === undefined) return 'people-from-sheet.csv';
  const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const more = missing.length > 1 ? `-and-${String(missing.length - 1)}-more` : '';
  return `people-missing-${slug === '' ? 'detail' : slug}${more}.csv`;
}

/** The sheet's columns in the order the table shows them: the name, the number and the email first, then the rest as the sheet has them. */
export function sheetColumns(headers: readonly string[], choice: ColumnChoice): string[] {
  const rank: Record<DetailRole, number> = { name: 0, phone: 1, email: 2, other: 3 };
  return headers.map((h, i) => ({ h, i, r: rank[roleOf(h, choice)] })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.h);
}

/**
 * The page numbers to show under a table: the first and last page and the ones beside the current page, with "…" where pages are
 * skipped (a gap of exactly one page shows that page, since "…" for one page saves nothing). Pages count from 1.
 */
export function pageList(current: number, pages: number): Array<number | '…'> {
  if (pages < 1) return [];
  const at = Math.min(pages, Math.max(1, current));
  const keep = [...new Set([1, pages, at - 1, at, at + 1].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  keep.forEach((p, i) => {
    const before = keep[i - 1];
    if (before !== undefined) {
      if (p - before === 2) out.push(before + 1);
      else if (p - before > 2) out.push('…');
    }
    out.push(p);
  });
  return out;
}
