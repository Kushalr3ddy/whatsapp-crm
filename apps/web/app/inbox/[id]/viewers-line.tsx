'use client';

import { useEffect, useState } from 'react';
import type { Viewer } from '@/lib/crm';

/** How often the header re-reads who is here. Short, because "typing" lasts only a few seconds. */
const POLL_MS = 2500;

/**
 * "Priya is typing…" / "Priya is viewing" under the thread title.
 *
 * Starts from what the page rendered, then polls a small route handler of its own: the page's
 * 5 s full refresh is too slow for a typing indicator that expires in about 8 s, and a server
 * action would queue in front of the person's own send. Typing outranks
 * viewing, so the line is as specific as the evidence allows. Renders nothing when alone.
 */
export function ViewersLine({ conversationId, initial }: { conversationId: string; initial: Viewer[] }) {
  const [viewers, setViewers] = useState<Viewer[]>(initial);

  useEffect(() => {
    let live = true;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch(`/inbox/${encodeURIComponent(conversationId)}/live`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() as Promise<{ data: Viewer[] }> : null))
        .then((body) => { if (live && body !== null) setViewers(body.data); })
        .catch(() => { /* keep what is shown */ });
    };
    const timer = setInterval(tick, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [conversationId]);

  if (viewers.length === 0) return null;
  const typing = viewers.filter((v) => v.typing);
  const others = viewers.filter((v) => !v.typing);
  const join = (list: Viewer[]) => list.map((v) => v.name).join(', ');
  return (
    <p className="truncate text-[11px] font-medium text-accent" aria-live="polite">
      ● {typing.length > 0 && `${join(typing)} ${typing.length === 1 ? 'is' : 'are'} typing…`}
      {typing.length > 0 && others.length > 0 && ' · '}
      {others.length > 0 && `${join(others)} ${others.length === 1 ? 'is' : 'are'} viewing`}
    </p>
  );
}
