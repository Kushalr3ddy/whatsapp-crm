'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { storeSession } from '@/lib/session';

/** What the form gets back. Success redirects, so only a failure ever returns. */
export interface SignInResult {
  error: string;
}

/**
 * Exchanges an email and password for a session, then stores it for this browser.
 *
 * The web app holds no credential of its own. What it stores here is the *person's* session,
 * forwarded on every subsequent API call — so the API authorises them by their role rather
 * than seeing one shared application identity.
 */
export async function signIn(_prev: SignInResult, form: FormData): Promise<SignInResult> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (email === '' || password === '') return { error: 'Enter your email and password.' };

  const base = process.env.CRM_API_URL ?? 'http://localhost:3000';

  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  } catch {
    return { error: 'Could not reach the API. Is it running?' };
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const problem = body as { detail?: string; code?: string } | null;
    // The API deliberately answers a missing account and a wrong password identically, so
    // there is nothing more specific to say here either.
    return { error: problem?.detail ?? 'Email or password is wrong.' };
  }

  const stored = await storeSession(response.headers.getSetCookie());
  if (!stored) return { error: 'The API accepted the sign-in but issued no session.' };

  // An org that has not paid (and has not been waived by an admin) goes to Billing, not the app.
  const body = (await response.json().catch(() => null)) as { data?: { billingStatus?: string } } | null;
  if (body?.data?.billingStatus === 'unpaid') redirect('/billing');
  redirect('/');
}

/** Ends the session at the API and clears it from this browser. */
export async function signOut(): Promise<void> {
  const SESSION = 'crm_session';
  const CSRF = 'crm_csrf';
  const jar = await cookies();
  const session = jar.get(SESSION)?.value ?? '';
  const csrf = jar.get(CSRF)?.value ?? '';
  const base = process.env.CRM_API_URL ?? 'http://localhost:3000';

  if (session !== '') {
    // Best effort: the cookies are cleared regardless, so a failure here cannot strand someone
    // in a signed-in-looking state. It only risks leaving a row valid until it expires.
    await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      cache: 'no-store',
      headers: { Cookie: `crm_session=${session}; crm_csrf=${csrf}`, 'x-csrf-token': csrf }
    }).catch(() => null);
  }

  jar.delete(SESSION);
  jar.delete(CSRF);
  redirect('/login');
}
