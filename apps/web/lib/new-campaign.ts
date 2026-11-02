/**
 * The pure parts of the New campaign screen: how a message reads as WhatsApp shows it, which fill-ins it uses and who lacks them, how
 * the months and files are grouped, and how long a send takes. No React, no network, so each is tested alone.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put inside HTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/**
 * WhatsApp's own markers as HTML: `*bold*`, `_italic_`, `~strike~` and ```` ```mono``` ````. A marker only counts when it hugs the words
 * and sits at a word edge, the way WhatsApp reads it. The input is escaped first, so nothing a person or a contact typed can add markup.
 */
export function whatsappHtml(text: string): string {
  let s = esc(text);
  s = s.replace(/```([\s\S]+?)```/g, '<code>$1</code>');
  s = s.replace(/(^|[\s(])\*([^\s*](?:[^*]*[^\s*])?)\*(?=$|[\s.,!?)])/g, '$1<b>$2</b>');
  s = s.replace(/(^|[\s(])_([^\s_](?:[^_]*[^\s_])?)_(?=$|[\s.,!?)])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[\s(])~([^\s~](?:[^~]*[^\s~])?)~(?=$|[\s.,!?)])/g, '$1<s>$2</s>');
  return s;
}

/** A `{{key}}` or `{{contact.key}}` in a message: the same shape the sender fills in. */
const FILL_IN = /\{\{\s*(?:contact\.)?(\w+)\s*\}\}/gi;

/** The fill-in keys a message uses, each once, lower case. */
export function fillInKeysUsed(body: string): string[] {
  return [...new Set([...body.matchAll(FILL_IN)].map((m) => m[1]!.toLowerCase()))];
}

/** One fill-in of the chosen people: what it is called in their file, how it reads, and how many have it. */
export interface Column { key: string; label: string; type: string; have: number }

/** Edit distance between two short strings (insert, delete or change one letter = 1). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** The known key closest to a mistyped one, if it is within two edits ("duedate" for `due_date`). */
export function didYouMean(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  const squash = (k: string): string => k.toLowerCase().replace(/_/g, '');
  for (const candidate of known) {
    const d = Math.min(editDistance(key.toLowerCase(), candidate.toLowerCase()), editDistance(squash(key), squash(candidate)));
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}

/** What the message needs from the chosen people's columns. */
export interface FillInCheck {
  /** Keys that are not a column of these people, each with the closest real one. */
  readonly unknown: ReadonlyArray<{ key: string; suggestion: string | null; everyoneLacks: boolean }>;
  /** The used column the most people lack, with how many lack it. Null when everybody has every used column. */
  readonly mostMissing: { key: string; label: string; missing: number; have: number } | null;
  /** People with no name saved: they read "there", nothing to decide. */
  readonly noName: number;
}

/**
 * Reads the message against the people's columns. A missing name is not a problem (it reads "there"); any other used column some people
 * lack is the thing the person is asked about; a key that is not a column at all is an error to fix.
 */
export function checkFillIns(body: string, columns: readonly Column[], total: number): FillInCheck {
  const known = columns.map((c) => c.key);
  const unknown: Array<{ key: string; suggestion: string | null; everyoneLacks: boolean }> = [];
  let mostMissing: FillInCheck['mostMissing'] = null;
  let noName = 0;
  for (const key of fillInKeysUsed(body)) {
    const col = columns.find((c) => c.key === key);
    if (col === undefined) { unknown.push({ key, suggestion: didYouMean(key, known), everyoneLacks: false }); continue; }
    if (col.have === 0 && total > 0 && key !== 'name' && key !== 'first_name') { unknown.push({ key, suggestion: null, everyoneLacks: true }); continue; }
    const missing = Math.max(0, total - col.have);
    if (key === 'name' || key === 'first_name') { noName = Math.max(noName, missing); continue; }
    if (missing > 0 && (mostMissing === null || missing >= mostMissing.missing)) mostMissing = { key, label: col.label, missing, have: col.have };
  }
  return { unknown, mostMissing, noName };
}

/** A person to preview the message as. */
export interface PreviewPerson { name: string | null; values: Readonly<Record<string, string>> }

/** What to do for a person with a blank fill-in: leave them out, use a word, or send anyway. */
export type BlankChoice = 'skip' | 'word' | 'any';

/** The word used in place of a blank when that is chosen. */
export const BLANK_WORD = 'soon';

/**
 * The message as one person receives it, as HTML: `{a|b|c}` picks the option for this person (the Nth, round the list), `{{name}}` is
 * their name ("there" when they have none), another fill-in is their value or a red "blank" tag, and a key that is not a column is a red
 * "key?" tag. With no person to preview as, the fill-ins stay as typed.
 */
export function previewHtml(body: string, person: PreviewPerson | null, columns: readonly Column[], index: number, choice: BlankChoice): string {
  const spun = body.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_m, g: string) => {
    const options = g.split('|');
    return options[index % options.length] ?? options[0]!;
  });
  const marks: string[] = [];
  const mark = (html: string): string => { marks.push(html); return `${String(marks.length - 1)}`; };
  const filled = spun.replace(FILL_IN, (whole, k: string) => {
    if (person === null) return whole;
    const key = k.toLowerCase();
    if (!columns.some((c) => c.key === key)) return mark(`<span class="nc-miss">${esc(key)}?</span>`);
    const value = person.values[key];
    if (value !== undefined && value !== '') return mark(esc(value));
    if (key === 'name' || key === 'first_name') return 'there';
    if (choice === 'word') return mark(esc(BLANK_WORD));
    return mark('<span class="nc-miss">blank</span>');
  });
  return whatsappHtml(filled).replace(/(\d+)/g, (_m, n: string) => marks[Number(n)] ?? '');
}

