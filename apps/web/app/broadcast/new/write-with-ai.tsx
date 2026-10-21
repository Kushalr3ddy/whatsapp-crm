'use client';

import { useState, useTransition } from 'react';
import { draftBodyAction } from '../../ai/actions';

/**
 * "Write with AI" for the campaign form: say what the message should do and the assistant fills the message box. Nothing
 * is created or sent; the text can be changed before the campaign is saved.
 */
export function WriteWithAi() {
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  /** Fills the form's message box, which is a plain field belonging to the server-rendered form. */
  function write() {
    setError(null);
    setDone(false);
    start(async () => {
      const r = await draftBodyAction(goal);
      if (!r.ok || r.body === undefined) { setError(r.error ?? 'Could not write that.'); return; }
      const box = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
      if (box !== null) box.value = r.body;
      setDone(true);
    });
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface p-3" aria-label="Write with AI">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Write with AI
        <span className="text-xs font-normal text-muted">Say what the message should do; the text lands in the box below for you to read and change.</span>
        <input
          value={goal} onChange={(e) => { setGoal(e.target.value); }} maxLength={1000}
          placeholder="e.g. remind people about Friday’s walk-in interview at 10am" className="field font-normal"
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" disabled={pending || goal.trim().length < 3} onClick={write} className="btn btn-sm">{pending ? 'Writing…' : 'Write it'}</button>
        {done && <span role="status" className="text-xs text-success">Added below. Check it before you save.</span>}
        {error !== null && <span role="alert" className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
