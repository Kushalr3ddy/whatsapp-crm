'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-fetches the server components on a timer.
 *
 * Polling, not push. Real-time delivery over SSE or WebSocket is a later slice of P4; until
 * then a short interval is enough for an inbox two people are watching, and it keeps the
 * server side free of connection state. `router.refresh()` re-runs the server components and
 * reconciles in place, so it does not clear what someone is typing.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => { router.refresh(); }, seconds * 1000);
    return () => { clearInterval(timer); };
  }, [router, seconds]);

  return null;
}
