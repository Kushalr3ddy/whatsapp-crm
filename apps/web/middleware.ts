import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends anyone without a session to the sign-in screen.
 *
 * This checks only that a cookie is **present**, never that it is valid — that decision
 * belongs to the API, which owns the session table. Treat this as a cheap redirect so people
 * do not land on a broken page, not as an authorisation boundary: a forged cookie gets past
 * here and is then rejected by the API on the very next call.
 *
 * The real check cannot live here anyway. Middleware runs before the request reaches the
 * application, and asking the API to validate on every asset request would be a round trip
 * per navigation.
 */
export function middleware(req: NextRequest) {
  const signedIn = req.cookies.get('crm_session') !== undefined;
  const { pathname, search } = req.nextUrl;

  if (!signedIn) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Remember where they were going, so signing in does not dump everyone on the inbox.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * Everything except the sign-in screen, Next's own internals and static files.
 *
 * `/login` must be excluded or signing in would redirect to itself forever; `/signup` is public for the same reason.
 */
export const config = {
  matcher: ['/((?!login|signup|_next/static|_next/image|favicon.ico).*)']
};
