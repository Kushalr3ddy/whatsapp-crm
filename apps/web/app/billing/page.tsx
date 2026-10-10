import Link from 'next/link';
import { getMe } from '@/lib/crm';

/** Rendered per request: the status changes when an operator waives or records payment. */
export const dynamic = 'force-dynamic';

/**
 * Billing. Payment is not built yet, so this page's job today is to say where the account stands:
 * unpaid accounts are held here (the whole app is gated until payment is recorded or waived),
 * while paid and waived (beta) accounts see their status.
 */
export default async function BillingPage() {
  const me = await getMe().catch(() => null);
  const status = me?.billingStatus ?? 'exempt';

  if (status === 'unpaid') {
    return (
      <main className="page page-narrow">
        <h1 className="page-title">Billing</h1>
        <p role="status" className="mt-4 notice notice-warning">
          Payment is required before you can use the app.
        </p>
        <p className="mt-4 text-sm text-muted">
          Online payment is not available yet. If you are a beta tester, an administrator can enable
          your account without payment — once they have, sign in again or check below.
        </p>
        <p className="mt-6 flex items-center gap-3">
          <Link href="/billing" className="btn">Check again</Link>
          <Link href="/login" className="text-sm text-muted underline underline-offset-2">Back to sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <h1 className="page-title">Billing</h1>
      <p role="status" className="mt-4 notice notice-success">
        {status === 'paid' ? 'Your account is paid up.' : 'Your account is enabled without payment (beta).'}
      </p>
      <p className="mt-4 text-sm text-muted">
        Usage, invoices and plan details will appear here once billing is built.
      </p>
      <p className="mt-6"><Link href="/" className="btn btn-primary">Continue to the app</Link></p>
    </main>
  );
}
