'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';
import { signOut } from './login/actions';

/** One destination in the top bar. `soon` marks a section that exists only as a placeholder. */
interface Tab {
  href: string;
  label: string;
  soon?: boolean;
}

const TABS: Tab[] = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/link', label: 'Numbers' },
  { href: '/import', label: 'Import' },
  { href: '/broadcast', label: 'Broadcast', soon: true },
  { href: '/billing', label: 'Billing', soon: true }
];

/**
 * The top bar.
 *
 * Sections are shown before they are built, marked "soon", rather than appearing later out of
 * nowhere — it makes the shape of the product legible, and makes it obvious that broadcasting
 * is a separate place rather than something that will appear inside the inbox.
 */
export function Nav() {
  const pathname = usePathname();

  // Nothing to navigate to, and no one to sign out, before signing in.
  if (pathname === '/login') return null;

  return (
    <nav className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
      <div className="flex items-center gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={[
                'rounded-md px-2.5 py-1 text-xs',
                active ? 'bg-accent-soft font-medium text-ink' : 'text-muted hover:bg-accent-soft'
              ].join(' ')}
            >
              {tab.label}
              {tab.soon === true && (
                <span className="ml-1 text-[10px] text-muted">soon</span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-accent-soft"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
