'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { startCampaignAction, pauseCampaignAction, cancelCampaignAction } from './actions';
import { GATE_LABEL, GATE_EFFECT } from './gates';

/** The event the "Send anyway" button in the cooldown warning fires to open the overrides dialog. */
export const OPEN_OVERRIDES = 'crm:open-overrides';

/**
 * The start/pause/cancel controls. Pressing one disables all of them and shows what is happening ("Starting…"), so a second
 * click cannot do anything; the page re-reads itself when the server is done.
 */
export function CampaignControls({ id, status, isAdmin }: { id: string; status: string; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [doing, setDoing] = useState<'start' | 'pause' | 'cancel' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // The cooldown warning's "Send anyway" opens the dialog with the cooldown box already ticked.
  useEffect(() => {
    const open = (): void => {
      const box = dialog.current?.querySelector<HTMLInputElement>('input[value="cooldown"]');
      if (box) box.checked = true;
      dialog.current?.showModal();
    };
    window.addEventListener(OPEN_OVERRIDES, open);
    return () => { window.removeEventListener(OPEN_OVERRIDES, open); };
  }, []);

  if (status === 'completed' || status === 'cancelled') return null;

  /** Runs one control on the server, with every button off until it is done. */
  function run(kind: 'start' | 'pause' | 'cancel', action: (fd: FormData) => Promise<void>, extra?: FormData): void {
    const fd = extra ?? new FormData();
    fd.set('id', id);
    setDoing(kind);
    startTransition(async () => { await action(fd); setDoing(null); dialog.current?.close(); });
  }

  const startLabel = status === 'paused' ? 'Resume' : 'Start';
  return (
    <div className="flex items-center gap-1.5" aria-busy={pending}>
      {pending && doing === 'start' && <span role="status" className="text-sm text-muted">Starting… this can take a moment.</span>}
      {status === 'draft' && isAdmin && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { dialog.current?.showModal(); }}>
          Start with overrides…
        </button>
      )}
      {(status === 'draft' || status === 'paused') && (
        <button type="button" className="btn btn-sm btn-primary disabled:opacity-60" disabled={pending} onClick={() => { run('start', startCampaignAction); }}>
          {pending && doing === 'start' ? (status === 'paused' ? 'Resuming…' : 'Starting…') : startLabel}
        </button>
      )}
      {status === 'running' && (
        <button type="button" className="btn btn-sm disabled:opacity-60" disabled={pending} onClick={() => { run('pause', pauseCampaignAction); }}>
          {pending && doing === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
      )}
      <button type="button" className="btn btn-sm btn-danger disabled:opacity-60" disabled={pending} onClick={() => { run('cancel', cancelCampaignAction); }}>
        {pending && doing === 'cancel' ? 'Cancelling…' : 'Cancel'}
      </button>

      {isAdmin && (
        // A native <dialog> opened with showModal() lives in the browser's top layer, so nothing on the page can cover it.
        <dialog ref={dialog} className="m-auto w-[min(32rem,92vw)] rounded-xl border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/50">
          <form
            onSubmit={(e) => { e.preventDefault(); run('start', startCampaignAction, new FormData(e.currentTarget)); }}
            className="flex flex-col gap-3 p-5 text-sm"
          >
            <h2 className="text-base font-semibold">Start with overrides</h2>
            <p className="text-muted">
              Send to people these rules would normally skip.
            </p>
            {Object.entries(GATE_LABEL).map(([gate, label]) => (
              <label key={gate} className="flex items-start gap-2">
                <input type="checkbox" name="overrideGates" value={gate} className="mt-1" />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted">If ticked: {GATE_EFFECT[gate]}</span>
                </span>
              </label>
            ))}
            <textarea
              name="reason" required minLength={10} maxLength={500} rows={2} placeholder="Why? (at least 10 characters, saved in the audit log)"
              className="w-full rounded-md border border-border bg-canvas p-2"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { dialog.current?.close(); }}>Back</button>
              <button type="submit" className="btn btn-sm btn-primary disabled:opacity-60" disabled={pending}>
                {pending && doing === 'start' ? 'Starting…' : 'Start, lifting the ticked rules'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}

/** Opens the overrides dialog from the cooldown warning (admins only). */
export function SendAnywayButton() {
  return (
    <button type="button" className="btn btn-sm" onClick={() => { window.dispatchEvent(new Event(OPEN_OVERRIDES)); }}>
      Send anyway…
    </button>
  );
}
