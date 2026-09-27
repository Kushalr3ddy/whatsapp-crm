import { cookies } from 'next/headers';

/** Where the API lives, server-side. Same source the data client uses. */
function baseUrl(): string {
  return process.env.CRM_API_URL ?? 'http://localhost:3000';
}

/**
 * Streams an attachment from the API to the browser, forwarding the signed-in session.
 *
 * A browser cannot reach `GET /api/v1/media/:id` itself: in development the API is on another
 * port, and the whole design is that the UI forwards the person's session server-side rather
 * than handing any credential to client JavaScript (see `lib/crm.ts`). So the thread links to
 * this same-origin path, and this handler is the one place that carries the session across and
 * pipes the bytes back.
 *
 * The API's response headers are the security contract for a stored file —
 * `Content-Disposition: attachment` and `nosniff` are what stop an uploaded HTML file executing
 * from our origin — so they are copied verbatim rather than reconstructed, and `nosniff` is set
 * unconditionally in case the upstream ever stops sending it.
 */
export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const jar = await cookies();
  const session = jar.get('crm_session')?.value ?? '';
  if (session === '') return new Response('Not authenticated.', { status: 401 });

  const upstream = await fetch(`${baseUrl()}/api/v1/media/${encodeURIComponent(id)}`, {
    headers: { Cookie: `crm_session=${session}` },
    cache: 'no-store'
  });

  // A non-2xx upstream (404 for someone else's file, 500 for bytes that vanished) carries a
  // problem+json body worth passing straight through, not a file to stream.
  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' }
    });
  }

  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'content-length', 'cache-control']) {
    const value = upstream.headers.get(h);
    if (value !== null) headers.set(h, value);
  }
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(upstream.body, { status: 200, headers });
}
