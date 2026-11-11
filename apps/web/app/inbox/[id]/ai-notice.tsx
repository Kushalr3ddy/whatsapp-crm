'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AiNotice } from '@/lib/crm';
import { allowAiReplyAction } from '../../ai/actions';
import { retryAiAction } from '../actions';

/** The plain-words explanation for why the assistant is stuck. */
function explain(n: AiNotice): { title: string; detail: string } {
  if (n.code === 'do_not_contact') {
    return {
      title: 'The AI did not reply: this person is marked do not contact.',
      detail: 'Messages to people who asked not to be contacted are blocked. Only an admin can let one reply through, and doing so puts this number at risk of reports and a ban.'
    };
  }
  if (n.code === 'daily_cap') {
    return {
      title: 'The AI reached its daily message limit.',
      detail: 'It will answer again once the 24-hour window frees up. An admin can change the limit in AI assistant settings.'
    };
  }
  if (n.code === 'no_answer') {
    return {
      title: 'The AI sent no reply: the model gave an empty answer.',
      detail: 'This happens when a model runs out of room while thinking. A person should answer this chat, and an admin can try another model in AI assistant settings.'
    };
  }
  if (n.code === 'model_error') {
    return {
      title: 'The AI could not write a reply.',
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

/** Whether another try could help: a model that answered nothing or failed may do better, a blocked or capped one will not. */
function mayRetry(n: AiNotice): boolean {
  return n.code === 'no_answer' || n.code === 'model_error';
}

/**
 * The card at the end of the chat when the AI is held back on the customer's last message: what happened, the way to answer it yourself
 * ("Reply myself" takes the chat over), another try for the AI, and the admin's override where one exists.
 */
export function AiNoticeBanner(
  { conversationId, notice, isAdmin, aiOwned, onTakeOver, takingOver }:
  { conversationId: string; notice: AiNotice; isAdmin: boolean; aiOwned: boolean; onTakeOver: () => void; takingOver: boolean }
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { title, detail } = explain(notice);

  /** Sends the admin's reason; the server re-runs the assistant on the latest message for this one chat. */
  function allow(event: React.FormEvent): void {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await allowAiReplyAction(conversationId, reason);
      if (!result.ok) { setError(result.error ?? 'Could not do that.'); return; }
      setOpen(false);
      router.refresh();
    });
  }

  /** Asks the AI to answer the last message again. */
  function again(): void {
    setError(null);
    start(async () => {
      const result = await retryAiAction(conversationId);
      if (!result.ok) { setError(result.error ?? 'Could not do that.'); return; }
      router.refresh();
    });
  }

  return (
    <div role="alert" aria-label="AI assistant warning" className="ib-skip">
      <span><b>{title}</b> {detail}</span>
      <span className="ib-acts">
        {aiOwned && <button className="ib-btn ib-sm ib-p" type="button" disabled={takingOver} onClick={onTakeOver}>Reply myself</button>}
        {aiOwned && mayRetry(notice) && <button className="ib-btn ib-sm" type="button" disabled={pending} onClick={again}>Let the AI try again</button>}
        {notice.canOverride && isAdmin && !open && <button type="button" className="ib-btn ib-sm" onClick={() => { setOpen(true); }}>Allow reply anyway (ban risk)</button>}
      </span>
      {notice.canOverride && !isAdmin && <span className="ib-small">Ask an admin if this chat needs an answer.</span>}
      {open && (
        <form onSubmit={allow} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }} aria-label="Allow the AI to reply anyway">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 500, flex: '1 1 240px' }}>
            Why is this OK? (at least 10 characters, saved in the audit log)
            <input className="ib-in" value={reason} onChange={(e) => { setReason(e.target.value); }} minLength={10} maxLength={500} required />
          </label>
          <button type="submit" disabled={pending} className="ib-btn ib-p ib-sm">{pending ? 'Working…' : 'Allow this one reply'}</button>
          <button type="button" className="ib-btn ib-sm" onClick={() => { setOpen(false); }}>Cancel</button>
        </form>
      )}
      {error !== null && <span role="alert" className="ib-err">{error}</span>}
    </div>
  );
}
