'use client';

import { useState } from 'react';

/**
 * A password box with a Show / Hide button, so a typo can be spotted before signing in.
 *
 * The value stays in the browser until the form is submitted; "Show" only switches the box between dots and
 * plain text. Pass the usual input attributes (`name`, `autoComplete`, `required`).
 */
export function PasswordInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>
) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? 'text' : 'password'} className="field w-full pr-16" />
      <button
        type="button" onClick={() => { setShown(!shown); }} aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-muted hover:text-ink"
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}
