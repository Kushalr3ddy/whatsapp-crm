import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSegments, listTags, previewSegmentCount, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Segment, Tag, SegmentDefinition } from '@/lib/crm';
import { createSegmentAction, deleteSegmentAction } from './actions';
import { SubmitButton } from '../contacts/submit-button';

/** Rendered per request — the builder's live count comes from the query string. */
export const dynamic = 'force-dynamic';

/** Turns a create error code into a sentence. */
function errorMessage(code: string): string {
  switch (code) {
    case 'missing': return 'Give the segment a name.';
    case 'SEGMENT_EXISTS': return 'A segment with that name already exists.';
    default: return 'Could not save the segment. Try again.';
  }
}

/** A human summary of a segment's criteria, for the list. */
function describe(def: SegmentDefinition, tags: Tag[]): string {
  const parts: string[] = [];
  if (def.tagIds !== undefined && def.tagIds.length > 0) {
    const names = def.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? 'a tag');
    parts.push(`tagged ${names.join(' & ')}`);
  }
  if (def.replied === 'ever') parts.push('has replied');
  if (def.replied === 'never') parts.push('never replied');
  if (def.lastContactedWithinDays !== undefined) {
    parts.push(`contacted ≤ ${String(def.lastContactedWithinDays)}d`);
  }
  return parts.length === 0 ? 'everyone (no filter)' : parts.join(' · ');
}

/**
 * Segments (D-28) — saved, criteria-based audiences that re-evaluate every time they are used. Build
 * one from a tag, reply status and last-contacted recency (AND-combined; do-not-contact always
 * excluded), preview how many it matches now, save it, then target it from a campaign. Unlike a tag
 * (a fixed list), a segment tracks a rule — "everyone tagged pune who replied" stays current on its
 * own. All server-rendered: "Preview count" reloads with the count; "Save" is a server action.
 */
export default async function SegmentsPage(
  { searchParams }: {
    searchParams: Promise<{ error?: string; tagId?: string; replied?: string; days?: string }>;
  }
) {
  const sp = await searchParams;
  const tagId = typeof sp.tagId === 'string' ? sp.tagId : '';
  const replied = sp.replied === 'ever' || sp.replied === 'never' ? sp.replied : '';
  const days = typeof sp.days === 'string' ? sp.days : '';

  let segments: Segment[] = [];
  let tags: Tag[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [segments, tags] = await Promise.all([listSegments(), listTags()]);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) expired = true;
    failure = e instanceof CrmApiError
      ? `${e.code}: ${e.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect('/login?next=/segments');

  // A preview is requested when any builder field is present in the query. Build the same definition
  // the save action would, and count it — so "N match" is exactly what saving would capture.
  const daysNum = Number(days);
  const previewDef: SegmentDefinition = {
    ...(tagId !== '' ? { tagIds: [tagId] } : {}),
    ...(replied !== '' ? { replied } : {}),
    ...(Number.isInteger(daysNum) && daysNum > 0 ? { lastContactedWithinDays: daysNum } : {})
  };
  const previewing = tagId !== '' || replied !== '' || days !== '';
  let previewCount: number | null = null;
  if (previewing && failure === null) {
    try { previewCount = await previewSegmentCount(previewDef); } catch { previewCount = null; }
  }

  return (
    <main className="page">
      <header className="mb-5">
        <Link href="/broadcast" className="text-sm text-muted hover:text-ink">← Campaigns</Link>
        <h1 className="page-title mt-2">Saved audiences</h1>
        <p className="page-desc">
          A saved filter that re-evaluates every time — "everyone tagged <code>pune</code> who
          replied" stays current on its own. Target one from a campaign; it freezes at launch.
        </p>
      </header>

      {sp.error !== undefined && (
        <p className="mb-4 notice notice-danger">
          {errorMessage(sp.error)}
        </p>
      )}
      {failure !== null && <p className="mb-4 text-sm text-danger">{failure}</p>}

      <Builder tags={tags} tagId={tagId} replied={replied} days={days}
        previewing={previewing} previewCount={previewCount} />

      <h2 className="mb-2 mt-6 text-sm font-semibold">Saved segments</h2>
      {segments.length === 0 && failure === null && (
        <p className="text-sm text-muted">None yet — build one above.</p>
      )}
      {segments.length > 0 && (
        <ul className="card list">
          {segments.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{describe(s.definition, tags)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted">
                  <span className="tabular-nums text-ink">{s.contactCount}</span> match
                </span>
                <form action={deleteSegmentAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton title="Delete segment" className="btn btn-sm" pendingLabel="Deleting…">
                    Delete
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * The builder: pick a tag, reply status and recency, preview the count, then save. One form with two
 * buttons — "Preview count" is a plain GET that reloads this page with the fields as query params
 * (so the count and the fields both persist), and "Save" posts to the server action.
 */
function Builder(
  { tags, tagId, replied, days, previewing, previewCount }: {
    tags: Tag[]; tagId: string; replied: string; days: string;
    previewing: boolean; previewCount: number | null;
  }
) {
  // The form itself is a plain GET (no function action), so "Preview count" is a normal submit that
  // navigates to /segments?…fields… and shows the count. "Save" carries the server action on the
  // button via formAction — mixing a function action on the <form> would make React intercept the
  // submit and swallow the GET-preview button entirely (the bug this replaced).
  return (
    <form method="get" action="/segments"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <input
        name="name" maxLength={100} placeholder="Segment name (e.g. Active Pune leads)"
        aria-label="Segment name"
        className="field"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Has tag</span>
          <select name="tagId" defaultValue={tagId}
            className="field">
            <option value="">— any —</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Reply status</span>
          <select name="replied" defaultValue={replied}
            className="field">
            <option value="">— any —</option>
            <option value="ever">has replied</option>
            <option value="never">never replied</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Contacted within (days)</span>
          <input name="days" type="number" min={1} max={3650} defaultValue={days}
            placeholder="any"
            className="field" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit"
          className="btn">
          Preview count
        </button>
        <SubmitButton formAction={createSegmentAction} className="btn btn-primary" pendingLabel="Saving…">
          Save segment
        </SubmitButton>
        {previewing && (
          <span className="text-sm text-muted">
            {previewCount === null
              ? 'could not count'
              : <><span className="tabular-nums text-ink">{previewCount}</span> match now</>}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        All conditions must match (AND). Do-not-contact people are always excluded. Leaving a field
        on &ldquo;any&rdquo; drops that condition.
      </p>
    </form>
  );
}
