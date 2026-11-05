'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { sendReply, saveNote, sendAttachment, senderStatusAction } from '@/app/actions';
import type { CannedReply, SenderStatus } from '@/lib/crm';

/** How often the box re-checks that the number can send. */
const STATUS_POLL_MS = 8000;

/** At most one "I am typing" ping per this long while keys are being pressed (D-54). */
const TYPING_PING_MS = 3000;

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
  { conversationId, to, cannedReplies, contactName, replyLocked, lockedBy, initialStatus, doNotContact, isAdmin }:
  {
    conversationId: string; to: string | null; cannedReplies: CannedReply[];
    contactName: string | null;
    /** True when the thread is assigned to another agent and I am not an admin — reply is blocked. */
    replyLocked: boolean;
    /** Who holds the thread, for the lock notice. Null when not locked. */
    lockedBy: string | null;
    /** The number's state when the page loaded; the box keeps it fresh itself. Null if unknown. */
    initialStatus: SenderStatus | null;
    /** The contact is flagged do-not-contact: replies are blocked, or need an admin override. */
    doNotContact: boolean;
    isAdmin: boolean;
  }
) {
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [senderStatus, setSenderStatus] = useState<SenderStatus | null>(initialStatus);
  // A number that cannot send cannot take a reply: it would only sit queued. Notes still work.
  const numberDown = senderStatus !== null && !senderStatus.canSend;
  // Do-not-contact: an agent is simply blocked; an admin may override, with a reason (audited).
  const dncBlocked = doNotContact && !isAdmin;
  const dncNeedsOverride = doNotContact && isAdmin && !(overrideOn && overrideReason.trim().length >= 10);

  useEffect(() => {
    const timer = setInterval(() => {
      void senderStatusAction(conversationId).then((next) => { if (next !== null) setSenderStatus(next); });
    }, STATUS_POLL_MS);
    return () => { clearInterval(timer); };
  }, [conversationId]);

  // A locked thread opens in note mode: an internal note is always allowed (it is not sent to
  // the contact), only the reply to the contact is held by whoever has the thread.
  const [mode, setMode] = useState<'reply' | 'note'>(replyLocked || numberDown || dncBlocked ? 'note' : 'reply');

  // The number dropped while the box was open: drop to note mode so nothing typed is mistaken for a reply.
  useEffect(() => { if (numberDown) setMode('note'); }, [numberDown]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set when the API held a send because someone else just replied or is typing: the warning to
  // show, and the box offers "Send anyway" instead of a bare error.
  const [collision, setCollision] = useState<string | null>(null);
  const lastTypingPing = useRef(0);

  /** Pings "typing" while a reply (not a note) is being drafted, at most once per interval. */
  function noteTyping(next: string) {
    if (mode !== 'reply' || next.trim() === '') return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_MS) return;
    lastTypingPing.current = now;
    // A plain fetch, not a server action: actions run one at a time, and this must never queue
    // in front of the Send the person is about to press.
    void fetch(`/inbox/${encodeURIComponent(conversationId)}/live`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'typing' })
    }).catch(() => { /* best effort */ });
  }
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Sends the chosen file into the thread with whatever is typed as its caption. A file goes to the
   * contact, so it is only offered in reply mode and respects the same thread lock.
   */
  function sendFile(file: File) {
    if (pending || replyLocked || numberDown || doNotContact) return;
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

  /**
   * Sends the current text down whichever path the mode selects, keeping it on a refusal.
   * `anyway` is the second press after a collision warning: the person has seen that someone else
   * just replied or is typing, and sends regardless.
   */
  function submit(anyway = false) {
    if (text.trim() === '' || pending) return;
    if (mode === 'reply' && (replyLocked || numberDown || dncBlocked || dncNeedsOverride)) return;
    const body = text;
    setError(null);
    setCollision(null);
    startTransition(async () => {
      const result = mode === 'note'
        ? await saveNote(conversationId, body)
        : await sendReply(conversationId, body, doNotContact ? { reason: overrideReason.trim() } : undefined, anyway);
      if (result.ok) setText('');
      else if (result.collision === true) setCollision(result.error ?? 'Someone else is on this chat. Send anyway?');
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
    if (reply === undefined || replyLocked || numberDown || dncBlocked) return;
    setMode('reply');
    setText((current) => current + substitute(reply.body, contactName));
  }

  const isNote = mode === 'note';

  return (
    <form onSubmit={onSubmit} className="border-t border-border bg-surface px-5 py-3">
      {error !== null && <p className="mb-2 text-xs text-danger">{error}</p>}

      {collision !== null && (
        <div role="alert" className="mb-2 notice flex flex-wrap items-center justify-between gap-2">
          <span>{collision}</span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { submit(true); }}>
              Send anyway
            </button>
            <button type="button" className="btn btn-sm" onClick={() => { setCollision(null); }}>
              Wait
            </button>
          </span>
        </div>
      )}

      {doNotContact && (
        <div role="alert" className="mb-2 notice notice-danger">
          This contact is marked <strong>do not contact</strong>.
          {isAdmin ? (
            <>
              {' '}As an admin you can message them anyway, knowingly:
              <label className="mt-1 flex items-center gap-1.5">
                <input type="checkbox" checked={overrideOn} onChange={(e) => { setOverrideOn(e.target.checked); }} />
                Send anyway (override do-not-contact)
              </label>
              {overrideOn && (
                <input value={overrideReason} onChange={(e) => { setOverrideReason(e.target.value); }}
                  placeholder="Why? At least 10 characters — recorded in the audit log" aria-label="Override reason"
                  className="mt-1 w-full rounded-md border border-border bg-canvas px-2 py-1 text-ink" />
              )}
            </>
          ) : <> Replies are blocked. Ask an admin if this needs to go out. You can still add an internal note.</>}
        </div>
      )}

      {!numberDown && senderStatus !== null && (senderStatus.sessionTrouble ?? null) !== null && (
        <p role="alert" className="mb-2 notice notice-danger text-[13px]">
          <strong>The encryption session of {senderStatus.label} looks broken.</strong>{' '}
          {senderStatus.sessionTrouble === 'own'
            ? 'Messages you type on your own phone or WhatsApp Web cannot be read by this number, so they will not appear here. '
            : 'Messages from people to this number could not be decrypted, and the people you write to may see "Waiting for this message". '}
          Unlink the number and link it again on the Numbers page to fix it.
        </p>
      )}

      {numberDown && (
        <p role="alert" className="mb-2 notice notice-danger">
          The number <strong>{senderStatus.label}</strong> isn&apos;t connected — a reply wouldn&apos;t be sent. Reconnect it on the Numbers page.
          {' '}You can still add an internal note.
        </p>
      )}

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
            onClick={() => { if (!replyLocked && !numberDown && !dncBlocked) setMode('reply'); }}
            disabled={replyLocked || numberDown || dncBlocked}
            className={`px-2.5 py-1 font-medium disabled:opacity-40 ${isNote ? 'text-muted' : 'bg-accent text-on-accent'}`}
          >
            Reply
          </button>
          <button
            type="button"
            onClick={() => { setMode('note'); }}
            className={`px-2.5 py-1 font-medium ${isNote ? 'bg-accent text-on-accent' : 'text-muted'}`}
          >
            Note
          </button>
        </div>

        {!isNote && cannedReplies.length > 0 && (
          <select
            aria-label="Insert a saved reply"
            value=""
            onChange={(e) => { insertCanned(e.target.value); }}
            className="field field-sm"
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
              accept="image/*,video/*,audio/*,application/pdf,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); }}
            />
            <button
              type="button" title="Attach a file (image, video, audio, PDF or Office document)"
              onClick={() => { fileInput.current?.click(); }}
              disabled={pending || replyLocked || numberDown || doNotContact}
              className="btn btn-sm"
            >
              📎
            </button>
          </>
        )}
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); noteTyping(e.target.value); setCollision(null); }}
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
          className="btn btn-primary"
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
