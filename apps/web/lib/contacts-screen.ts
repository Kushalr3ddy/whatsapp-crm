import type { ContactSources, FieldRule, PeopleView, PersonRow, SegmentDefinition } from './crm';

/**
 * The Contacts screen's own rules, kept apart from the component so they can be tested: what the filter
 * controls mean in the stored filter, what a chip says and how it comes off, how the address holds the view,
 * and how the table's cells read.
 */

/** Rows per page the screen offers. */
export const PAGE_SIZES = [50, 100, 250] as const;

/** The two ways of choosing which people to look at besides "everyone". */
export type SourceKind = 'all' | 'file' | 'tag' | 'list';

/** What is picked on the left. `id` is empty for everyone. */
export interface Source { kind: SourceKind; id: string }

/** Everything that decides which people the table shows. Held in the address so a refresh or a shared link keeps it. */
export interface ViewState {
  source: Source;
  q: string;
  filter: SegmentDefinition;
  page: number;
  size: number;
  sort: 'name_asc' | 'name_desc';
}

/** Nothing picked on the left: everyone. */
export const EVERYONE: Source = { kind: 'all', id: '' };

/** The view with nothing picked. */
export function emptyView(): ViewState {
  return { source: EVERYONE, q: '', filter: {}, page: 0, size: 50, sort: 'name_asc' };
}

// ---- What the filter controls mean in the stored filter ----

/** The condition words a column rule offers. */
export const RULE_OPS: ReadonlyArray<readonly [FieldRule['op'], string]> = [
  ['is', 'is'], ['isnot', 'is not'], ['has', 'contains'], ['blank', 'is blank'], ['filled', 'is not blank']
];

/** A rule filters only when it has what it needs to compare with. */
export function ruleActive(r: FieldRule): boolean {
  return r.op === 'blank' || r.op === 'filled' || (r.value ?? '').trim() !== '';
}

/** "City is “Pune”". */
export function ruleText(r: FieldRule, label: (key: string) => string): string {
  const op = RULE_OPS.find((o) => o[0] === r.op)?.[1] ?? r.op;
  return `${label(r.key)} ${op}${r.op === 'blank' || r.op === 'filled' ? '' : ` “${(r.value ?? '').trim()}”`}`;
}

/** Last active: any, within 7 / 30 / 90 days, or longer ago than 90. */
export type ActiveChoice = 'any' | '7' | '30' | '90' | 'older';
/** Which "last active" button the filter has pressed. */
export function activeChoice(f: SegmentDefinition): ActiveChoice {
  if (f.activeOlderThanDays !== undefined) return 'older';
  const d = f.activeWithinDays;
  return d === 7 ? '7' : d === 30 ? '30' : d === 90 ? '90' : 'any';
}
/** The filter with "last active" set to a choice. */
export function withActive(f: SegmentDefinition, v: ActiveChoice): SegmentDefinition {
  const { activeWithinDays: _a, activeOlderThanDays: _o, ...rest } = f;
  if (v === 'any') return rest;
  return v === 'older' ? { ...rest, activeOlderThanDays: 90 } : { ...rest, activeWithinDays: Number(v) };
}

/** Last messaged: any, in the last 30 days, or not in 30 days (never counts). */
export type LastMessagedChoice = 'any' | 'recent' | 'stale';
/** Which "last messaged" button the filter has pressed. */
export function lastMessagedChoice(f: SegmentDefinition): LastMessagedChoice {
  return f.lastContactedWithinDays !== undefined ? 'recent' : f.notContactedWithinDays !== undefined ? 'stale' : 'any';
}
/** The filter with "last messaged" set to a choice. */
export function withLastMessaged(f: SegmentDefinition, v: LastMessagedChoice): SegmentDefinition {
  const { lastContactedWithinDays: _l, notContactedWithinDays: _n, ...rest } = f;
  return v === 'recent' ? { ...rest, lastContactedWithinDays: 30 }
    : v === 'stale' ? { ...rest, notContactedWithinDays: 30 } : rest;
}

/** Imported in the last: any, 30 or 90 days. */
export type ImportedChoice = 'any' | '30' | '90';
/** Which "imported in the last" button the filter has pressed. */
export function importedChoice(f: SegmentDefinition): ImportedChoice {
  return f.importedWithinDays === 30 ? '30' : f.importedWithinDays === 90 ? '90' : 'any';
}
/** The filter with "imported in the last" set to a choice. */
export function withImported(f: SegmentDefinition, v: ImportedChoice): SegmentDefinition {
  const { importedWithinDays: _i, ...rest } = f;
  return v === 'any' ? rest : { ...rest, importedWithinDays: Number(v) };
}

