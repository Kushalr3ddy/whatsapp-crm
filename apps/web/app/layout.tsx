import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyThemeBeforePaint }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
