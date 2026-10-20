import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listConversations, listSenders, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Conversation, Sender, Me } from '@/lib/crm';
import { AutoRefresh } from './auto-refresh';
import { ConversationList } from './conversation-list';

/**
 * Rendered on every request, never prerendered.
 *
 * Without this the build reaches a running API, succeeds, and bakes that conversation list
 * into a static page — so production would serve whatever the inbox looked like at deploy
 * time. `no-store` on the fetch should imply it; saying it here makes it impossible to lose
 * to a refactor of the data layer.
 */
export const dynamic = 'force-dynamic';

/**
 * The inbox shell: the conversation list on the left, the selected thread on the right.
 *
 * A layout rather than part of the page so that opening a thread does not re-render or
 * re-fetch the list, and the scroll position survives navigation.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  let conversations: Conversation[];
  let senders: Sender[];
  let me: Me | null = null;
  let failure: string | null = null;
  let expired = false;

  try {
    [conversations, senders, me] = await Promise.all([listConversations(), listSenders(), getMe()]);
  } catch (error) {
    // The session was rejected by the API — the cookie exists but is no longer valid, so
    // middleware let it through. Signing in again is the only useful response.
    if (error instanceof NotAuthenticatedError) expired = true;
    // The overwhelmingly likely cause is the API not running, so say that plainly rather
    // than showing a stack trace. Anything else still surfaces its own message.
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
    conversations = [];
    senders = [];
  }

  // Outside the catch: redirect() works by throwing, so calling it inside would be caught.
  if (expired) redirect('/login?next=/inbox');

  // `status` is the business state and is 'active' the moment a sender row is created, so it
  // would report a number as ready before anyone has scanned a QR. `connectionState` is the
  // live socket, which is the only thing that determines whether a send can leave.
  const connected = senders.filter((s) => s.connectionState === 'open');

  return (
    <div className="flex h-full">
      <AutoRefresh seconds={5} />

      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <header className="border-b border-border px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
            <p className="mt-0.5 text-xs text-muted">
              {connected.length > 0
                ? `${String(connected.length)} number${connected.length === 1 ? '' : 's'} connected`
                : senders.length === 0
                  ? 'No number added'
                  : 'Not linked'}
            </p>
          </div>
        </header>

        {failure !== null && (
          <p className="border-b border-border px-4 py-3 text-xs text-danger">{failure}</p>
        )}

        {failure === null && connected.length === 0 && (
          <p className="border-b border-border px-4 py-3 text-xs text-muted">
            Nothing can be sent until a number is linked. Add one on the{' '}
            <Link href="/link" className="underline underline-offset-2">Numbers page</Link> and scan its QR.
            Messages sent meanwhile stay queued.
          </p>
        )}

        {failure === null && (
          <ConversationList conversations={conversations} currentUserId={me?.userId ?? null} />
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-canvas">{children}</main>
    </div>
  );
}
