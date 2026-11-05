import { listSenders, NotAuthenticatedError } from '@/lib/crm';
import { connectionSignature } from '@/lib/connection-signature';

/**
 * A one-line answer to "has any number's link state changed?", for the watcher in every page's layout (R-017).
 *
 * Pages read the state once, when they render, so a number WhatsApp unlinks stays "Linked" on an open page until
 * someone reloads. The watcher polls this cheaply and refreshes the page only when the answer differs.
 * A route handler rather than a server action, for the same reason as the thread's live route: it must not queue
 * behind the person's own actions.
 */
export async function GET(): Promise<Response> {
  try {
    const data = connectionSignature(await listSenders());
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // The watcher never shows an error: it simply tries again on its next beat.
    return new Response(null, { status: error instanceof NotAuthenticatedError ? 401 : 502 });
  }
}
