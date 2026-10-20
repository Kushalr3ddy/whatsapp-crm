'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { previewAudienceAction } from '../actions';

/** What the picker needs to offer: the org's tags, imports and saved audiences. */
interface Props {
  tags: Array<{ id: string; name: string; contactCount?: number }>;
  imports: Array<{ id: string; label: string }>;
  segments: Array<{ id: string; name: string; contactCount: number }>;
  /** A tag to start on (the Contacts page sends people here with `?tag=`). */
  defaultTagId?: string | undefined;
}

/** The four ways to choose who a campaign goes to. */
type Mode = 'tag' | 'import' | 'segment' | 'filter';

/**
 * The "who gets it" step of a campaign. One place to choose an audience four ways — everyone with a
 * tag, everyone from an import, a saved audience, or **a filter built right here** with a live count
 * of who it reaches (the old standalone Segments screen, folded in). Only the chosen way's field is
 * rendered, so the form posts exactly one audience.
 */
export function AudiencePicker({ tags, imports, segments, defaultTagId }: Props) {
  const first: Mode = tags.length > 0 ? 'tag' : imports.length > 0 ? 'import'
    : segments.length > 0 ? 'segment' : 'filter';
  const [mode, setMode] = useState<Mode>(first);
  // No tag has anyone in it (or there are no tags): say so, and point to where people get tagged.
  const noTagged = tags.every((t) => (t.contactCount ?? 1) === 0);
  const [filterTag, setFilterTag] = useState('');
  const [replied, setReplied] = useState('');
  const [days, setDays] = useState('');
  const [keep, setKeep] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  // Live count for the inline filter, debounced so typing a number does not fire a request per key.
  useEffect(() => {
    if (mode !== 'filter') return;
    if (filterTag === '' && replied === '' && days === '') { setCount(null); return; }
    const t = setTimeout(() => {
      void previewAudienceAction({ tagId: filterTag, replied, days }).then(setCount);
    }, 300);
    return () => { clearTimeout(t); };
  }, [mode, filterTag, replied, days]);

  const options: Array<{ id: Mode; label: string; show: boolean }> = [
    { id: 'tag', label: 'A tag', show: tags.length > 0 },
    { id: 'import', label: 'An import', show: imports.length > 0 },
    { id: 'segment', label: 'A saved audience', show: segments.length > 0 },
    { id: 'filter', label: 'Build a filter', show: true }
  ];

  return (
    <div>
      <input type="hidden" name="audienceMode" value={mode} />
      {noTagged && (
        <p className="notice mb-4" role="status">
          No one is tagged yet. Tag the people you want to message first, on the{' '}
          <Link href="/contacts" className="font-medium underline underline-offset-2">Contacts page</Link>
          {' '}(or tick “Tag everyone in this file” when you import). You can still build a filter below.
        </p>
      )}
      <div role="tablist" aria-label="How to choose the audience" className="mb-4 flex flex-wrap gap-2">
        {options.filter((o) => o.show).map((o) => (
          <button
            key={o.id} type="button" role="tab" aria-selected={mode === o.id}
            onClick={() => { setMode(o.id); }}
            className={`btn btn-sm ${mode === o.id ? 'btn-primary' : ''}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {mode === 'tag' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Everyone tagged</span>
          <select name="fromTagId" defaultValue={tags.some((t) => t.id === defaultTagId) ? defaultTagId : ''} className="field">
            <option value="">— choose a tag —</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.contactCount !== undefined ? ` · ${String(t.contactCount)} contacts` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'import' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Everyone from an import</span>
          <select name="fromImportRunId" defaultValue="" className="field">
            <option value="">— choose an import —</option>
            {imports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      )}

      {mode === 'segment' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">A saved audience</span>
          <select name="fromSegmentId" defaultValue="" className="field">
            <option value="">— choose one —</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {s.contactCount} match</option>
            ))}
          </select>
        </label>
      )}

      {mode === 'filter' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            People matching <strong>all</strong> of these. It stays current until the campaign starts,
            then freezes. Do-not-contact people are always left out.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Has tag</span>
              <select name="filterTagId" value={filterTag} onChange={(e) => { setFilterTag(e.target.value); }} className="field">
                <option value="">any</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Reply status</span>
              <select name="filterReplied" value={replied} onChange={(e) => { setReplied(e.target.value); }} className="field">
                <option value="">any</option>
                <option value="ever">has replied before</option>
                <option value="never">has never replied</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Messaged in the last (days)</span>
              <input
                name="filterDays" type="number" min={1} max={3650} value={days} placeholder="any"
                onChange={(e) => { setDays(e.target.value); }} className="field"
              />
            </label>
          </div>

          <p role="status" className="text-sm">
            {count === null
              ? <span className="text-muted">Set at least one condition to see how many people it reaches.</span>
              : <><strong className="tabular-nums">{count}</strong> {count === 1 ? 'person' : 'people'} match right now.</>}
          </p>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="keepAudience" checked={keep} onChange={(e) => { setKeep(e.target.checked); }} />
            Save this audience to reuse in other campaigns
          </label>
          {keep && (
            <input
              name="audienceName" required maxLength={100} placeholder="Name it, e.g. Pune leads who replied"
              aria-label="Saved audience name" className="field"
            />
          )}
        </div>
      )}
    </div>
  );
}
