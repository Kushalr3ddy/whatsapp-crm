'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** While a campaign is sending, re-reads the page every few seconds so the counts move on their own. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { router.refresh(); }, everyMs);
    return () => { clearInterval(t); };
  }, [router, everyMs]);
  return null;
}
