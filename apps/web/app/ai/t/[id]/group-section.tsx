'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { AiTemplate, Sender, Tag } from '@/lib/crm';
import { countGroupAction, createGroupCampaignAction } from '../../actions';

/** The tag name offered by default: the template's name, the next free number, and the date and time. Editable, and at most 60 characters. */
function autoTagName(templateName: string, tags: Tag[]): string {
  const when = new Date();
  const day = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const escaped = templateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let next = 1;
  for (const t of tags) {
    const m = new RegExp(`^${escaped}-(\\d+) \\(`).exec(t.name);
    if (m !== null) next = Math.max(next, Number(m[1]) + 1);
  }
  const suffix = `-${String(next)} (${day}, ${time})`;
  return `${templateName.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
}

/**
 * "Message a group with this": a draft campaign made from the template. Everyone who gets a mass message is tagged, so the
 * audience is either an existing tag, or a search whose people are tagged first with a new, editable, auto-named tag.
 * Nothing is sent: the draft opens on its page, where an admin presses Start.
 */
export function GroupSection({ template, tags, senders }: { template: AiTemplate; tags: Tag[]; senders: Sender[] }) {
  const [mode, setMode] = useState<'tag' | 'search'>('tag');
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.firstMessage);
  const [sender, setSender] = useState(senders.length === 1 ? senders[0]!.id : '');
  const [tagId, setTagId] = useState('');
  const [filter, setFilter] = useState({ q: '', tagId: '', from: '', to: '', dateBy: 'added' as 'added' | 'imported' });
  const [count, setCount] = useState<number | null>(null);
  const [countedFor, setCountedFor] = useState('');
  const [tagName, setTagName] = useState(() => autoTagName(template.name, tags));
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filterKey = JSON.stringify(filter);
  const counted = count !== null && countedFor === filterKey;

  /** Counts the people the search finds, so the number is known before anyone is tagged. */
  function check() {
    setError(null);
    start(async () => {
      const result = await countGroupAction(filter);
      if (!result.ok || result.count === undefined) { setCount(null); setError(result.error ?? 'Could not count.'); return; }
      setCount(result.count); setCountedFor(filterKey);
    });
  }

  /** Makes the draft: tags the people first when the audience is a search. */
  function create() {
    setError(null);
    start(async () => {
      const audience = mode === 'tag'
        ? { mode: 'tag' as const, tagId }
        : { mode: 'search' as const, filter, tagName, expectedCount: count ?? 0 };
      const result = await createGroupCampaignAction({ templateId: template.id, name, body, senderIdentityId: sender, audience });
      if (!result.ok || result.campaignId === undefined) { setError(result.error ?? 'Could not create the draft.'); return; }
      setMade(result.campaignId);
    });
  }

  const ready = name.trim() !== '' && body.trim() !== '' && sender !== '' && !pending
    && (mode === 'tag' ? tagId !== '' : counted && count !== 0 && tagName.trim() !== '');

  return (
    <section className="card p-5" aria-label="Message a group">
      <h2 className="text-base font-semibold">Message a group</h2>
      <p className="mt-1 text-sm text-muted">Makes a draft campaign. Nothing is sent until an admin presses Start on its page.</p>

      <label className="mt-4 flex flex-col gap-1 text-sm font-medium">
        Campaign name
        <input className="field font-normal" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); }} />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
        First message
        <textarea className="field font-normal" rows={4} value={body} maxLength={4096} onChange={(e) => { setBody(e.target.value); }} />
        <span className="text-xs font-normal text-muted">{'{{name}}'} fills the contact’s name. Replies will follow this template once per-campaign templates are switched on.</span>
      </label>
      <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
        Send from
        <select className="field font-normal" value={sender} onChange={(e) => { setSender(e.target.value); }}>
          <option value="" disabled>Choose a number…</option>
          {senders.map((s) => <option key={s.id} value={s.id}>{s.label ?? 'number'}{s.phoneE164 !== null ? ` · ${s.phoneE164}` : ''}{s.status !== 'active' ? ` (${s.status})` : ''}</option>)}
        </select>
      </label>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Who gets it</legend>
        <p className="text-xs text-muted">Everyone who gets a mass message is tagged, so it can be found, reused and managed later.</p>
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'tag'} onChange={() => { setMode('tag'); }} /> People who already have a tag</label>
        <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'search'} onChange={() => { setMode('search'); }} /> Everyone a search finds (they get a new tag)</label>
      </fieldset>

      {mode === 'tag' && (
        <select aria-label="Tag" className="field mt-3" value={tagId} onChange={(e) => { setTagId(e.target.value); }}>
          <option value="" disabled>Choose a tag…</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}{t.contactCount !== undefined ? ` (${String(t.contactCount)})` : ''}</option>)}
        </select>
      )}

      {mode === 'search' && (
        <div className="mt-3 flex flex-col gap-3">
          <input aria-label="Search" className="field" placeholder="Search by name, phone, email or a field…" value={filter.q} onChange={(e) => { setFilter({ ...filter, q: e.target.value }); }} />
          <div className="flex flex-wrap items-end gap-3 text-xs text-muted">
            <label className="flex flex-col gap-1">Only people tagged
              <select className="field field-sm" value={filter.tagId} onChange={(e) => { setFilter({ ...filter, tagId: e.target.value }); }}>
                <option value="">anyone</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Date
              <select className="field field-sm" value={filter.dateBy} onChange={(e) => { setFilter({ ...filter, dateBy: e.target.value as 'added' | 'imported' }); }}>
                <option value="added">Added</option><option value="imported">Last imported</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">From
              <input type="date" aria-label="From date" className="field field-sm" value={filter.from} onChange={(e) => { setFilter({ ...filter, from: e.target.value }); }} />
            </label>
            <label className="flex flex-col gap-1">To
              <input type="date" aria-label="To date" className="field field-sm" value={filter.to} onChange={(e) => { setFilter({ ...filter, to: e.target.value }); }} />
            </label>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={check}>Check how many</button>
          </div>
          {counted && <p role="status" className="text-sm">{count === 0 ? 'No one matches.' : `${String(count)} ${count === 1 ? 'person' : 'people'} will be tagged and messaged (people marked do-not-contact are skipped when it starts).`}</p>}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tag for these people <span className="text-xs font-normal text-muted">editable; you can pick this tag again later and manage or delete it from Contacts</span>
            <input className="field font-normal" value={tagName} maxLength={60} onChange={(e) => { setTagName(e.target.value); }} />
          </label>
        </div>
      )}

      {error !== null && <p role="alert" className="notice notice-danger mt-3">{error}</p>}
      {made !== null ? (
        <p role="status" className="notice notice-success mt-3">Draft created. <Link className="font-medium underline" href={`/broadcast/${made}`}>Open it</Link> to check it and press Start.</p>
      ) : (
        <div className="mt-4"><button type="button" className="btn btn-primary" disabled={!ready} onClick={create}>Create draft</button></div>
      )}
    </section>
  );
}
