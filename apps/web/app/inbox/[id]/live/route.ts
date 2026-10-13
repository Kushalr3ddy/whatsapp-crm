import { getViewers, sendPresence, sendTyping, NotAuthenticatedError } from '@/lib/crm';

/**
 * The live, chatty half of a thread: who is here, and "I'm here" / "I'm typing" pings.
 *
 * Plain route handlers rather than server actions on purpose. Next runs server actions one at a
 * time, so a 2.5 s viewers poll plus heartbeats and typing pings would sit in the same queue as
 * the person's own "Send" and make it wait. A `fetch` to a route handler runs in parallel.
 * The signed-in session is forwarded server-side by `lib/crm`, exactly as for an action.
 */

/** Maps a failure to a status the poller can ignore: it never needs to show an error. */
function failure(error: unknown): Response {
  if (error instanceof NotAuthenticatedError) return new Response(null, { status: 401 });
  return new Response(null, { status: 502 });
}

/** Who else has the thread open and who is typing. */
export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  try {
    return Response.json({ data: await getViewers(id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * `{ "action": "beat" | "typing" | "leave" }`. JSON only, so a cross-site form post (which cannot
 * send that content type without a preflight) cannot trigger it.
 */
export async function POST(
  req: Request, { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return new Response(null, { status: 415 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  try {
    if (body?.action === 'beat') await sendPresence(id, true);
    else if (body?.action === 'leave') await sendPresence(id, false);
    else if (body?.action === 'typing') await sendTyping(id);
    else return new Response(null, { status: 422 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}
