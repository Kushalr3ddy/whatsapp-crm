'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AiTemplate } from '@/lib/crm';
import { generateTemplateAction, saveTemplateAction, useTemplateAction, deleteTemplateAction } from './actions';

/** The longest description a person may paste; the server enforces the same limit. */
const MAX = 8000;

/** What the review section is showing. */
interface Draft {
  id: string | undefined;
  name: string;
  instructions: string;
  audience: string;
  firstMessage: string;
  /** The description these instructions were written from; saving needs it to still match the description box. */
  writtenFrom: string;
  missing: string[];
}

/**
 * Describe what you want in plain words, let the AI write the instructions, review them, save them as a template, and pick a
 * saved one again. The instructions are locked until the person chooses to edit by hand, and the always-on rules are shown
 * as a separate locked block (the server adds them in front of the instructions every time the assistant replies).
 */
export function TemplatesPanel({ templates, rules }: { templates: AiTemplate[]; rules: string[] }) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [askEdit, setAskEdit] = useState(false);
  const [askReplace, setAskReplace] = useState(false);
  const [handEdited, setHandEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const review = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const stale = draft !== null && description !== draft.writtenFrom;
  const tooLong = description.length > MAX;

  /** Asks the AI to write the instructions, then scrolls to the review section. */
  function write(extra: string[] = []) {
    setError(null); setNotice(null); setAskReplace(false);
    start(async () => {
      const result = await generateTemplateAction(description, extra);
      if (!result.ok || result.template === undefined) { setError(result.error ?? 'Could not write the instructions.'); return; }
      const t = result.template;
      setDraft({ id: undefined, name: t.name, instructions: t.instructions, audience: t.audience, firstMessage: t.firstMessage, writtenFrom: description, missing: t.missing });
      setAnswers({}); setEditing(false); setHandEdited(false);
      setTimeout(() => { review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    });
  }

  /** Writes again; if the person edited the instructions by hand, asks before replacing them. */
  function writeClicked(extra: string[] = []) {
    if (handEdited) { setAskReplace(true); return; }
    write(extra);
  }

  /** Saves the draft with the description it was written from. */
  function save() {
    if (draft === null) return;
    setError(null);
    start(async () => {
      const result = await saveTemplateAction({
        ...(draft.id !== undefined ? { id: draft.id } : {}), name: draft.name, description, instructions: draft.instructions,
        audience: draft.audience, firstMessage: draft.firstMessage
      });
      if (!result.ok || result.template === undefined) { setError(result.error ?? 'Could not save.'); return; }
      // Saved: the next steps (what next, sending, replies) are on their own page.
      router.push(`/ai/t/${result.template.id}`);
    });
  }

  /** Loads a saved template into the boxes, ready to use or change. */
  function load(t: AiTemplate) {
    setDescription(t.description);
    setDraft({ id: t.id, name: t.name, instructions: t.instructions, audience: t.audience, firstMessage: t.firstMessage, writtenFrom: t.description, missing: [] });
    setEditing(false); setHandEdited(false); setError(null); setNotice(null);
    setTimeout(() => { review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }

  /** Makes a template what every chat follows by default, and says so. */
  function useAsDefault(id: string, name: string) {
    setError(null);
    start(async () => {
      const result = await useTemplateAction(id, true);
      if (!result.ok) { setError(result.error ?? 'Could not use it.'); return; }
      setNotice(`"${name}" now answers all the chats by default. It is also in the box below, "What it may talk about, and how".`);
    });
  }

  /** Deletes a template after asking. */
  function remove(id: string, name: string) {
    if (!window.confirm(`Delete the template "${name}"?`)) return;
    start(async () => {
      const result = await deleteTemplateAction(id);
      if (!result.ok) setError(result.error ?? 'Could not delete.');
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <section className="card p-5" aria-label="Describe what you want">
        <h2 className="text-base font-semibold">Describe what you want</h2>
        <p className="mt-1 text-sm text-muted">
          Say it in plain words, or paste a job description or product sheet. The AI writes the instructions from all of it.
          For example: “I own a car showroom. Message people who want a car about our new SUV and book test drives.”
        </p>
        <textarea
          value={description} onChange={(e) => { setDescription(e.target.value); }} rows={6}
          aria-label="Your description" className="field mt-3 w-full"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={pending || description.trim().length < 3 || tooLong} onClick={() => { writeClicked(); }}>
            {pending && draft === null ? 'Writing…' : 'Write the instructions'}
          </button>
          <span className={`ml-auto text-xs ${tooLong ? 'text-danger' : 'text-muted'}`}>{description.length} / {MAX} characters</span>
        </div>
        {tooLong && <p className="mt-2 text-sm text-danger">That is over {MAX} characters. Shorten it, or split it into two templates.</p>}
        {error !== null && <p role="alert" className="notice notice-danger mt-3">{error}</p>}
        {askReplace && (
          <div className="notice notice-warning mt-3" role="alertdialog">
            This replaces the changes you made to the instructions by hand. Continue?
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => { write(Object.entries(answers).filter(([, v]) => v.trim() !== '').map(([q, v]) => `${q} ${v.trim()}`)); }}>Yes, continue</button>
              <button type="button" className="btn btn-sm" onClick={() => { setAskReplace(false); }}>No, go back</button>
            </div>
          </div>
        )}
      </section>

      {templates.length > 0 && (
        <section className="card p-5" aria-label="Saved templates">
          <h2 className="text-base font-semibold">Saved templates</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted">used {t.useCount} {t.useCount === 1 ? 'time' : 'times'}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => { load(t); }}>Open</button>
                  <Link href={`/ai/t/${t.id}`} className="btn btn-sm">Next steps</Link>
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { useAsDefault(t.id, t.name); }}>Use for all chats</button>
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { remove(t.id, t.name); }}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
          {notice !== null && <p role="status" className="notice notice-success mt-3">{notice}</p>}
        </section>
      )}

      {draft !== null && (
        <div ref={review} className="flex scroll-mt-4 flex-col gap-5" aria-label="Review and save">
          <p className="notice notice-warning">
            <strong>Written by AI.</strong> Read it before you use it. It may be wrong or off-tone. Nothing is saved until you choose.
          </p>

          {draft.missing.length > 0 && (
            <section className="card p-5" aria-label="Questions">
              <h2 className="text-base font-semibold">It needs a few facts first</h2>
              {draft.missing.map((q) => (
                <label key={q} className="mt-2 flex flex-col gap-1 text-sm">
                  {q}
                  <input className="field" value={answers[q] ?? ''} onChange={(e) => { setAnswers({ ...answers, [q]: e.target.value }); }} />
                </label>
              ))}
              <button
                type="button" className="btn btn-primary mt-3" disabled={pending}
                onClick={() => { writeClicked(Object.entries(answers).filter(([, v]) => v.trim() !== '').map(([q, v]) => `${q} ${v.trim()}`)); }}
              >
                Write it again with these answers
              </button>
            </section>
          )}

          <section className="card p-5">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Template name
              <input className="field font-normal" value={draft.name} maxLength={80} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); }} />
            </label>

            <label className="mt-4 flex flex-col gap-1 text-sm font-medium">
              <span>Instructions for the AI <span className="ml-2 text-xs font-normal text-muted">{editing ? 'editable' : 'locked until you choose to edit'}</span></span>
              <textarea
                value={draft.instructions} readOnly={!editing} rows={14} className="field font-normal"
                onChange={(e) => { setDraft({ ...draft, instructions: e.target.value }); setHandEdited(true); }}
              />
            </label>
            {!editing && (
              <div className="mt-2">
                <button type="button" className="btn btn-sm" onClick={() => { setAskEdit(true); }}>Edit by hand</button>
              </div>
            )}
            {askEdit && !editing && (
              <div className="notice notice-warning mt-3" role="alertdialog">
                Editing the instructions by hand can make the assistant behave differently from what you described.
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => { setEditing(true); setAskEdit(false); }}>Edit anyway</button>
                  <button type="button" className="btn btn-sm" onClick={() => { setAskEdit(false); }}>Keep it locked</button>
                </div>
              </div>
            )}
          </section>

          <section className="card p-5" aria-label="Always added automatically">
            <h2 className="text-base font-semibold">Always added automatically <span className="ml-2 text-xs font-normal text-muted">locked, the same for every template, cannot be edited</span></h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted">Added in front of the instructions every time the assistant replies, even if someone edits or empties them.</p>
          </section>

          <section className="card p-5">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Who gets the first message
              <input className="field font-normal" value={draft.audience} maxLength={300} onChange={(e) => { setDraft({ ...draft, audience: e.target.value }); }} />
            </label>
            <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
              First message (a draft)
              <textarea className="field font-normal" rows={3} value={draft.firstMessage} maxLength={1000} onChange={(e) => { setDraft({ ...draft, firstMessage: e.target.value }); }} />
            </label>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={pending || stale || draft.instructions.trim() === '' || draft.name.trim() === ''} onClick={save}>
              {pending ? 'Saving…' : 'Save as a template'}
            </button>
            {stale && <span className="text-xs text-muted">Your description changed. Write the instructions again before saving.</span>}
          </div>

        </div>
      )}
    </div>
  );
}
