'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { AiCommandResult } from '@/lib/crm';
import { aiCommandAction } from './actions';

/** A box to tell the assistant what to do with campaigns, and a plain list of what it did. */
export function CommandBox({ mayStart }: { mayStart: boolean }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<AiCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Sends the instruction; the assistant works out the steps and does them. */
  function send(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    start(async () => {
      const r = await aiCommandAction(text);
      if (!r.ok || r.result === undefined) { setError(r.error ?? 'Could not do that.'); return; }
      setResult(r.result);
    });
  }

  return (
    <section className="card p-5" aria-label="Instruct the assistant">
      <h2 className="text-base font-semibold">Tell the assistant what to do</h2>
      <p className="mt-1 text-sm text-muted">
        For example: “Send the Friday interview reminder to everyone tagged pune”, “pause the Diwali campaign”, or
        “change the wording of the walk-in campaign to mention parking”.
        {mayStart
          ? ' It may start campaigns itself; every anti-ban limit still applies.'
          : ' It prepares campaigns and you press Start; it cannot start one itself.'}
      </p>
      <form onSubmit={send} className="mt-3 flex flex-col gap-2">
        <textarea
          value={text} onChange={(e) => { setText(e.target.value); }} rows={3} maxLength={2000} required
          aria-label="Instruction for the assistant" className="field font-normal"
        />
        <div><button type="submit" disabled={pending} className="btn btn-primary btn-sm">{pending ? 'Working…' : 'Send'}</button></div>
      </form>
      {error !== null && <p role="alert" className="notice notice-danger mt-3">{error}</p>}
      {result !== null && (
        <div role="status" className="mt-3 flex flex-col gap-2" aria-label="What the assistant did">
          {result.message !== '' && <p className="text-sm">{result.message}</p>}
          {result.actions.length === 0 && result.message === '' && <p className="text-sm text-muted">It did nothing.</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {result.actions.map((a, i) => (
              <li key={i} className={a.ok ? '' : 'text-danger'}>
                {a.ok ? '✓' : '✗'} {a.detail}
                {a.campaignId !== undefined && <> <Link href={`/broadcast/${a.campaignId}`} className="underline">Open campaign</Link></>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
