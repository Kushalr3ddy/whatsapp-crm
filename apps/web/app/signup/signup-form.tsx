'use client';

import { useActionState } from 'react';
import { signUp, type SignUpResult } from './actions';

/** The signup form. A server action does the work, so no credential touches client code. */
export function SignupForm() {
  const [state, action, pending] = useActionState<SignUpResult, FormData>(signUp, { error: '' });

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Organisation name</span>
        <input
          name="orgName" type="text" autoComplete="organization" required maxLength={100} className="field"
          defaultValue={state.values?.orgName ?? ''}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Your name</span>
        <input
          name="displayName" type="text" autoComplete="name" required maxLength={200} className="field"
          defaultValue={state.values?.displayName ?? ''}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email" type="email" autoComplete="username" required className="field"
          defaultValue={state.values?.email ?? ''}
        />
      </label>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password" type="password" autoComplete="new-password" required minLength={12}
            aria-describedby="password-hint" className="field"
          />
        </label>
        <span id="password-hint" className="text-xs text-muted">At least 12 characters.</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} className="field" />
      </label>

      {state.error !== '' && <p role="alert" className="notice notice-danger">{state.error}</p>}

      <button type="submit" disabled={pending} className="mt-1 btn btn-primary">
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
