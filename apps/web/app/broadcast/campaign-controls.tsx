'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { startCampaignAction, pauseCampaignAction, cancelCampaignAction, startCheckAction } from './actions';
import {
  GATE_LABEL, GATE_EFFECT, SEND_ANYWAY_REASON, OTHER_NUMBER_NOTE, liveCampaignSentence, recentWarning, unknownFillInSentence
} from './gates';
import type { CampaignPreview } from '@/lib/crm';

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
  const liveDialog = useRef<HTMLDialogElement>(null);
  const leaveOut = useRef<HTMLButtonElement>(null);
  const unknownDialog = useRef<HTMLDialogElement>(null);
  const pendingExtra = useRef<FormData | null>(null);
  // What the draft would do before it starts: shown as the warning lines, and read again when Start is pressed.
  const [check, setCheck] = useState<CampaignPreview | null>(null);

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

  // A draft says up front who it would overlap with (CW-6.6a AC3, AC4).
  useEffect(() => {
    if (status !== 'draft') return;
    let live = true;
    void startCheckAction(id).then((c) => { if (live) setCheck(c); });
    return () => { live = false; };
  }, [id, status]);

  if (status === 'completed' || status === 'cancelled') return null;

  /** Starts, after the two questions that need a person: still in a live campaign on this number, and `{{keys}}` that are not columns. */
  async function begin(): Promise<void> {
    const fresh = status === 'draft' ? await startCheckAction(id) : null;
    setCheck(fresh);
    if ((fresh?.audience.sameNumberLive ?? 0) > 0) {
      liveDialog.current?.showModal();
      leaveOut.current?.focus();
      return;
    }
    afterLive(fresh);
  }

  /** The next question once the live-campaign one is settled: a fill-in that is not a column needs an explicit yes (CW-7.7 AC4). */
  function afterLive(c: CampaignPreview | null, extra?: FormData): void {
    if ((c?.unknownFillIns ?? []).length > 0) {
      unknownDialog.current?.showModal();
      pendingExtra.current = extra ?? null;
      return;
    }
    run('start', startCampaignAction, extra);
  }

  /** "Send anyway": lifts the live-campaign check for this campaign. The API only lets an admin do this, and audits it. */
  function sendAnyway(): void {
    liveDialog.current?.close();
    const fd = new FormData();
    fd.append('overrideGates', 'duplicate_campaign');
    fd.set('reason', SEND_ANYWAY_REASON);
    afterLive(check, fd);
  }

  /** Runs one control on the server, with every button off until it is done. */
  function run(kind: 'start' | 'pause' | 'cancel', action: (fd: FormData) => Promise<void>, extra?: FormData): void {
    const fd = extra ?? new FormData();
    fd.set('id', id);
    setDoing(kind);
    startTransition(async () => { await action(fd); setDoing(null); dialog.current?.close(); });
  }

  const startLabel = status === 'paused' ? 'Resume' : 'Start';
  const audience = check?.audience;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
      {status === 'draft' && audience !== undefined && (
        <div className="basis-full text-sm text-muted">
          {(audience.recentlyMessaged ?? 0) > 0 && <p data-testid="warning-recent">{recentWarning(audience.recentlyMessaged ?? 0)}</p>}
          {(audience.otherNumberOverlap ?? 0) > 0 && <p data-testid="note-other-number">{OTHER_NUMBER_NOTE}</p>}
        </div>
      )}
      {pending && doing === 'start' && <span role="status" className="text-sm text-muted">Starting… this can take a moment.</span>}
      {status === 'draft' && isAdmin && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { dialog.current?.showModal(); }}>
          Start with overrides…
        </button>
      )}
      {status === 'draft' && (
        <Link href={`/broadcast/new?edit=${id}`} className="btn btn-sm" aria-disabled={pending}>Edit</Link>
      )}
      {(status === 'draft' || status === 'paused') && (
        <button type="button" className="btn btn-sm btn-primary disabled:opacity-60" disabled={pending} onClick={() => { void begin(); }}>
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

      {/* The red confirm for people still in a live campaign on this number. A native <dialog>: Esc closes it and starts nothing. */}
      <dialog
        ref={liveDialog} aria-labelledby="live-confirm-title" aria-describedby="live-confirm-text"
        className="m-auto w-[min(32rem,92vw)] rounded-xl border border-danger bg-surface p-0 text-ink shadow-xl backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-3 p-5 text-sm">
          <h2 id="live-confirm-title" className="text-base font-semibold">Some of these people are still in another campaign</h2>
          <p id="live-confirm-text" role="alert" className="notice notice-danger">
            {liveCampaignSentence(audience?.sameNumberLive ?? 0, audience?.sameNumberLiveCampaign ?? null, audience?.senderPhone ?? null)}
          </p>
          <div className="flex justify-end gap-2">
            {isAdmin && <button type="button" className="btn btn-sm" onClick={sendAnyway}>Send anyway</button>}
            <button
              ref={leaveOut} type="button" className="btn btn-sm btn-primary"
              onClick={() => { liveDialog.current?.close(); afterLive(check); }}
            >
              Leave them out
            </button>
          </div>
          {!isAdmin && <p className="text-xs text-muted">Only an admin can send to them anyway.</p>}
        </div>
      </dialog>

      {/* A {{key}} that is not a column is blank for everyone: starting needs an explicit yes (CW-7.7 AC4). */}
      <dialog
        ref={unknownDialog} aria-labelledby="unknown-confirm-title"
        className="m-auto w-[min(32rem,92vw)] rounded-xl border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-3 p-5 text-sm">
          <h2 id="unknown-confirm-title" className="text-base font-semibold">The message has a fill-in that is not a column</h2>
          <ul className="list-disc pl-5">
            {(check?.unknownFillIns ?? []).map((u) => <li key={u.key}>{unknownFillInSentence(u.key, u.suggestion)}</li>)}
          </ul>
          <p className="text-muted">It will be blank for everyone if you send now.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => { unknownDialog.current?.close(); }}>Go back and fix it</button>
            <button
              type="button" className="btn btn-sm"
              onClick={() => {
                unknownDialog.current?.close();
                const fd = pendingExtra.current ?? new FormData();
                fd.set('confirmUnknownFillIns', 'yes');
                run('start', startCampaignAction, fd);
              }}
            >
              Send with blanks
            </button>
          </div>
        </div>
      </dialog>

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