/** Sets or clears one simple key. */
export function withKey<K extends keyof SegmentDefinition>(
  f: SegmentDefinition, key: K, value: SegmentDefinition[K] | undefined
): SegmentDefinition {
  const next = { ...f };
  if (value === undefined || value === false) delete next[key];
  else next[key] = value;
  return next;
}

/** The filter as the server should read it: no empty values, no rule without anything to compare. */
export function cleanFilter(f: SegmentDefinition): SegmentDefinition {
  const out: SegmentDefinition = { ...f };
  if (out.fieldRules !== undefined) {
    const rules = out.fieldRules.filter(ruleActive).map((r) => (
      r.op === 'blank' || r.op === 'filled' ? { key: r.key, op: r.op } : { key: r.key, op: r.op, value: (r.value ?? '').trim() }
    ));
    if (rules.length === 0) delete out.fieldRules;
    else out.fieldRules = rules;
  }
  if (out.tagIds !== undefined && out.tagIds.length === 0) delete out.tagIds;
  return out;
}

/** One removable chip under the toolbar. */
export interface Chip { key: string; label: string }

/** What the chips can name: campaigns by id and saved columns by key. */
export interface ChipNames { campaigns: Array<{ id: string; name: string }>; fields: Array<{ key: string; label: string }> }

const ACTIVE_TEXT: Record<ActiveChoice, string> = {
  any: '', '7': 'last 7 days', '30': 'last 30 days', '90': 'last 90 days', older: 'longer ago'
};

/** The chips for a search and a filter, in the order the Filters groups list them. */
export function chipsFor(q: string, f: SegmentDefinition, names: ChipNames): Chip[] {
  const out: Chip[] = [];
  if (q.trim() !== '') out.push({ key: 'q', label: `Search: ${q.trim()}` });
  if (f.replied !== undefined) out.push({ key: 'replied', label: `Replied: ${f.replied === 'ever' ? 'yes' : 'never'}` });
  if (activeChoice(f) !== 'any') out.push({ key: 'active', label: `Last active: ${ACTIVE_TEXT[activeChoice(f)]}` });
  if (f.waitingForUs === true) out.push({ key: 'waiting', label: 'Waiting for us' });
  if (f.campaigns !== undefined) out.push({ key: 'campaigns', label: `Campaigns: ${f.campaigns === 'some' ? 'messaged' : 'never messaged'}` });
  if (f.campaignId !== undefined) {
    out.push({ key: 'campaignId', label: `In campaign: ${names.campaigns.find((c) => c.id === f.campaignId)?.name ?? 'a campaign'}` });
  }
  if (lastMessagedChoice(f) !== 'any') {
    out.push({ key: 'lastm', label: `Last messaged: ${lastMessagedChoice(f) === 'recent' ? 'last 30 days' : 'not in 30 days'}` });
  }
  if (f.dnc !== undefined) out.push({ key: 'dnc', label: `Can be messaged: ${f.dnc === 'exclude' ? 'yes' : 'do not contact'}` });
  if (f.whatsapp !== undefined) {
    out.push({ key: 'whatsapp', label: `WhatsApp: ${({ yes: 'on it', no: 'not on it', unchecked: 'not checked' })[f.whatsapp]}` });
  }
  if (f.email !== undefined) out.push({ key: 'email', label: `Email: ${f.email === 'yes' ? 'has one' : 'missing'}` });
  if (f.importedWithinDays !== undefined) out.push({ key: 'imported', label: `Imported: last ${String(f.importedWithinDays)} days` });
  const label = (key: string): string => names.fields.find((x) => x.key === key)?.label ?? key;
  (f.fieldRules ?? []).forEach((r, i) => { if (ruleActive(r)) out.push({ key: `rule:${String(i)}`, label: ruleText(r, label) }); });
  return out;
}

