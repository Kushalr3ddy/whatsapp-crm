'use client';

import { useState, useTransition } from 'react';
import type { AiSettings } from '@/lib/crm';
import { saveAiAction } from './actions';

/** The settings form: consent, the on/off switch, the instructions and the daily limit. */
export function AiPanel({ settings, rules }: { settings: AiSettings; rules: string[] }) {
  const consented = settings.consentAcceptedAt !== null;
  const [consent, setConsent] = useState(consented);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [instructions, setInstructions] = useState(settings.instructions);
  const [cap, setCap] = useState(String(settings.dailyMessageCap));
  const [mayStart, setMayStart] = useState(settings.mayStartCampaigns);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  /** Sends the form; the server refuses to switch on without the consent. */
  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveAiAction({
        enabled, instructions, dailyMessageCap: Number(cap), mayStartCampaigns: mayStart, ...(consent && !consented ? { acceptConsent: true } : {})
      });
      if (!result.ok) { setError(result.error ?? 'Could not save.'); return; }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={save} className="mt-6 flex flex-col gap-5" aria-label="AI assistant settings">
      <section className="card p-5">
        <h2 className="text-base font-semibold">Before you switch it on</h2>
        <p className="mt-2 text-sm text-muted">
          To write replies, the assistant sends the messages of the conversations assigned to it, including the contact’s
          name and what they wrote, to the AI provider your deployment is set up with. Only turn it on if your contacts
          have been told this and the provider’s terms suit you.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox" checked={consent} disabled={consented}
            onChange={(e) => { setConsent(e.target.checked); if (!e.target.checked) setEnabled(false); }}
            className="mt-1"
          />
          <span>
            I understand that contact messages are shared with the AI provider.
            {consented && <span className="ml-2 text-xs text-muted">Accepted {new Date(settings.consentAcceptedAt ?? '').toLocaleDateString()}</span>}
          </span>
        </label>
      </section>

      <section className="card p-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} disabled={!consent} onChange={(e) => { setEnabled(e.target.checked); }} />
          AI assistant is on
        </label>
        <p className="mt-1 text-xs text-muted">
          When on, an “AI assistant” member appears in the team. Assign a conversation to it to hand the chat over; assign it back to a person to take over.
        </p>

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium">
          <span>What it may talk about, and how <span className="font-normal text-muted">(instructions for the AI)</span></span>
          <textarea
            value={instructions} onChange={(e) => { setInstructions(e.target.value); }} rows={6} maxLength={8000}
            placeholder="You answer questions for Acme Hiring: job openings, interview timings and documents. Be short and polite. If unsure, say a person will follow up."
            className="field font-normal"
          />
        </label>

        {rules.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Always added automatically, and not editable: {rules.map((r) => r.replace(/\.$/, '')).join('. ')}.
          </p>
        )}

        <label className="mt-4 flex max-w-xs flex-col gap-1 text-sm font-medium">
          Most messages it may send in a day
          <input
            type="number" min={1} max={5000} value={cap} onChange={(e) => { setCap(e.target.value); }}
            className="field font-normal"
          />
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={mayStart} onChange={(e) => { setMayStart(e.target.checked); }} className="mt-1" />
          <span>
            The assistant may start and resume campaigns by itself
            <span className="block text-xs text-muted">
              Off (recommended): it prepares a campaign and an admin presses Start. Either way it can never lift a do-not-contact or other gate.
            </span>
          </span>
        </label>
      </section>

      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      {saved && <p role="status" className="notice notice-success">Saved.</p>}
      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
