'use client';

import Link from 'next/link';

/**
 * What Import shows if something in the screen itself breaks, instead of the browser's blank "Application error" page. It says
 * what happened in plain words, offers the two ways out, and keeps the technical reference for support.
 */
export default function ImportError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page page-full" style={{ maxWidth: '73.75rem' }}>
      <div role="alert" className="notice notice-warning" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p><b>The Import screen hit a problem.</b> Nothing you uploaded was lost or added twice. Try again, and if it keeps happening, tell us the reference below.</p>
        <p className="text-sm text-muted">Reference: {error.digest ?? error.message.slice(0, 120)}</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
          <Link href="/contacts" className="btn">Go to Contacts</Link>
        </div>
      </div>
    </main>
  );
}
