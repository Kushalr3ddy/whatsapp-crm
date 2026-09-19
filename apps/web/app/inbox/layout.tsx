import type { ReactNode } from 'react';
import Link from 'next/link';
import { listConversations, listSenders, CrmApiError } from '@/lib/crm';
import type { Conversation, Sender } from '@/lib/crm';
import { AutoRefresh } from './auto-refresh';
import { ThemeToggle } from '../theme-toggle';

/**
 * Rendered on every request, never prerendered.
 *
 * Without this the build reaches a running API, succeeds, and bakes that conversation list
 * into a static page — so production would serve whatever the inbox looked like at deploy
 * time. `no-store` on the fetch should imply it; saying it here makes it impossible to lose
 * to a refactor of the data layer.
 */
export const dynamic = 'force-dynamic';

/** Formats a timestamp for the conversation list: a time today, a date before that. */
function shortTime(iso: string | null): string {
  if (iso === null) return '';
  const when = new Date(iso);
  const today = new Date().toDateString() === when.toDateString();
  return today
    ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * The inbox shell: the conversation list on the left, the selected thread on the right.
 *
 * A layout rather than part of the page so that opening a thread does not re-render or
 * re-fetch the list, and the scroll position survives navigation.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  let conversations: Conversation[];
  let senders: Sender[];
  let failure: string | null = null;

  try {
    [conversations, senders] = await Promise.all([listConversations(), listSenders()]);
  } catch (error) {
    // The overwhelmingly likely cause is the API not running, so say that plainly rather
    // than showing a stack trace. Anything else still surfaces its own message.
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
    conversations = [];
    senders = [];
  }

  // `status` is the business state and is 'active' the moment a sender row is created, so it
  // would report a number as ready before anyone has scanned a QR. `connectionState` is the
  // live socket, which is the only thing that determines whether a send can leave.
  const connected = senders.filter((s) => s.connectionState === 'open');

  return (
    <div className="flex h-screen">
      <AutoRefresh seconds={5} />

      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Inbox</h1>
            <p className="mt-0.5 text-xs text-muted">
              {connected.length > 0
                ? `${String(connected.length)} number${connected.length === 1 ? '' : 's'} connected`
                : senders.length === 0
                  ? 'No number added'
                  : 'Not connected'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/link"
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-accent-soft"
            >
              Link
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {failure !== null && (
          <p className="border-b border-border px-4 py-3 text-xs text-danger">{failure}</p>
        )}

        {failure === null && connected.length === 0 && (
          <p className="border-b border-border px-4 py-3 text-xs text-muted">
            Nothing can be sent until a number is linked. Run <code>npm run gateway</code>, then{' '}
            <code>npm run wa:link</code> and scan the QR. Messages sent meanwhile stay queued.
          </p>
        )}

        <nav className="flex-1 overflow-y-auto">
          {conversations.length === 0 && failure === null ? (
            <p className="px-4 py-6 text-xs text-muted">
              No conversations yet. They appear here once a message is sent or received.
            </p>
          ) : (
            conversations.map((c) => (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                className="block border-b border-border px-4 py-3 hover:bg-accent-soft"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {c.contactName ?? c.contactPhone ?? 'Unknown'}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {shortTime(c.lastInboundAt ?? c.lastOutboundAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted">
                    {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                    {c.senderLabel !== null && ` · ${c.senderLabel}`}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </Link>
            ))
          )}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-canvas">{children}</main>
    </div>
  );
}
