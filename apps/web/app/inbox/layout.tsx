import type { ReactNode } from 'react';
import { InboxShell } from './inbox-shell';

/**
 * Rendered on every request, never prerendered.
 *
 * Without this the build reaches a running API, succeeds, and bakes a stale page into the build. The list itself is read by the
 * screen as it opens and again every few seconds, so nothing here is fetched at build time.
 */
export const dynamic = 'force-dynamic';

/**
 * The inbox shell: the search, the filters and the list of chats on the left, the chosen chat on the right.
 *
 * A layout rather than part of the page so that opening a chat does not re-render or re-fetch the list, and the scroll position and the
 * filters survive moving from one chat to the next.
 */
export default function InboxLayout({ children }: { children: ReactNode }) {
  return <InboxShell>{children}</InboxShell>;
}
