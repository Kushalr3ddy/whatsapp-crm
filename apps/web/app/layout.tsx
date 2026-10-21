import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Inter } from 'next/font/google';
import { Nav } from './nav';
import { NavProgress } from './nav-progress';
import { listSenders, getMe } from '@/lib/crm';
import './globals.css';

/** The one font used everywhere. Self-hosted by Next at build time; Latin only, to keep it light. */
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

/** Browser tab title and description. Generic on purpose — the product is not one company's. */
export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Shared WhatsApp inbox'
};

/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script. The choice lives in localStorage, which the server
 * cannot read, so without it every load would paint the default theme and then snap to the
 * chosen one — the flash that makes a theme toggle feel broken. Kept to one statement, and
 * wrapped in try/catch because blocked site data throws on access rather than returning null.
 */
const applyThemeBeforePaint =
  "try{var t=localStorage.getItem('crm.theme');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

/** The root layout wrapping every page. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // How many numbers WhatsApp may be limiting, for the badge on "Numbers". Only when signed in, and
  // never allowed to break a page: the badge is a convenience, the Numbers page is the source.
  let alerts = 0;
  // Admins get a Team tab; everyone else does not see it. The API refuses non-admins either way.
  let isAdmin = false;
  if ((await cookies()).get('crm_session') !== undefined) {
    // Together, not one after the other: this runs before every page, so each saved round trip is felt on every click.
    const [senders, me] = await Promise.all([listSenders().catch(() => null), getMe().catch(() => null)]);
    alerts = senders === null ? 0 : senders.filter((s) => s.restrictionState !== 'ok').length;
    isAdmin = me?.role === 'admin';
  }

  // An optional line across the top of every page, set with ENVIRONMENT_BANNER (for example on a test or
  // staging server, so nobody mistakes it for the real thing). Read per request, so changing it needs a
  // restart, not a rebuild. Empty or unset shows nothing.
  const banner = (process.env.ENVIRONMENT_BANNER ?? '').trim();

  // suppressHydrationWarning on <html> and <body> only: the theme script above sets `data-theme` on
  // <html> before hydration (by design, to avoid a flash), and browser extensions (Grammarly, etc.)
  // inject attributes onto <body>. Both are expected one-level attribute diffs — in Next dev a
  // hydration mismatch can throw a full-screen error overlay that hides the page, which this clears.
  // It suppresses ONLY these two elements' own attributes, never the page content below.
  return (
    <html lang="en" className={body.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyThemeBeforePaint }} />
      </head>
      <body className="flex h-screen flex-col overflow-hidden antialiased" suppressHydrationWarning>
        <NavProgress />
        {banner !== '' && (
          <div role="status" className="notice notice-warning shrink-0 rounded-none border-x-0 border-t-0 py-1.5 text-center text-sm">
            {banner}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <Nav alerts={alerts} isAdmin={isAdmin} />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </body>
    </html>
  );
}
