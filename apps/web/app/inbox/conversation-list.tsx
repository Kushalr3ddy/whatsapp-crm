'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Conversation } from '@/lib/crm';

/** Which threads to show, by owner. `mine` needs a signed-in user; a key never sees these tabs. */
type AssigneeFilter = 'all' | 'mine' | 'unassigned';

/** Which threads to show, by state. Open is the working view; closed is the archive. */
type StatusFilter = 'open' | 'closed' | 'all';

/** One or two letters for an avatar: the first letters of the first two words, or the last digit pair of a number. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (/^\d+$/.test(words[0]!)) return words[0]!.slice(-2);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

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
 * One filter tab. Highlighted when active; a button rather than a link because the filtering
 * is client-side over an already-fetched list — no navigation, no refetch.
 */
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-accent text-on-accent shadow-sm' : 'text-muted hover:bg-accent-soft'
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/**
 * The conversation list with its filters.
 *
 * Client-side: the layout fetches every recent thread once, and filtering here keeps switching
 * views instant and avoids a refetch when someone opens a thread — the reason the list lives in
 * the layout at all. Filter state is held in `useState`, which survives both the periodic
 * `router.refresh()` and navigating between threads, because the layout never remounts.
 *
 * `currentUserId` is null for an API-key session, which has no "mine"; the Mine tab is then
 * hidden rather than shown broken.
 */
export function ConversationList(
  { conversations, currentUserId }: { conversations: Conversation[]; currentUserId: string | null }
) {
  const [assignee, setAssignee] = useState<AssigneeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('open');

  const shown = conversations.filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    // Mine = owned or participating, matching the API's `assignee=me`.
    if (assignee === 'mine') {
      return c.assigneeUserId === currentUserId
        || c.participants.some((p) => p.userId === currentUserId);
    }
    if (assignee === 'unassigned') return c.assigneeUserId === null;
    return true;
  });

  return (
    <>
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {currentUserId !== null && (
            <Tab label="Mine" active={assignee === 'mine'} onClick={() => { setAssignee('mine'); }} />
          )}
          <Tab label="Unassigned" active={assignee === 'unassigned'} onClick={() => { setAssignee('unassigned'); }} />
          <Tab label="All" active={assignee === 'all'} onClick={() => { setAssignee('all'); }} />
        </div>
        <div className="flex items-center gap-1">
          <Tab label="Open" active={status === 'open'} onClick={() => { setStatus('open'); }} />
          <Tab label="Closed" active={status === 'closed'} onClick={() => { setStatus('closed'); }} />
          <Tab label="Any" active={status === 'all'} onClick={() => { setStatus('all'); }} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted">
            {conversations.length === 0
              ? 'No conversations yet. They appear here once a message is sent or received.'
              : 'No conversations match this filter.'}
          </p>
        ) : (
          shown.map((c) => {
            const title = c.contactName ?? c.contactPhone ?? 'Unknown';
            return (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                className="flex items-start gap-3 border-b border-border px-4 py-3 hover:bg-canvas"
              >
                <span className="avatar mt-0.5 size-9 text-sm" aria-hidden>{initials(title)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unreadCount > 0 ? 'font-semibold' : 'font-medium'}`}>
                      {title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {shortTime(c.lastInboundAt ?? c.lastOutboundAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted">
                      {c.queuedCount > 0 && (
                        <span
                          className="mr-1 text-danger"
                          title={`${String(c.queuedCount)} message${c.queuedCount === 1 ? '' : 's'} queued — not sent yet`}
                        >
                          ⚠
                        </span>
                      )}
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                      {c.senderLabel !== null && ` · ${c.senderLabel}`}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="badge badge-accent shrink-0 tabular-nums">{c.unreadCount}</span>
                    )}
                  </span>
                  {/* The owner, so the list answers "whose is this?" without opening it — the whole
                      point of assignment. Closed threads say so too, since the status filter can
                      show them. */}
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={[
                        'truncate text-[11px]',
                        c.assigneeName === null ? 'italic text-muted' : 'text-ink/70'
                      ].join(' ')}
                    >
                      {c.assigneeName ?? 'Unassigned'}
                      {c.participants.length > 0 && ` +${String(c.participants.length)}`}
                    </span>
                    {c.viewers.length > 0 && (
                      <span className="truncate text-[11px] text-accent" title="Viewing now">
                        ● {c.viewers.map((v) => v.name).join(', ')}
                      </span>
                    )}
                    {c.status === 'closed' && <span className="badge">closed</span>}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </nav>
    </>
  );
}