/** The filter and search with one chip taken off. */
export function withoutChip(q: string, f: SegmentDefinition, key: string): { q: string; filter: SegmentDefinition } {
  if (key === 'q') return { q: '', filter: f };
  if (key.startsWith('rule:')) {
    const at = Number(key.slice(5));
    const rules = (f.fieldRules ?? []).filter((_, i) => i !== at);
    return { q, filter: withKey(f, 'fieldRules', rules.length === 0 ? undefined : rules) };
  }
  switch (key) {
    case 'replied': return { q, filter: withKey(f, 'replied', undefined) };
    case 'active': return { q, filter: withActive(f, 'any') };
    case 'waiting': return { q, filter: withKey(f, 'waitingForUs', undefined) };
    case 'campaigns': return { q, filter: withKey(f, 'campaigns', undefined) };
    case 'campaignId': return { q, filter: withKey(f, 'campaignId', undefined) };
    case 'lastm': return { q, filter: withLastMessaged(f, 'any') };
    case 'dnc': return { q, filter: withKey(f, 'dnc', undefined) };
    case 'whatsapp': return { q, filter: withKey(f, 'whatsapp', undefined) };
    case 'email': return { q, filter: withKey(f, 'email', undefined) };
    case 'imported': return { q, filter: withImported(f, 'any') };
    default: return { q, filter: f };
  }
}

/** How many filters are on (the search is counted apart). */
export function filterCount(f: SegmentDefinition): number {
  return chipsFor('', f, { campaigns: [], fields: [] }).length;
}

// ---- The address ----

/** The query string that holds a view: only what is not the default. */
export function viewToSearch(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.source.kind === 'file') p.set('file', v.source.id);
  if (v.source.kind === 'tag') p.set('tag', v.source.id);
  if (v.source.kind === 'list') p.set('list', v.source.id);
  if (v.q.trim() !== '') p.set('q', v.q.trim());
  // A saved list is its filter, so the address only names it.
  const f = cleanFilter(v.filter);
  if (v.source.kind !== 'list' && Object.keys(f).length > 0) p.set('f', JSON.stringify(f));
  if (v.page > 0) p.set('page', String(v.page + 1));
  if (v.size !== 50) p.set('size', String(v.size));
  if (v.sort !== 'name_asc') p.set('sort', v.sort);
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

const isId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/**
 * Reads a view back from the address. Anything unreadable is left out rather than failing: a stale link opens the
 * screen with less narrowed, never an error page. A file, tag or list that is no longer there is ignored.
 */
export function viewFromSearch(
  sp: Record<string, string | string[] | undefined>, sources: ContactSources | null
): ViewState {
  const one = (k: string): string | undefined => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const v = emptyView();
  const file = one('file'), tag = one('tag'), list = one('list');
  // A file's own tag is the file: the Import page links to its people by that tag.
  const byTag = isId(tag) ? sources?.files.find((x) => x.tagId === tag) : undefined;
  if (isId(file) && (sources === null || sources.files.some((x) => x.id === file))) v.source = { kind: 'file', id: file };
  else if (byTag !== undefined) v.source = { kind: 'file', id: byTag.id };
  else if (isId(tag) && (sources === null || sources.tags.some((x) => x.id === tag))) v.source = { kind: 'tag', id: tag };
  else if (isId(list)) {
    const found = sources?.lists.find((x) => x.id === list);
    if (found !== undefined) { v.source = { kind: 'list', id: list }; v.filter = found.definition; }
  }
  v.q = (one('q') ?? '').slice(0, 100);
  const f = one('f');
  if (f !== undefined && v.source.kind !== 'list') {
    try {
      const parsed: unknown = JSON.parse(f);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) v.filter = parsed as SegmentDefinition;
    } catch { /* a link someone cut short: ignore the filter */ }
  }
  const page = Number(one('page'));
  if (Number.isInteger(page) && page > 1) v.page = page - 1;
  const size = Number(one('size'));
  if ((PAGE_SIZES as readonly number[]).includes(size)) v.size = size;
  if (one('sort') === 'name_desc') v.sort = 'name_desc';
  return v;
}

/** The request for the people a view shows: the list's own filter is the filter, so a list needs no special case. */
export function viewToRequest(v: ViewState, withPaging = true): PeopleView {
  const out: PeopleView = { sort: v.sort };
  if (v.q.trim() !== '') out.q = v.q.trim();
  if (v.source.kind === 'file') out.file = v.source.id;
  if (v.source.kind === 'tag') out.tag = v.source.id;
  const f = cleanFilter(v.filter);
  if (Object.keys(f).length > 0) out.filter = f;
  if (withPaging) { out.limit = v.size; out.offset = v.page * v.size; }
  return out;
}

