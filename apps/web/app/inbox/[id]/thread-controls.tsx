'use client';

import { useState, useTransition } from 'react';
import { updateThread, setParticipant } from '@/app/actions';
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
  { conversationId, users, assigneeUserId, status, participants, isAdmin }:
  {
    conversationId: string; users: OrgUser[]; assigneeUserId: string | null; status: string;
    participants: Array<{ userId: string; name: string }>; isAdmin: boolean;
  }
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

  /** Adds or removes one participant (admins only; the server enforces it too). */
  function toggleParticipant(userId: string, present: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setParticipant(conversationId, userId, present);
      if (!result.ok) setError(result.error ?? 'Could not update the participants.');
    });
  }

  const onThread = new Set(participants.map((p) => p.userId));
  // Anyone who could still be added: not the owner and not already on it.
  const addable = users.filter((u) => u.id !== assigneeUserId && !onThread.has(u.id));

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label="Assignee"
          value={assigneeUserId ?? ''}
          disabled={pending}
          onChange={(e) => { apply({ assigneeUserId: e.target.value === '' ? null : e.target.value }); }}
          className="field field-sm"
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
          className="btn btn-sm"
        >
          {status === 'closed' ? 'Reopen' : 'Resolve'}
        </button>
      </div>
      {(participants.length > 0 || isAdmin) && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted">
          <span>Also on this chat:</span>
          {participants.length === 0 && <span className="italic">nobody</span>}
          {participants.map((p) => (
            <span key={p.userId} className="badge">
              {p.name}
              {isAdmin && (
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  disabled={pending}
                  onClick={() => { toggleParticipant(p.userId, false); }}
                  className="ml-1"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {isAdmin && addable.length > 0 && (
            <select
              aria-label="Add participant"
              value=""
              disabled={pending}
              onChange={(e) => { if (e.target.value !== '') toggleParticipant(e.target.value, true); }}
              className="field field-sm"
            >
              <option value="">Add person…</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {error !== null && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
