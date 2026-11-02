'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AiNotice } from '@/lib/crm';
import { allowAiReplyAction } from '../../ai/actions';

/** The plain-words explanation for why the assistant is stuck. */
function explain(n: AiNotice): { title: string; detail: string } {
  if (n.code === 'do_not_contact') {
    return {
      title: 'The AI assistant did not reply: this contact is marked do-not-contact.',
      detail: 'Messages to people who asked not to be contacted are blocked. Only an admin can let one reply through, and doing so puts this number at risk of reports and a ban.'
    };
  }
  if (n.code === 'daily_cap') {
    return {
      title: 'The AI assistant reached its daily message limit.',
      detail: 'It will answer again once the 24-hour window frees up. An admin can change the limit in AI assistant settings.'
    };
  }
  if (n.code === 'no_answer') {
    return {
      title: 'The AI assistant sent no reply: the model gave an empty answer.',
      detail: 'This happens when a model runs out of room while thinking. A person should answer this chat, and an admin can try another model in AI assistant settings.'
    };
  }
  if (n.code === 'model_error') {
    return {
      title: 'The AI assistant could not write a reply.',
      detail: `The AI provider did not answer (${n.reason.replace(/^model_/, '')}). A person should answer this chat.`
    };
  }
  if (n.reason === 'sender_not_connected') {
    return { title: 'The AI’s reply is waiting: the number isn’t connected.', detail: 'It will be sent when the number is linked again.' };
  }
  return {
    title: 'The AI’s reply is waiting.',
    detail: `It will go out on its own (${n.reason}).`
  };
}

/** A warning above the composer when the AI assistant is held back, with the admin's override where one exists. */
export function AiNoticeBanner({ conversationId, notice, isAdmin }: { conversationId: string; notice: AiNotice; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { title, detail } = explain(notice);

  /** Sends the admin's reason; the server re-runs the assistant on the latest message for this one chat. */
  function allow(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await allowAiReplyAction(conversationId, reason);
      if (!result.ok) { setError(result.error ?? 'Could not do that.'); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div role="alert" aria-label="AI assistant warning" className="notice notice-warning mx-5 mb-3">
      <p className="font-semibold">⚠ {title}</p>
      <p className="mt-1 text-sm">{detail}</p>
      {notice.canOverride && isAdmin && !open && (
        <button type="button" className="btn btn-sm mt-2" onClick={() => { setOpen(true); }}>Allow reply anyway (ban risk)</button>
      )}
      {notice.canOverride && !isAdmin && <p className="mt-1 text-sm font-medium">Ask an admin if this chat needs an answer.</p>}
      {open && (
        <form onSubmit={allow} className="mt-2 flex flex-wrap items-end gap-2" aria-label="Allow the AI to reply anyway">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-medium">
            Why is this OK? (at least 10 characters, saved in the audit log)
            <input value={reason} onChange={(e) => { setReason(e.target.value); }} minLength={10} maxLength={500} required className="field font-normal text-ink" />
          </label>
          <button type="submit" disabled={pending} className="btn btn-primary btn-sm">{pending ? 'Working…' : 'Allow this one reply'}</button>
          <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); }}>Cancel</button>
          {error !== null && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
        </form>
      )}
    </div>
  );
}
