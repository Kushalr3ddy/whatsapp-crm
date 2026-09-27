'use client';

import { useState, useTransition } from 'react';
import { updateThread } from '@/app/actions';
import type { OrgUser } from '@/lib/crm';

/**
 * The assignee picker and open/closed toggle for one thread.
 *
 * Client-side so the two controls can show a pending state and an error inline — reassigning is
 * something a colleague can race on, so a rejected change is an ordinary outcome to display,
 * not a crash. Both call the same `updateThread` action, which revalidates the inbox so the
 * list and this header agree afterwards.
 */
export function ThreadControls(
  { conversationId, users, assigneeUserId, status }:
  { conversationId: string; users: OrgUser[]; assigneeUserId: string | null; status: string }
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Applies one change, surfacing a rejection rather than throwing it. */
  function apply(patch: { status?: 'open' | 'closed'; assigneeUserId?: string | null }) {
    setError(null);
    startTransition(async () => {
      const result = await updateThread(conversationId, patch);
      if (!result.ok) setError(result.error ?? 'Could not update the thread.');
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label="Assignee"
          value={assigneeUserId ?? ''}
          disabled={pending}
          onChange={(e) => { apply({ assigneeUserId: e.target.value === '' ? null : e.target.value }); }}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={() => { apply({ status: status === 'closed' ? 'open' : 'closed' }); }}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-accent-soft disabled:opacity-50"
        >
          {status === 'closed' ? 'Reopen' : 'Resolve'}
        </button>
      </div>
      {error !== null && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
