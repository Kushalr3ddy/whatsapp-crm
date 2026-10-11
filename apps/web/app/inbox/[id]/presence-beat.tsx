'use client';

import { useEffect } from 'react';
import { heartbeat } from '@/app/actions';

/** How often an open thread says "still here" — under half the server's 30 s window. */
const BEAT_MS = 12_000;

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
      if (document.visibilityState === 'visible') void heartbeat(conversationId, true);
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
      void heartbeat(conversationId, false);
    };
  }, [conversationId]);

  return null;
}
