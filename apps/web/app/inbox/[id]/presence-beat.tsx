'use client';

import { useEffect } from 'react';

/** How often an open thread says "still here" — under half the server's 30 s window. */
const BEAT_MS = 12_000;

/**
 * One presence ping. A plain `fetch`, not a server action, so it never queues in front of a send.
 * `keepalive` lets the goodbye leave as the page closes. Errors are ignored: a missed beat only
 * means the name lapses a little sooner.
 */
async function ping(conversationId: string, action: 'beat' | 'leave', keepalive = false): Promise<void> {
  try {
    await fetch(`/inbox/${encodeURIComponent(conversationId)}/live`, {
      method: 'POST', keepalive, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  } catch { /* best effort */ }
}

/**
 * Keeps this person listed as viewing the thread while it is open and the tab is visible.
 *
 * Beats immediately, then on a timer, pausing while the tab is hidden so a forgotten background
 * tab stops claiming the chat. Says goodbye on unmount; the server's expiry covers a tab that
 * is closed without one. Renders nothing.
 */
export function PresenceBeat({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    /** Beats only when someone could actually be looking at the tab. */
    const beat = () => {
      if (document.visibilityState === 'visible') void ping(conversationId, 'beat');
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
      void ping(conversationId, 'leave', true);
    };
  }, [conversationId]);

  return null;
}
