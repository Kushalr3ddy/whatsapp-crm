'use client';

import { useRef, useState, useTransition } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { sendReply, saveNote, sendAttachment } from '@/app/actions';
import type { CannedReply } from '@/lib/crm';

/** Fills `{{name}}` / `{{contact.name}}` placeholders from what the thread knows about the contact. */
function substitute(body: string, contactName: string | null): string {
  return body.replace(/\{\{\s*(?:contact\.)?name\s*\}\}/gi, contactName ?? '');
}

/**
 * The reply box.
 *
 * Two modes share it: a **reply**, which is queued for the gateway and sent to the contact, and
 * an **internal note**, which goes to a different endpoint and is never transmitted (F3, AC-4).
 * The mode is explicit and visible so an agent can never mistake one for the other — sending a
 * private note to the contact is exactly the accident this guards against.
 *
 * Addressed by conversation, not by number: a contact reaching us from a WhatsApp privacy
 * address has no phone, and the thread is still repliable — the gateway resolves the identity.
 *
 * Optimism is deliberately avoided: nothing is drawn into the thread until the API accepts it,
 * because a send can be refused and a message that then vanishes is worse than a short wait.
 */
export function Composer(
  { conversationId, to, cannedReplies, contactName, replyLocked, lockedBy }:
  {
    conversationId: string; to: string | null; cannedReplies: CannedReply[];
    contactName: string | null;
    /** True when the thread is assigned to another agent and I am not an admin — reply is blocked. */
    replyLocked: boolean;
    /** Who holds the thread, for the lock notice. Null when not locked. */
    lockedBy: string | null;
  }
) {
  // A locked thread opens in note mode: an internal note is always allowed (it is not sent to
  // the contact), only the reply to the contact is held by whoever has the thread.
  const [mode, setMode] = useState<'reply' | 'note'>(replyLocked ? 'note' : 'reply');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Sends the chosen file into the thread with whatever is typed as its caption. A file goes to the
   * contact, so it is only offered in reply mode and respects the same thread lock.
   */
  function sendFile(file: File) {
    if (pending || replyLocked) return;
    const form = new FormData();
    form.set('file', file);
    form.set('caption', text);
    setError(null);
    startTransition(async () => {
      const result = await sendAttachment(conversationId, form);
      if (result.ok) setText('');
      else setError(result.error ?? 'Failed.');
      if (fileInput.current) fileInput.current.value = '';
    });
  }

  /** Sends the current text down whichever path the mode selects, keeping it on a refusal. */
  function submit() {
    if (text.trim() === '' || pending) return;
    if (mode === 'reply' && replyLocked) return;
    const body = text;
    setError(null);
    startTransition(async () => {
      const result = mode === 'note'
        ? await saveNote(conversationId, body)
        : await sendReply(conversationId, body);
      if (result.ok) setText('');
      else setError(result.error ?? 'Failed.');
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

  /** Inserts a saved reply's body, with contact variables filled in, and returns to the box. */
  function insertCanned(id: string) {
    const reply = cannedReplies.find((c) => c.id === id);
    if (reply === undefined || replyLocked) return;
    setMode('reply');
    setText((current) => current + substitute(reply.body, contactName));
  }

  const isNote = mode === 'note';

  return (
    <form onSubmit={onSubmit} className="border-t border-border bg-surface px-5 py-3">
      {error !== null && <p className="mb-2 text-xs text-danger">{error}</p>}

      {replyLocked && (
        <p className="mb-2 rounded-md border border-border bg-canvas px-2.5 py-1.5 text-[11px] text-muted">
          Assigned to <span className="font-medium text-ink">{lockedBy}</span> — reassign it to yourself,
          or ask an admin, to reply. You can still add an internal note.
        </p>
      )}

      <div className="mb-2 flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border text-xs">
          <button
            type="button"
            onClick={() => { if (!replyLocked) setMode('reply'); }}
            disabled={replyLocked}
            className={`px-2.5 py-1 font-medium disabled:opacity-40 ${isNote ? 'text-muted' : 'bg-accent text-white'}`}
          >
            Reply
          </button>
          <button
            type="button"
            onClick={() => { setMode('note'); }}
            className={`px-2.5 py-1 font-medium ${isNote ? 'bg-accent text-white' : 'text-muted'}`}
          >
            Note
          </button>
        </div>

        {!isNote && cannedReplies.length > 0 && (
          <select
            aria-label="Insert a saved reply"
            value=""
            onChange={(e) => { insertCanned(e.target.value); }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value="">Saved reply…</option>
            {cannedReplies.map((c) => (
              <option key={c.id} value={c.id}>/{c.shortcut}</option>
            ))}
          </select>
        )}

        {isNote && <span className="text-[11px] text-muted">Internal — the contact never sees this.</span>}
      </div>

      <div className="flex items-end gap-2">
        {!isNote && (
          <>
            <input
              ref={fileInput} type="file" className="hidden" aria-label="Attach a file"
              accept="image/*,video/*,audio/*,application/pdf,.zip,.docx,.xlsx,.pptx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); }}
            />
            <button
              type="button" title="Attach a file (image, video, audio, PDF or Office document)"
              onClick={() => { fileInput.current?.click(); }}
              disabled={pending || replyLocked}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted disabled:opacity-40"
            >
              📎
            </button>
          </>
        )}
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={isNote ? 'Add an internal note' : to === null ? 'Reply' : `Message ${to}`}
          disabled={pending}
          className={[
            'max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60',
            isNote ? 'border-accent/40 bg-accent-soft focus:border-accent' : 'border-border bg-canvas focus:border-accent'
          ].join(' ')}
        />
        <button
          type="submit"
          disabled={pending || text.trim() === ''}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? (isNote ? 'Saving…' : 'Sending…') : isNote ? 'Add note' : 'Send'}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted">
        {isNote
          ? 'Saved to the thread for your team only.'
          : 'Queued for the gateway — the status under each message updates as it is sent.'}
      </p>
    </form>
  );
}
