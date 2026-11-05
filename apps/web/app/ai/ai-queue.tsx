'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import type { AiCommandResult, AiJob } from '@/lib/crm';
import { cancelJobAction, enqueueJobAction, listJobsAction } from './actions';

/** A small spinning ring, so a running request visibly is not stuck. Stands still for people who ask for less motion. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role="status" aria-label={label ?? 'Working'}
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
    />
  );
}

/** How often the queue is refreshed while the page is open. */
const POLL_MS = 2000;

/** The words for a request's kind. */
const KIND: Record<AiJob['kind'], string> = { command: 'Instruction', draft: 'Campaign wording' };

/** Seconds since an ISO time, never negative. */
function secondsSince(iso: string | null, now: number): number {
  return iso === null ? 0 : Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
}

/** Picks the readable bits out of a finished instruction's result. */
function asCommandResult(result: unknown): AiCommandResult | null {
  const r = result as Partial<AiCommandResult> | null;
  return r !== null && typeof r === 'object' && Array.isArray(r.actions) ? { message: r.message ?? '', actions: r.actions } : null;
}

/** One row of the queue: where it stands, what it is, and what came of it. */
function JobRow({ job, now, onCancel, cancelling }: { job: AiJob; now: number; onCancel: () => void; cancelling: boolean }) {
  const command = job.status === 'done' && job.kind === 'command' ? asCommandResult(job.result) : null;
  const wording = job.status === 'done' && job.kind === 'draft' ? (job.result as { body?: string } | null)?.body : undefined;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex w-14 shrink-0 justify-center">
          {job.status === 'running' && <Spinner label="Running" />}
          {job.status === 'queued' && <span className="badge">#{job.position ?? '…'}</span>}
          {job.status === 'done' && <span className="text-success" aria-label="Done">✓</span>}
          {job.status === 'failed' && <span className="text-danger" aria-label="Failed">✗</span>}
          {job.status === 'cancelled' && <span className="text-muted" aria-label="Cancelled">—</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {KIND[job.kind]}
            {job.status === 'queued' && ` · waiting, ${job.position === 1 ? 'next up' : `${String((job.position ?? 1) - 1)} ahead`}`}
            {job.status === 'running' && ` · working… ${String(secondsSince(job.startedAt, now))}s`}
            {job.status === 'done' && ' · done'}
            {job.status === 'failed' && ' · failed'}
            {job.status === 'cancelled' && ' · cancelled'}
            {!job.mine && ' · someone else’s'}
          </p>
          <p className="break-words text-sm">{job.input}</p>
        </div>
        {job.status === 'queued' && (
          <button type="button" className="btn btn-sm shrink-0" disabled={cancelling} onClick={onCancel}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
      {job.status === 'failed' && job.error !== null && <p role="alert" className="ml-[4.25rem] text-sm text-danger">{job.error}</p>}
      {command !== null && (
        <div className="ml-[4.25rem] flex flex-col gap-1 text-sm">
          {command.message !== '' && <p>{command.message}</p>}
          <ul className="flex flex-col gap-0.5">
            {command.actions.map((a, i) => (
              <li key={i} className={a.ok ? '' : 'text-danger'}>
                {a.ok ? '✓' : '✗'} {a.detail}
                {a.campaignId !== undefined && <> <Link href={`/broadcast/${a.campaignId}`} className="underline">Open campaign</Link></>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {wording !== undefined && <p className="ml-[4.25rem] whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-2 text-sm">{wording}</p>}
    </li>
  );
}

/**
 * Tell the assistant what to do, and watch the queue.
 *
 * Every request goes in a line and runs one at a time, oldest first. The list shows who is waiting (with their place),
 * what is running (with a spinner and a clock), and what finished in the last day. A request can be cancelled while it is
 * still waiting; one that has started is allowed to finish.
 */
export function AiQueue({ initial, mayStart }: { initial: AiJob[]; mayStart: boolean }) {
  const [jobs, setJobs] = useState<AiJob[]>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sending, startSend] = useTransition();

  // Keep the list fresh, and tick the clock on running requests. Paused while the tab is hidden.
  useEffect(() => {
    let live = true;
    const poll = async (): Promise<void> => {
      if (document.hidden) return;
      const r = await listJobsAction();
      if (live && r.ok) setJobs(r.jobs);
      if (live) setNow(Date.now());
    };
    const id = setInterval(() => { void poll(); }, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, []);

  /** Puts the typed instruction in the queue and shows the list straight away. */
  function send(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSend(async () => {
      const r = await enqueueJobAction('command', text);
      if (!r.ok) { setError(r.error ?? 'Could not queue that.'); return; }
      setText('');
      const list = await listJobsAction();
      if (list.ok) setJobs(list.jobs);
    });
  }

  /** Cancels a waiting request and refreshes the list. */
  async function cancel(id: string): Promise<void> {
    setCancelling(id);
    setError(null);
    const r = await cancelJobAction(id);
    if (!r.ok) setError(r.error ?? 'Could not cancel that.');
    const list = await listJobsAction();
    if (list.ok) setJobs(list.jobs);
    setCancelling(null);
  }

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  return (
    <section className="card p-5" aria-label="Instruct the assistant">
      <h2 className="text-base font-semibold">Tell the assistant what to do</h2>
      <p className="mt-1 text-sm text-muted">
        For example: “Send the Friday interview reminder to everyone tagged pune”, “message Asha and ask if she can start Monday”,
        “pause the Diwali campaign”, or “change the wording of the walk-in campaign to mention parking”.
        {mayStart
          ? ' It may start campaigns itself.'
          : ' It prepares campaigns and you press Start; it cannot start one itself.'}
      </p>
      <form onSubmit={send} className="mt-3 flex flex-col gap-2">
        <textarea
          value={text} onChange={(e) => { setText(e.target.value); }} rows={3} maxLength={2000} required
          aria-label="Instruction for the assistant" className="field font-normal"
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={sending} className="btn btn-primary btn-sm">{sending ? 'Adding to the queue…' : 'Send'}</button>
          {sending && <Spinner label="Adding to the queue" />}
        </div>
      </form>
      {error !== null && <p role="alert" className="notice notice-danger mt-3">{error}</p>}

      <div className="mt-5 border-t border-border pt-4" aria-label="AI queue">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Queue
          <span className="badge">{active === 0 ? 'idle' : `${String(active)} active`}</span>
        </h3>
        {jobs.length === 0
          ? <p className="mt-2 text-sm text-muted">Nothing here yet. Requests run one at a time, oldest first, and stay listed for a day.</p>
          : (
            <ul className="mt-1 divide-y divide-border">
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} now={now} cancelling={cancelling === j.id} onCancel={() => { void cancel(j.id); }} />
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
