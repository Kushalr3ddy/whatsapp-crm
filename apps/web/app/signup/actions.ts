'use server';

import { redirect } from 'next/navigation';
import { storeSession } from '@/lib/session';

/** What the form gets back. Success redirects, so only a failure ever returns. */
export interface SignUpResult {
  error: string;
  /** What was typed, so a failed submit does not wipe the form (React resets it after an action). Never the password. */
  values?: { orgName: string; displayName: string; email: string };
}

/**
 * Creates an organisation and its first admin, then signs them in and sends them to Billing — a new
 * signup is unpaid until an operator marks the org paid or waives it (a beta tester).
 */
export async function signUp(_prev: SignUpResult, form: FormData): Promise<SignUpResult> {
  const orgName = String(form.get('orgName') ?? '').trim();
  const displayName = String(form.get('displayName') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const values = { orgName, displayName, email };
  if (orgName === '' || displayName === '' || email === '' || password === '') {
    return { error: 'Fill in every field.', values };
  }
  if (password.length < 12) return { error: 'Use a password of at least 12 characters.', values };
  if (password !== confirm) return { error: 'The two passwords do not match.', values };

  const base = process.env.CRM_API_URL ?? 'http://localhost:3000';
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/auth/signup`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName, displayName, email, password })
    });
  } catch {
    return { error: 'Could not reach the API. Is it running?', values };
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    return { error: problem?.detail ?? 'Could not create the account.', values };
  }

  const stored = await storeSession(response.headers.getSetCookie());
  if (!stored) return { error: 'The account was created but no session was issued. Try signing in.', values };
  redirect('/billing');
}
