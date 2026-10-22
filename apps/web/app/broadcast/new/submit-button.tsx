'use client';

import { useFormStatus } from 'react-dom';

/** The form's submit button: once pressed it turns off and says what is happening, so a second click can do nothing. */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary disabled:opacity-60">
      {pending ? pendingLabel : label}
    </button>
  );
}
