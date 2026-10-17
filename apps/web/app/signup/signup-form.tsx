'use client';

import { useState } from 'react';

/** How strong a password looks, from 0 to 4: length and a mix of letters, digits and symbols. A hint, never a rule. */
function strength(password: string): number {
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

/** The labels for each strength, shown under the password box. */
const LABELS = ['Too short', 'Okay', 'Good', 'Strong', 'Very strong'];

/**
 * The sign-up form. It validates in the browser (name, organisation, a plausible email, a password of at least
 * 12 characters that matches its confirmation) and then says honestly that sign-up is not connected yet. Nothing
 * is sent anywhere.
 */
export function SignupForm() {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const score = password.length < 12 ? 0 : Math.max(1, strength(password));

  /** Checks the fields and, if they are fine, shows the "not connected yet" message instead of sending anything. */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(false);
    if (name.trim() === '' || org.trim() === '') { setError('Add your name and your organisation.'); return; }
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email.trim())) { setError('That email does not look right.'); return; }
    if (password.length < 12) { setError('Use at least 12 characters for the password.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setError(null);
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Create your account" noValidate>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Your name</span>
        <input value={name} onChange={(e) => { setName(e.target.value); }} autoComplete="name" className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Organisation</span>
        <input value={org} onChange={(e) => { setOrg(e.target.value); }} autoComplete="organization" className="field" placeholder="e.g. Acme Hiring" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Work email</span>
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); }} autoComplete="email" className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-sm font-medium">
          Password
          <button type="button" onClick={() => { setShow(!show); }} className="text-xs font-normal text-muted underline underline-offset-2">
            {show ? 'Hide' : 'Show'}
          </button>
        </span>
        <input type={show ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); }} autoComplete="new-password" className="field" />
        <span className="mt-1 flex items-center gap-2" aria-live="polite">
          <span className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <i key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${score >= n ? 'bg-accent' : 'bg-border'}`} />
            ))}
          </span>
          <span className="text-xs text-muted">{password === '' ? 'At least 12 characters' : LABELS[score]}</span>
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Confirm password</span>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => { setConfirm(e.target.value); }} autoComplete="new-password" className="field" />
      </label>

      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      {done && (
        <p role="status" className="notice notice-warning">
          Sign-up is not connected to the server yet, so nothing was created. For now an admin adds people from
          the Team page.
        </p>
      )}

      <button type="submit" className="btn btn-primary mt-1">Create account</button>
    </form>
  );
}
