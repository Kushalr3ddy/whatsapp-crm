import { cookies } from 'next/headers';

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
 * Stores the session the API just issued in this browser's cookies. Returns false when the API
 * answered without one. Shared by sign-in and signup so the two cannot set cookies differently.
 */
export async function storeSession(setCookies: readonly string[]): Promise<boolean> {
  const session = valueOf(setCookies, SESSION);
  const csrf = valueOf(setCookies, CSRF);
  if (session === '') return false;

  const jar = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60;
  // httpOnly on the session: no script should ever be able to read it.
  jar.set(SESSION, session, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
  // NOT httpOnly: this one is read back and echoed as a header (the double-submit pattern).
  jar.set(CSRF, csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge });
  return true;
}
