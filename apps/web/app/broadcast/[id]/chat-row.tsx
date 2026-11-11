'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { loadChat } from './chat-actions';
import type { ChatResult, PanelMessage } from './chat-actions';
import { sendReply } from '../../actions';

/**
 * A recipient row that opens that person's chat in a side panel beside the list, so the campaign
 * never leaves the screen. The panel slides in (200 ms) and out (150 ms); Esc closes it at once.
 * The row's own content is rendered on the server and passed in as children.
 */
export function ChatRow(
  { chatId, label, children }: { chatId: string; label: string; children: ReactNode }
) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [chat, setChat] = useState<ChatResult | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => { void loadChat(chatId).then(setChat); }, [chatId]);

  const open = (): void => {
    setChat(null); setError(null); setText('');
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    reload();
  };
  const close = useCallback((instant: boolean): void => {
    setShown(false);
    window.setTimeout(() => { setMounted(false); rowRef.current?.focus(); }, instant ? 0 : 150);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(true); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, close]);

  useEffect(() => { if (shown) closeRef.current?.focus(); }, [shown]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [chat]);

  const send = (): void => {
    setError(null);
    startSend(async () => {
      const out = await sendReply(chatId, text);
      if (!out.ok) { setError(out.error ?? 'It did not send. Try again.'); return; }
      setText('');
      reload();
    });
  };

  const title = chat?.ok ? chat.title : label;
  const slide = shown ? 'translate-x-0 duration-200 ease-out' : 'translate-x-full duration-150 ease-in';

  return (
    <>
      <button
        ref={rowRef} type="button" onClick={open}
        className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        {children}
      </button>
      {mounted && createPortal(
        <>
          <div
            aria-hidden onClick={() => close(false)}
            className={`fixed inset-0 z-40 bg-black/35 transition-opacity ${shown ? 'opacity-100 duration-200' : 'opacity-0 duration-150'}`}
          />
          <aside
            role="dialog" aria-label={`Chat with ${title}`}
            className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)] transition-transform ${slide}`}
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{title}</p>
                {chat?.ok && chat.phone !== null && <p className="truncate font-mono text-xs text-muted">{chat.phone}</p>}
              </div>
              <button
                ref={closeRef} type="button" onClick={() => close(false)} aria-label="Close chat"
                className="flex size-11 items-center justify-center rounded-lg text-xl text-muted hover:text-ink"
              >
                ×
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-canvas p-4">
              {chat === null && <p className="text-sm text-muted">Loading the chat…</p>}
              {chat !== null && !chat.ok && <p className="notice notice-danger">{chat.error}</p>}
              {chat?.ok && chat.messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
              {chat?.ok && chat.messages.map((m) => <Bubble key={m.id} m={m} />)}
              <div ref={endRef} />
            </div>

            <footer className="border-t border-border p-3">
              {error !== null && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); if (text.trim() !== '') send(); }}
              >
                <input
                  value={text} onChange={(e) => setText(e.target.value)}
                  aria-label="Write a reply" placeholder="Write a reply" className="field min-w-0 flex-1"
                />
                <button type="submit" className="btn btn-primary" disabled={sending || text.trim() === ''} aria-busy={sending}>Send</button>
              </form>
            </footer>
          </aside>
        </>,
        document.body
      )}
    </>
  );
}

/** One message: yours on the right in the accent tint, theirs on the left. */
function Bubble({ m }: { m: PanelMessage }) {
  const mine = m.direction === 'outbound';
  return (
    <div className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${
      mine ? 'self-end border-transparent bg-accent-soft' : 'self-start border-border bg-surface'
    }`}>
      <p className="whitespace-pre-wrap break-words">{m.body}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {mine && m.status !== 'sent' ? ` · ${m.status}` : ''}
      </p>
    </div>
  );
}
