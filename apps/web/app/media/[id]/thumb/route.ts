import { cookies } from 'next/headers';
import { clientIpHeaders } from '@/lib/client-ip';

/** Where the API lives, server-side. Same source the data client uses. */
function baseUrl(): string {
  return process.env.CRM_API_URL ?? 'http://localhost:3000';
}

/**
 * A small preview of an image attachment, for the thread.
 *
 * Carries the signed-in session to `GET /api/v1/media/:id/thumb` and pipes back the result. The API
 * decodes and re-encodes the picture, so what comes back is a WebP it wrote, never the sender's file;
 * that is why this one may be shown inline while `/media/:id` stays download-only. A file with no
 * preview (not an image, or not decodable) comes back as a plain error and the thread shows the icon.
 */
export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const jar = await cookies();
  const session = jar.get('crm_session')?.value ?? '';
  if (session === '') return new Response('Not authenticated.', { status: 401 });

  const upstream = await fetch(`${baseUrl()}/api/v1/media/${encodeURIComponent(id)}/thumb`, {
    headers: { Cookie: `crm_session=${session}`, ...(await clientIpHeaders()) },
    cache: 'no-store'
  });
  if (!upstream.ok) return new Response(null, { status: upstream.status });

  const headers = new Headers();
  // The type is fixed here, not copied: this route only ever serves the API's re-encoded WebP.
  headers.set('Content-Type', 'image/webp');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, max-age=3600');
  const length = upstream.headers.get('content-length');
  if (length !== null) headers.set('Content-Length', length);
  return new Response(upstream.body, { status: 200, headers });
}
