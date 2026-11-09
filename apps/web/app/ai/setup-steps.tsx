'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saveAiAction } from './actions';

/**
 * First run: three steps before the first template. Choose the AI model (on the AI provider tab), agree that messages are shared with
 * it (this also switches the AI on), then make a template. A step that is done shows a tick; the next one is open.
 */
export function SetupSteps({ modelReady, modelLabel, consented }: { modelReady: boolean; modelLabel: string | null; consented: boolean }) {
  const router = useRouter();
  const [agree, setAgree] = useState(consented);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Records the agreement and switches the AI on. */
  function confirm(): void {
    setError(null);
    start(async () => {
      const r = await saveAiAction({ acceptConsent: true, enabled: true });
      if (!r.ok) { setError(r.error ?? 'Could not switch the AI on.'); return; }
      router.refresh();
    });
  }

  const dot = (done: boolean, now: boolean): string =>
    `grid h-7 w-7 flex-none place-items-center rounded-full border text-sm font-semibold ${done ? 'border-transparent bg-success-soft text-success' : now ? 'border-accent bg-accent text-white' : 'border-edge'}`;

  return (
    <section className="card mt-4 flex flex-col divide-y divide-border" aria-label="Set up the AI assistant">
      <div className="flex gap-3 p-5">
        <span className={dot(modelReady, !modelReady)}>{modelReady ? '✓' : '1'}</span>
        <div className="flex min-w-0 flex-col gap-2">
          <b>Choose the AI model</b>
          <span className="text-sm text-muted">{modelReady ? `${modelLabel ?? 'The AI model'}. Tested and working.` : 'Pick a provider, enter its key and test it on the AI provider tab.'}</span>
          {!modelReady && <div><Link href="/ai/settings" className="btn btn-primary btn-sm">Choose the AI model</Link></div>}
        </div>
      </div>
      <div className={`flex gap-3 p-5 ${modelReady ? '' : 'opacity-60'}`}>
        <span className={dot(consented, modelReady && !consented)}>{consented ? '✓' : '2'}</span>
        <div className="flex min-w-0 flex-col gap-2">
          <b>Agree that messages are shared</b>
          <span className="text-sm text-muted">To write a reply, the AI sends the chat (the contact’s name and what they wrote) to the AI provider. Only agree if your contacts have been told.</span>
          {!consented && (
            <>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-[18px] w-[18px]" checked={agree} disabled={!modelReady} onChange={(e) => { setAgree(e.target.checked); }} />
                <span>I understand that contact messages are shared with the AI provider.</span>
              </label>
              <div><button type="button" className="btn btn-primary btn-sm" disabled={!agree || !modelReady || pending} onClick={confirm}>{pending ? 'Saving…' : 'Agree and switch the AI on'}</button></div>
            </>
          )}
          {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
        </div>
      </div>
      <div className={`flex gap-3 p-5 ${consented ? '' : 'opacity-60'}`}>
        <span className={dot(false, consented)}>3</span>
        <div className="flex min-w-0 flex-col gap-2">
          <b>Make your first template</b>
          <span className="text-sm text-muted">Describe one kind of conversation, such as inviting people to a walk-in. The AI fills it in and you test it.</span>
          {consented && <div><Link href="/ai/new" className="btn btn-primary btn-sm">Make a template</Link></div>}
        </div>
      </div>
    </section>
  );
}
