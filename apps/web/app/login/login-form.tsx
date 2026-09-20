'use client';

import { useActionState } from 'react';
import { signIn, type SignInResult } from './actions';

/** The sign-in form. A server action does the work, so no credential touches client code. */
export function LoginForm() {
  const [state, action, pending] = useActionState<SignInResult, FormData>(signIn, { error: '' });

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {state.error !== '' && <p className="text-xs text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
