'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** How often the watcher asks whether a number's link state has changed. */
const WATCH_MS = 5000;

/**
 * Keeps an open page honest about which numbers are linked (R-017).
 *
 * Every page reads the link state once, when it renders. When WhatsApp drops a number (the phone removed the device, a
 * ban) the gateway records it within a second, but an open page went on saying "Linked" until someone reloaded.
 * `signature` is the state the page was rendered with; every few seconds this compares it with the server's current one
 * and re-renders the page, server components and all, only when they differ. Nothing is shown and nothing is polled
 * while the tab is hidden.
 */
export function ConnectionWatch({ signature }: { signature: string }) {
  const router = useRouter();
  const seen = useRef(signature);

  // A refresh brings a new signature down from the layout: that is the state the page now shows.
  useEffect(() => { seen.current = signature; }, [signature]);

  useEffect(() => {
    let stopped = false;
    const check = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const res = await fetch('/numbers/state', { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const { data } = (await res.json()) as { data: string };
        if (data === seen.current) return;
        // Remembered now, so a slow refresh is not asked for again on the next beat.
        seen.current = data;
        router.refresh();
      } catch {
        // Offline or a restart: try again on the next beat.
      }
    };
    const timer = setInterval(() => { void check(); }, WATCH_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [router]);

  return null;
}
