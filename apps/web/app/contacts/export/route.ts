import { cookies } from 'next/headers';
import { clientIpHeaders } from '@/lib/client-ip';

/** Where the API lives, server-side. Same source the data client uses. */
function baseUrl(): string {
  return process.env.CRM_API_URL ?? 'http://localhost:3000';
}

/**
 * Streams the contact export (CSV or vCard) from the API to the browser, forwarding the session.
 *
 * Same reason as the attachment proxy: the browser cannot reach the API itself, and the UI holds no
 * credential of its own, so this carries the signed-in person's session across. The API decides who
 * may export (admins only) and writes the audit row; a refusal passes straight through as text. The
 * API's `Content-Disposition: attachment` and `nosniff` are copied, not reconstructed.
 */
export async function GET(req: Request): Promise<Response> {
  const jar = await cookies();
  const session = jar.get('crm_session')?.value ?? '';
  if (session === '') return new Response('Not authenticated.', { status: 401 });

  const format = new URL(req.url).searchParams.get('format') === 'vcf' ? 'vcf' : 'csv';
  const upstream = await fetch(`${baseUrl()}/api/v1/contacts/export?format=${format}`, {
    headers: { Cookie: `crm_session=${session}`, ...(await clientIpHeaders()) }, cache: 'no-store'
  });
  if (!upstream.ok) {
    const problem = await upstream.json().catch(() => null) as { detail?: string } | null;
    return new Response(problem?.detail ?? 'The export could not be produced.', { status: upstream.status });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: 200, headers });
}
