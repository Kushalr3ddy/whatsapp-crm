'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** What the form gets back. Success redirects, so only a failure ever returns. */
export interface SignInResult {
  error: string;
}

/** Cookie names, matching what the API issues. Kept together so they cannot drift apart. */
const SESSION = 'crm_session';
const CSRF = 'crm_csrf';

/**
 * Pulls one cookie's value out of a `Set-Cookie` list.
 *
 * The API's own flags are not reused. This response is being written by *this* app to *this*
 * origin, so the flags are set here deliberately rather than copied from a header that was
 * describing a different hop.
 */
function valueOf(setCookies: readonly string[], name: string): string {
  for (const c of setCookies) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0] ?? '';
  }
  return '';
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

  const setCookies = response.headers.getSetCookie();
  const session = valueOf(setCookies, SESSION);
  const csrf = valueOf(setCookies, CSRF);
  if (session === '') return { error: 'The API accepted the sign-in but issued no session.' };

  const jar = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60;

  // httpOnly on the session: no script should ever be able to read it.
  jar.set(SESSION, session, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
  // NOT httpOnly: this one is read back and echoed as a header. That is the double-submit
  // pattern, and it only works because script can read it.
  jar.set(CSRF, csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge });

  redirect('/');
}

/** Ends the session at the API and clears it from this browser. */
export async function signOut(): Promise<void> {
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
