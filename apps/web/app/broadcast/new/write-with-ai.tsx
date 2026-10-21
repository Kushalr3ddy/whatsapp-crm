'use client';

import { useEffect, useRef, useState } from 'react';
import type { AiJob } from '@/lib/crm';
import { cancelJobAction, enqueueJobAction, listJobsAction } from '../../ai/actions';
import { Spinner } from '../../ai/ai-queue';

/** How often a waiting request is checked. */
const POLL_MS = 1500;

/**
 * "Write with AI" for the campaign form: say what the message should do and the assistant fills the message box.
 *
 * The request joins the AI queue like any other, so it may have to wait its turn; the box says where it stands (waiting,
 * with how many are ahead, or writing) and offers Cancel while it is still waiting. Nothing is created or sent: the text
 * lands in the form for a person to read and change.
 */
export function WriteWithAi() {
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [job, setJob] = useState<AiJob | null>(null);
  const [starting, setStarting] = useState(false);
  const jobId = useRef<string | null>(null);

  // While a request is out, ask the queue how it is getting on.
  useEffect(() => {
    if (job === null || (job.status !== 'queued' && job.status !== 'running')) return undefined;
    let live = true;
    const id = setInterval(() => {
      void (async () => {
        const r = await listJobsAction();
        const mine = r.jobs.find((j) => j.id === jobId.current);
        if (!live || mine === undefined) return;
        setJob(mine);
        if (mine.status === 'done') {
          const body = (mine.result as { body?: string } | null)?.body;
          const box = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
          if (body !== undefined && box !== null) { box.value = body; setDone(true); }
        }
        if (mine.status === 'failed') setError(mine.error ?? 'Could not write that.');
      })();
    }, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [job]);

  /** Puts the goal in the queue. */
  async function write(): Promise<void> {
    setError(null); setDone(false); setStarting(true);
    const r = await enqueueJobAction('draft', goal);
    setStarting(false);
    if (!r.ok || r.id === undefined) { setError(r.error ?? 'Could not queue that.'); return; }
    jobId.current = r.id;
    const list = await listJobsAction();
    setJob(list.jobs.find((j) => j.id === r.id) ?? null);
  }

  /** Cancels the request while it is still waiting. */
  async function cancel(): Promise<void> {
    if (jobId.current === null) return;
    const r = await cancelJobAction(jobId.current);
    if (!r.ok) { setError(r.error ?? 'Could not cancel that.'); return; }
    setJob(null);
    jobId.current = null;
  }

  const waiting = job?.status === 'queued';
  const writing = job?.status === 'running';
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
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={starting || waiting || writing || goal.trim().length < 3} onClick={() => { void write(); }} className="btn btn-sm">
          {starting ? 'Adding to the queue…' : 'Write it'}
        </button>
        {(starting || writing) && <Spinner label="Writing" />}
        {writing && <span role="status" className="text-xs text-muted">Writing…</span>}
        {waiting && (
          <>
            <span role="status" className="text-xs text-muted">
              Waiting in the AI queue — {job.position === 1 ? 'you are next' : `${String((job.position ?? 1) - 1)} ahead of you`}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => { void cancel(); }}>Cancel</button>
          </>
        )}
        {done && <span role="status" className="text-xs text-success">Added below. Check it before you save.</span>}
        {error !== null && <span role="alert" className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
