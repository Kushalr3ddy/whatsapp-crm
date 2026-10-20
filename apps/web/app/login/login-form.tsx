'use client';

import { useActionState } from 'react';
import { signIn, type SignInResult } from './actions';
import { PasswordInput } from '../password-input';

/** The sign-in form. A server action does the work, so no credential touches client code. */
export function LoginForm() {
  const [state, action, pending] = useActionState<SignInResult, FormData>(signIn, { error: '' });

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="field"
        />
        <span className="text-xs text-muted">Use your email address, not your name.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <PasswordInput name="password" autoComplete="current-password" required />
      </label>

      {state.error !== '' && <p role="alert" className="notice notice-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 btn btn-primary"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
