'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * A submit button that switches itself off and shows a "working" label while its form is being sent,
 * so a slow click is visibly doing something and cannot be clicked twice.
 */
export function SubmitButton({ children, pendingLabel = 'Working…', className }: {
  children: ReactNode; pendingLabel?: string; className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
