'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Longest the bar stays up if a page never finishes, so it can never be left spinning for ever. */
const GIVE_UP_MS = 20_000;

/**
 * Shows that a click was heard. In development (and on a slow connection) a page can take seconds to arrive, and with
 * nothing moving it looks as if the click did nothing. On any in-app link click this puts a bar across the top of the
 * window and dims the link that was pressed, then clears both when the new page's address appears.
 *
 * It works on the page's attributes directly and holds no React state on purpose: a state update on every click made
 * Next's own navigation slower, which is the opposite of what a loading cue is for. The bar is always in the page and
 * only shown by CSS while `<html data-navigating>` is set.
 */
export function NavProgress() {
  const pathname = usePathname();

  // A new address means the page has arrived: stop the bar and un-dim every link.
  useEffect(() => {
    document.documentElement.removeAttribute('data-navigating');
    for (const a of document.querySelectorAll('a[data-pending]')) a.removeAttribute('data-pending');
  }, [pathname]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Starts the bar for a plain left-click on a link to another page of this app. */
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest('a');
      if (link === null || link === undefined || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      link.setAttribute('data-pending', 'true');
      document.documentElement.setAttribute('data-navigating', 'true');
      clearTimeout(timer);
      timer = setTimeout(() => { document.documentElement.removeAttribute('data-navigating'); }, GIVE_UP_MS);
    };
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('click', onClick); clearTimeout(timer); };
  }, []);

  return <div role="progressbar" aria-label="Loading the next page" aria-hidden className="nav-progress" />;
}
