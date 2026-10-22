'use client';

import { useEffect, useState } from 'react';
import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/** How long a chip may stay loading before it says something is wrong. */
const SLOW_MS = 10_000;

/** A small spinner and "Loading…" inside a link while its page loads; after 10 seconds it says it is slow. */
function Pending() {
  const { pending } = useLinkStatus();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) { setSlow(false); return; }
    const t = setTimeout(() => { setSlow(true); }, SLOW_MS);
    return () => { clearTimeout(t); };
  }, [pending]);
  if (!pending) return null;
  return (
    <span role="status" className="ml-1.5 inline-flex items-center gap-1 text-xs">
      <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {slow ? 'Still loading… this is slow. Reload the page if it does not finish.' : 'Loading…'}
    </span>
  );
}

/**
 * One chip (a small rounded label) in the tag filter row. The page behind it is rendered on the server, so a click can take a moment
 * with nothing on screen to show it; the mark appears the instant the click lands. The active chip says so to
 * screen readers (`aria-current`).
 */
export function TagChip({ href, active, className, children }: {
  href: string; active: boolean; className: string; children: ReactNode;
}) {
  return (
    <Link href={href} className={className} aria-current={active ? 'true' : undefined}>
      {children}
      <Pending />
    </Link>
  );
}
