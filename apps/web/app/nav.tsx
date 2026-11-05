'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bot, CreditCard, Download, LayoutDashboard, Lock, Megaphone, Menu, MessageSquare, Smartphone, UserPlus, Users, X,
  type LucideIcon
} from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { signOut } from './login/actions';
import { SubmitButton } from './contacts/submit-button';
import { ReportProblem } from './report-problem';

/** One destination in the sidebar. `soon` marks a section that exists only as a placeholder. */
interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  /** Shown only to admins. */
  adminOnly?: boolean;
}

const TABS: Tab[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/link', label: 'Linked numbers', icon: Smartphone },
  { href: '/import', label: 'Import', icon: Download },
  { href: '/broadcast', label: 'Campaigns', icon: Megaphone },
  { href: '/team', label: 'Team', icon: UserPlus, adminOnly: true },
  { href: '/ai', label: 'AI assistant', icon: Bot, adminOnly: true },
  { href: '/security', label: 'Security', icon: Lock },
  { href: '/billing', label: 'Billing', icon: CreditCard, soon: true }
];

/**
 * The app shell's navigation: a left sidebar on wide screens, a top bar with one menu button on narrow ones.
 *
 * The menu button opens the same list of destinations in a panel under the bar; Escape or choosing a page closes it.
 * Sections are shown before they are built, marked "soon", rather than appearing later out of
 * nowhere — it makes the shape of the product legible, and makes it obvious that broadcasting
 * is a separate place rather than something that will appear inside the inbox.
 */
export function Nav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Choosing a page closes the phone menu.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape closes it at once and puts focus back on the button.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Nothing to navigate to, and no one to sign out, before signing in.
  if (pathname === '/login' || pathname === '/signup') return null;

  return (
    <nav
      aria-label="Main"
      className="sidebar relative flex shrink-0 flex-col border-b md:w-60 md:border-b-0 md:border-r md:px-3 md:py-5"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 md:mb-4 md:block md:px-0 md:py-0">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <span className="avatar size-8 rounded-lg" aria-hidden><MessageSquare size={16} strokeWidth={2} /></span>
          <span className="font-heading text-lg font-semibold tracking-tight">WhatsApp CRM</span>
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="btn btn-ghost w-11 px-0 md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="main-menu"
          onClick={() => { setOpen((o) => !o); }}
        >
          {open ? <X size={22} strokeWidth={1.75} aria-hidden /> : <Menu size={22} strokeWidth={1.75} aria-hidden />}
        </button>
      </div>

      <div id="main-menu" className="menu-panel" data-open={open}>
        <div className="flex flex-col gap-1">
          {TABS.filter((tab) => tab.adminOnly !== true || isAdmin).map((tab) => {
            const active = tab.href === '/' ? pathname === '/' : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                aria-label={tab.label}
                title={tab.label}
                className="nav-link flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm"
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span>{tab.label}</span>
                {tab.soon === true && (
                  <span className="rounded-full bg-sidebar-hover px-1.5 text-xs text-sidebar-muted">soon</span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-sidebar-line pt-3 md:mt-auto">
          <div className="flex items-center gap-2.5 px-1.5 pb-1" aria-label={isAdmin ? 'Signed in as admin' : 'Signed in as user'}>
            <span className="avatar size-9 text-xs" aria-hidden>{isAdmin ? 'A' : 'U'}</span>
            <span className="min-w-0 text-sm leading-tight">
              <span className="block font-medium">{isAdmin ? 'Admin' : 'User'}</span>
              <span className="block text-xs text-sidebar-muted">Signed in</span>
            </span>
          </div>
          <ThemeToggle />
          <ReportProblem />
          <form action={signOut}>
            <SubmitButton className="btn btn-ghost btn-sm w-full justify-start whitespace-nowrap" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </div>
    </nav>
  );
}
