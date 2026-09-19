'use client';

import { useState, useTransition } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { sendReply } from '@/app/actions';

/**
 * The reply box.
 *
 * Optimism is deliberately avoided: the message is not drawn into the thread until the API
 * has accepted it. A send can be refused — an unreachable number, no linked sender — and
 * showing a message that then vanishes is worse than a half-second wait.
 */
export function Composer({ to }: { to: string | null }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Sends the current text, keeping it in the box if the API refuses it. */
  function submit() {
    if (to === null || text.trim() === '' || pending) return;
    const body = text;
    setError(null);
    startTransition(async () => {
      const result = await sendReply(to, body);
      if (result.ok) setText('');
      else setError(result.error ?? 'Send failed.');
    });
  }

  /** Enter sends; Shift+Enter starts a new line, as in every other chat client. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  /** Handles the form's own submit, so the button and the Enter key share one path. */
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  if (to === null) {
    return (
      <div className="border-t border-border bg-surface px-5 py-3">
        <p className="text-xs text-muted">
          This contact has no phone number on file, so there is nothing to reply to.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-border bg-surface px-5 py-3">
      {error !== null && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`Message ${to}`}
          disabled={pending}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || text.trim() === ''}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Queued for the gateway — the status under each message updates as it is sent.
      </p>
    </form>
  );
}
