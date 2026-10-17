'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle';
import { signOut } from './login/actions';

/** One destination in the sidebar. `soon` marks a section that exists only as a placeholder. */
interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  /** Shown only to admins. */
  adminOnly?: boolean;
}

/** A 20px stroke icon. Decorative, so hidden from assistive tech — the label carries the meaning. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"
    >
      {children}
    </svg>
  );
}

const TABS: Tab[] = [
  {
    href: '/', label: 'Overview',
    icon: <Icon><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" /><rect x="3" y="15" width="7.5" height="6" rx="1.5" /></Icon>
  },
  {
    href: '/inbox', label: 'Inbox',
    icon: <Icon><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Icon>
  },
  {
    href: '/contacts', label: 'Contacts',
    icon: <Icon><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16.5 5.3a3 3 0 0 1 0 5.4M18 14.8c1.8.7 3 2.3 3 5.2" /></Icon>
  },
  {
    href: '/link', label: 'Numbers',
    icon: <Icon><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></Icon>
  },
  {
    href: '/import', label: 'Import',
    icon: <Icon><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></Icon>
  },
  {
    href: '/broadcast', label: 'Campaigns',
    icon: <Icon><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" /></Icon>
  },
  {
    href: '/team', label: 'Team', adminOnly: true,
    icon: <Icon><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M17 8v6M14 11h6" /></Icon>
  },
  {
    href: '/security', label: 'Security',
    icon: <Icon><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>
  },
  {
    href: '/billing', label: 'Billing', soon: true,
    icon: <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></Icon>
  }
];

/**
 * The app shell's navigation: a left sidebar on wide screens, a compact top bar on narrow ones.
 *
 * Sections are shown before they are built, marked "soon", rather than appearing later out of
 * nowhere — it makes the shape of the product legible, and makes it obvious that broadcasting
 * is a separate place rather than something that will appear inside the inbox.
 */
export function Nav({ alerts = 0, isAdmin = false }: { alerts?: number; isAdmin?: boolean }) {
  const pathname = usePathname();

  // Nothing to navigate to, and no one to sign out, before signing in.
  if (pathname === '/login' || pathname === '/signup') return null;

  return (
    <nav
      aria-label="Main"
      className="sidebar flex shrink-0 items-center gap-2 border-b px-3 py-2 md:w-60 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:border-r md:px-3 md:py-5"
    >
      <Link href="/" className="mr-2 flex items-center gap-2 px-2 md:mb-4 md:mr-0">
        <span className="avatar size-8 text-sm" aria-hidden>W</span>
        <span className="font-heading hidden text-[19px] font-semibold tracking-tight md:inline">WhatsApp CRM</span>
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex-none md:flex-col md:items-stretch md:overflow-visible">
        {TABS.filter((tab) => tab.adminOnly !== true || isAdmin).map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              title={tab.label}
              className="nav-link flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
            >
              {tab.icon}
              <span className="hidden md:inline">{tab.label}</span>
              {tab.href === '/link' && alerts > 0 && (
                <span
                  className="ml-auto rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white md:ml-auto"
                  title={`${String(alerts)} number${alerts === 1 ? '' : 's'} may be restricted`}
                >
                  {alerts}
                </span>
              )}
              {tab.soon === true && (
                <span className="hidden rounded-full bg-canvas px-1.5 text-[10px] text-muted md:inline">soon</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:mt-auto md:flex-col md:items-stretch md:border-t md:border-border md:pt-3">
        <div className="hidden items-center gap-2.5 px-1.5 pb-1 md:flex" aria-label={isAdmin ? 'Signed in as admin' : 'Signed in as user'}>
          <span className="avatar size-8 text-xs" aria-hidden>{isAdmin ? 'A' : 'U'}</span>
          <span className="min-w-0 text-sm leading-tight">
            <span className="block font-medium">{isAdmin ? 'Admin' : 'User'}</span>
            <span className="block text-xs text-muted">Signed in</span>
          </span>
        </div>
        <ThemeToggle />
        <form action={signOut} className="md:contents">
          <button type="submit" className="btn btn-ghost btn-sm w-full whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
