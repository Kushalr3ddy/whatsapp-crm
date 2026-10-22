'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * A submit button that switches itself off and shows a "working" label while its form is being sent,
 * so a slow click is visibly doing something and cannot be clicked twice.
 * `formAction` / `formNoValidate` / `title` pass straight through for buttons that send their form somewhere else.
 */
export function SubmitButton({ children, pendingLabel = 'Working…', className, formAction, formNoValidate, title }: {
  children: ReactNode; pendingLabel?: string; className: string;
  formAction?: (formData: FormData) => void | Promise<void>; formNoValidate?: boolean; title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending} aria-busy={pending} className={className}
      formAction={formAction} formNoValidate={formNoValidate} title={title}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