/** The query string for a view; empty values are left out. */
export function peopleParams(v: PeopleView): string {
  const p = new URLSearchParams();
  if (v.q !== undefined && v.q.trim() !== '') p.set('q', v.q.trim());
  if (v.file) p.set('file', v.file);
  if (v.tag) p.set('tag', v.tag);
  if (v.filter !== undefined && Object.keys(v.filter).length > 0) p.set('filter', JSON.stringify(v.filter));
  if (v.sort) p.set('sort', v.sort);
  if (v.limit !== undefined) p.set('limit', String(v.limit));
  if (v.offset) p.set('offset', String(v.offset));
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

// ---- The table's cells ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Oct", or "28 Oct 2025" when it is not this year. In the install's time zone so server and browser agree. */
export function formatDay(iso: string, timeZone: string, now: Date = new Date()): string {
  const parts = (x: Date): { day: number; month: number; year: number } => {
    const p = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).formatToParts(x);
    const n = (type: string): number => Number(p.find((q) => q.type === type)?.value ?? 0);
    return { day: n('day'), month: n('month'), year: n('year') };
  };
  const d = parts(new Date(iso));
  const base = `${String(d.day)} ${MONTHS[d.month - 1] ?? ''}`;
  return d.year === parts(now).year ? base : `${base} ${String(d.year)}`;
}

/** The phone and email a row shows: the first of each kind (the primary phone comes first). */
export function phoneOf(p: PersonRow): string | null {
  return p.identities.find((i) => i.kind === 'phone')?.value ?? null;
}
/** The first email address of a row, or null. */
export function emailOf(p: PersonRow): string | null {
  return p.identities.find((i) => i.kind === 'email')?.value ?? null;
}

/** "Priya Sharma" becomes PS; a number-only name uses its first two characters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** The tags cell: the file's first, two shown, "+n" for the rest. */
export function tagsText(p: PersonRow): string {
  const names = p.tags.map((t) => t.name);
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${String(names.length - 2)}` : '');
}

/** A count with thousands separators, in a fixed locale so the server and the browser agree. */
export function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n);
}

/** "Showing 1–50 of 530 people". */
export function showingText(page: number, size: number, total: number): string {
  if (total === 0) return '0 people';
  const a = page * size + 1;
  const b = Math.min(total, (page + 1) * size);
  return `Showing ${fmt(a)}–${fmt(b)} of ${fmt(total)} ${total === 1 ? 'person' : 'people'}`;
}

/** How many pages there are (at least one). */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The words under the heading for what is picked. */
export function subheading(source: Source, s: ContactSources | null, day: (iso: string) => string): string {
  if (source.kind === 'file') {
    const f = s?.files.find((x) => x.id === source.id);
    const name = f?.filename ?? 'this file';
    return `People from ${name}${f === undefined ? '' : `, imported ${day(f.importedAt)}`}. They all carry the tag “${f?.tagName ?? name}”.`;
  }
  if (source.kind === 'tag') return `People you tagged “${s?.tags.find((x) => x.id === source.id)?.name ?? 'this tag'}”.`;
  if (source.kind === 'list') return `People who match your list “${s?.lists.find((x) => x.id === source.id)?.name ?? 'this list'}”.`;
  return 'Everyone you can message, from all your imported files.';
}

/** The label on the phone's one "Source" button. */
export function sourceLabel(source: Source, s: ContactSources | null): string {
  if (source.kind === 'file') return `Source: ${s?.files.find((x) => x.id === source.id)?.filename ?? 'a file'}`;
  if (source.kind === 'tag') return `Source: tag “${s?.tags.find((x) => x.id === source.id)?.name ?? ''}”`;
  if (source.kind === 'list') return `Source: list “${s?.lists.find((x) => x.id === source.id)?.name ?? ''}”`;
  return 'Source: All people';
}

/** What the confirm dialog says before a tag is deleted. */
export function deleteTagText(name: string, count: number): { title: string; body: string } {
  return {
    title: `Delete tag “${name}”?`,
    body: `${count === 0 ? 'Nobody has it. ' : `It comes off ${String(count)} ${count === 1 ? 'person' : 'people'}. `}The people stay in your contacts. This cannot be undone.`
  };
}

/** What the toast says after a tag was added. */
export function addedText(tag: string, picked: number, changed: number): string {
  const who = `${String(picked)} ${picked === 1 ? 'person' : 'people'}`;
  const already = picked - changed;
  return `Added “${tag}” to ${who}${already > 0 ? ` (${String(already)} already had it)` : ''}.`;
}
