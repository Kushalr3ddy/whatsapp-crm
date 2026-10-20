'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/** A small pulsing mark inside a link while its page is loading, so a click visibly does something. */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden className="ml-1 animate-pulse">…</span> : null;
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
