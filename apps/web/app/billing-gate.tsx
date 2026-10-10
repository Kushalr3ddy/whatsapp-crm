'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Sends an unpaid account to Billing from anywhere else in the app.
 *
 * A courtesy on top of the API's own rule (an unpaid org's data routes answer 402): without it the
 * person would land on pages that all show errors. Renders nothing.
 */
export function BillingGate({ unpaid }: { unpaid: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (unpaid && !pathname.startsWith('/billing')) router.replace('/billing');
  }, [unpaid, pathname, router]);
  return null;
}
