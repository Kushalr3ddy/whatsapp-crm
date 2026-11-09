'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { AiTemplate } from '@/lib/crm';
import { deleteTemplateAction, duplicateTemplateAction, removeTemplateNowAction, restoreTemplateAction } from './actions';

/** How many of the AI's questions still have neither an answer nor a "a colleague will confirm". */
function openQuestions(t: AiTemplate): number {
  return t.questions.filter((q) => q.answer.trim() === '' && !q.skipped).length;
}

/** "Used in 4 campaigns · last on 1 Nov 2026", or "Not used yet". */
function usedLine(t: AiTemplate): string {
  if (t.campaignCount === 0) return 'Not used yet';
  const last = t.lastUsedAt === null ? '' : ` · last on ${new Date(t.lastUsedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  return `Used in ${String(t.campaignCount)} ${t.campaignCount === 1 ? 'campaign' : 'campaigns'}${last}`;
}

/**
 * The home of the AI assistant: one card per template, a card to start a new one, and Deleted at the end. A template opens to be
 * changed or starts a campaign; Duplicate copies it; Delete moves it to Deleted (refused while an unfinished campaign uses it),
 * where Restore brings it back for 30 days and Remove now removes it for good.
 */
export function TemplatesHome({ templates, deleted }: { templates: AiTemplate[]; deleted: AiTemplate[] }) {
  const [menu, setMenu] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Runs an action, then closes whatever was open and shows the reason if it was refused. */
  function run(step: () => Promise<{ ok: boolean; error?: string }>): void {
    setError(null);
    start(async () => {
      const result = await step();
      if (!result.ok) setError(result.error ?? 'That did not work. Try again.');
      setMenu(null); setAsking(null); setRemoving(null);
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
        <Link
          href="/ai/new"
          className="flex min-h-48 flex-col items-start justify-center gap-2 rounded-xl border-2 border-dashed border-edge p-4 text-left hover:border-accent hover:bg-accent-soft"
        >
          <b className="text-base">+ New template</b>
          <span className="text-sm text-muted">Describe what you want in a sentence or paste a job description. The AI fills in every section; you check it and test it.</span>
        </Link>

        {templates.map((t) => {
          const open = openQuestions(t);
          return (
            <article key={t.id} className="card flex min-w-0 flex-col gap-3 p-4" aria-label={t.name}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{t.name}</h2>
                <span className={`badge ${open > 0 ? 'badge-warning' : 'badge-success'}`}>{open > 0 ? `Needs ${String(open)} ${open === 1 ? 'answer' : 'answers'}` : 'Ready'}</span>
              </div>
              <p className="text-sm text-muted">{(t.description || t.audience).slice(0, 160)}</p>
              <span className="text-sm text-muted">{usedLine(t)}</span>

              {asking === t.id ? (
                <div role="alertdialog" aria-label="Delete template" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                  <b>Delete “{t.name}”?</b>
                  <span>
                    It moves to Deleted, where you can bring it back for 30 days. After that it is removed and cannot be brought back.{' '}
                    {t.campaignCount > 0
                      ? `${String(t.campaignCount)} finished ${t.campaignCount === 1 ? 'campaign' : 'campaigns'} used it. Until it is removed, it keeps answering late replies to ${t.campaignCount === 1 ? 'that campaign' : 'those campaigns'}.`
                      : 'No campaign has used it.'}
                  </span>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => { run(() => deleteTemplateAction(t.id)); }}>Delete</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setAsking(null); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-auto grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2">
                  <Link href={`/broadcast/new?template=${t.id}`} className="btn btn-primary col-span-2">Start a campaign</Link>
                  <Link href={`/ai/t/${t.id}`} className="btn">Open</Link>
                  <div className="relative">
                    <button
                      type="button" className="btn btn-ghost w-full px-0" aria-label={`More actions for ${t.name}`} aria-haspopup="menu" aria-expanded={menu === t.id}
                      onClick={() => { setMenu(menu === t.id ? null : t.id); }}
                    >⋯</button>
                    {menu === t.id && (
                      <div role="menu" className="card absolute bottom-12 right-0 z-10 w-max min-w-56 max-w-72 overflow-hidden p-0 shadow-lg">
                        <button type="button" role="menuitem" className="block min-h-11 w-full px-4 text-left text-sm hover:bg-surface-2" disabled={pending} onClick={() => { run(() => duplicateTemplateAction(t.id)); }}>Duplicate</button>
                        {t.unfinishedCount > 0
                          ? (
                            <span role="menuitem" aria-disabled="true" className="block w-full cursor-not-allowed border-t border-border px-4 py-2 text-left text-sm text-muted">
                              Delete…
                              <span className="block text-xs">In use by {t.unfinishedCount} {t.unfinishedCount === 1 ? 'campaign that has' : 'campaigns that have'} not finished</span>
                            </span>
                          )
                          : <button type="button" role="menuitem" className="block min-h-11 w-full border-t border-border px-4 text-left text-sm text-danger hover:bg-surface-2" onClick={() => { setAsking(t.id); setMenu(null); }}>Delete…</button>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {deleted.length > 0 && (
        <details className="card">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">Deleted ({deleted.length}) · you can bring these back for 30 days</summary>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {deleted.map((t) => (
              removing === t.id ? (
                <div key={t.id} role="alertdialog" aria-label="Remove now" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                  <b>Remove “{t.name}” now?</b>
                  <span>You will not be able to bring it back.{t.campaignCount > 0 ? ` Late replies to the ${t.campaignCount === 1 ? 'campaign' : String(t.campaignCount) + ' campaigns'} that used it will no longer get an AI answer.` : ''}</span>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => { run(() => removeTemplateNowAction(t.id)); }}>Yes, remove it</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setRemoving(null); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={t.id} className="flex items-center gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-medium">{t.name}</b>
                    <span className="text-sm text-muted">Removed automatically after 30 days</span>
                  </div>
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { run(() => restoreTemplateAction(t.id)); }}>Restore</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setRemoving(t.id); }}>Remove now…</button>
                </div>
              )
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
