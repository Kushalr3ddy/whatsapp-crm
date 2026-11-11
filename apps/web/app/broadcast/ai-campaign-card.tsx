'use client';

import { useState, useTransition } from 'react';
import { stopAiAction } from './actions';

/**
 * The AI's line on a campaign that uses a template: whether it is answering replies, what it has used so far in credits, and a
 * button to stop it on this campaign only. Stopping asks first; the chats go to the person the template names.
 */
export function AiCampaignCard(props: { id: string; stopped: boolean; credits: number; openings: number; replies: number; finished: boolean }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Stops the AI on this campaign and closes the question. */
  function stop(): void {
    setError(null);
    start(async () => {
      const r = await stopAiAction(props.id);
      if (!r.ok) setError(r.error ?? 'Could not stop the AI.');
      setAsking(false);
    });
  }

  return (
    <section className="card mb-4 flex flex-col gap-3 p-4" aria-label="AI on this campaign">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {props.stopped
          ? <span className="inline-flex items-center gap-2 text-sm font-medium text-warning"><span className="h-2 w-2 rounded-full bg-current" />AI stopped on this campaign</span>
          : <span className="inline-flex items-center gap-2 text-sm font-medium text-success"><span className="h-2 w-2 rounded-full bg-current" />AI is answering replies</span>}
        <span className="min-w-0 flex-1 basis-60 text-sm"><b className="font-semibold">Used so far: {props.credits.toLocaleString('en-US')} credits</b> · {props.openings.toLocaleString('en-US')} openings, {props.replies.toLocaleString('en-US')} replies</span>
        {!props.stopped && !props.finished && !asking && <button type="button" className="btn btn-sm" onClick={() => { setAsking(true); }}>Stop the AI on this campaign</button>}
      </div>
      {asking && (
        <div role="alertdialog" aria-label="Stop the AI" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <b>Stop the AI on this campaign?</b>
          <span>It stops answering this campaign’s replies. Those chats go to the contact person set on the template, and openings not yet sent go out as the campaign’s own text. Other campaigns keep their AI.</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={stop}>{pending ? 'Stopping…' : 'Stop the AI'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setAsking(false); }}>Cancel</button>
          </div>
        </div>
      )}
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
    </section>
  );
}
