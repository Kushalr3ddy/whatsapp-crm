import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Nav } from './nav';
import { listSenders } from '@/lib/crm';
import './globals.css';

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
  if ((await cookies()).get('crm_session') !== undefined) {
    try {
      alerts = (await listSenders()).filter((s) => s.restrictionState !== 'ok').length;
    } catch { alerts = 0; }
  }

  // suppressHydrationWarning on <html> and <body> only: the theme script above sets `data-theme` on
  // <html> before hydration (by design, to avoid a flash), and browser extensions (Grammarly, etc.)
  // inject attributes onto <body>. Both are expected one-level attribute diffs — in Next dev a
  // hydration mismatch can throw a full-screen error overlay that hides the page, which this clears.
  // It suppresses ONLY these two elements' own attributes, never the page content below.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyThemeBeforePaint }} />
      </head>
      <body className="flex h-screen flex-col overflow-hidden antialiased md:flex-row" suppressHydrationWarning>
        <Nav alerts={alerts} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </body>
    </html>
  );
}