/** The greeting at the start of a message, which wording variations replace. */
const GREETING = /^(\{[^{}]*\|[^{}]*\}|Hii|Hi|Hey|Hello|Dear)(?=[\s,!])/;

/** Puts `{Hi|Hey|Hello}` where the greeting is (or at the start when there is none). Fewer than two options changes nothing. */
export function applyVariations(body: string, options: readonly string[]): string {
  const clean = options.map((o) => o.trim()).filter((o) => o !== '');
  if (clean.length < 2) return body;
  const group = `{${clean.join('|')}}`;
  return GREETING.test(body) ? body.replace(GREETING, group) : `${group} ${body}`;
}

/** Turns the greeting group back into its first word. */
export function removeVariations(body: string): string {
  return body.replace(/^\{([^{}|]+)\|[^{}]*\}/, '$1');
}

/** The text box after wrapping the selection (or the word "text") in a marker. */
export function wrapSelection(value: string, start: number, end: number, marker: string): { value: string; start: number; end: number } {
  const selected = value.slice(start, end) || 'text';
  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + marker.length, end: start + marker.length + selected.length
  };
}

/** Puts a fill-in at the cursor; when the person typed `{` to open the list, that brace is replaced. */
export function insertFillIn(value: string, start: number, end: number, key: string, braceTyped: boolean): { value: string; cursor: number } {
  const from = braceTyped && value.charAt(start - 1) === '{' ? start - 1 : start;
  const token = `{{${key}}}`;
  return { value: value.slice(0, from) + token + value.slice(end), cursor: from + token.length };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Oct" for an ISO time. */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate())} ${MONTHS[d.getMonth()]!}`;
}

/** "2 Nov" style date used in "last campaign: Diwali offer, 2 Nov". */
export const lastUsedDay = shortDay;

/** A file as the picker lists it. */
export interface FilePick { id: string; name: string; at: string; people: number }

/** The months that have files, newest first, each with how many files ("Oct 2026 · 2 files"). */
export function monthOptions(files: readonly FilePick[]): Array<{ value: string; label: string; count: number }> {
  const seen = new Map<string, number>();
  for (const f of files) {
    const d = new Date(f.at);
    const key = `${String(d.getFullYear())}-${String(d.getMonth()).padStart(2, '0')}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, count]) => {
    const [y, m] = key.split('-');
    return { value: key, label: `${MONTHS[Number(m)]!} ${y!} · ${String(count)} ${count === 1 ? 'file' : 'files'}`, count };
  });
}

/** The month key of a file, the same shape `monthOptions` uses. */
export function monthOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${String(d.getMonth()).padStart(2, '0')}`;
}

/** The heading over a month's files: "Oct 2026". */
export function monthHeading(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m)]!} ${y!}`;
}

/** Quiet hours as the sender holds them. */
export interface QuietHours { enabled: boolean; start: string; end: string; timeZone: string }

/** Minutes since local midnight, and the local calendar day, of a moment in a time zone. */
function localClock(at: Date, timeZone: string): { minutes: number; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** "22:00" as minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** True when this minute of the day falls in quiet hours (the window may cross midnight). */
export function inQuiet(minutes: number, q: QuietHours): boolean {
  if (!q.enabled) return false;
  const s = toMinutes(q.start);
  const e = toMinutes(q.end);
  return s === e ? false : s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** What the page says about how long a send takes and when it ends. */
export interface FinishEstimate { duration: string; finish: string; people: number }

/**
 * How long `people` messages take, with the gap between two drawn between `gapMinMs` and `gapMaxMs` (on average halfway), starting now and
 * pausing for quiet hours, which push the rest to the morning. Counted in whole minutes.
 */
export function estimateFinish(
  people: number, now: Date, gap: { minMs: number; maxMs: number }, quiet: QuietHours
): FinishEstimate {
  const avgMs = (gap.minMs + gap.maxMs) / 2;
  const workMinutes = Math.max(1, Math.round((people * avgMs) / 60_000));
  const hours = Math.floor(workMinutes / 60);
  const duration = hours > 0 ? `About ${String(hours)} h ${String(workMinutes % 60)} min` : `About ${String(workMinutes)} min`;

  let cursor = now.getTime();
  let left = workMinutes;
  let pausedForQuiet = false;
  for (let guard = 0; left > 0 && guard < 60 * 24 * 60; guard++) {
    const c = localClock(new Date(cursor), quiet.timeZone);
    if (inQuiet(c.minutes, quiet)) { pausedForQuiet = true; cursor += 60_000; continue; }
    left -= 1;
    cursor += 60_000;
  }
  const end = new Date(cursor);
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: quiet.timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(end).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
  const sameDay = localClock(now, quiet.timeZone).day === localClock(end, quiet.timeZone).day;
  let finish: string;
  if (sameDay) finish = `Starting now, it finishes around ${time}`;
  else {
    const tomorrow = localClock(new Date(now.getTime() + 24 * 3_600_000), quiet.timeZone).day === localClock(end, quiet.timeZone).day;
    const day = tomorrow ? 'tomorrow' : `on ${new Intl.DateTimeFormat('en-GB', { timeZone: quiet.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(end)}`;
    finish = `Starting now, it ${pausedForQuiet ? 'runs into quiet hours and finishes' : 'finishes'} about ${time} ${day}`;
  }
  return { duration, finish, people };
}

/** The quiet-hours window as the Send from step says it: "22:00 to 08:00". */
export function quietHoursText(q: QuietHours): string {
  return q.enabled ? `${q.start} to ${q.end}` : 'off';
}
