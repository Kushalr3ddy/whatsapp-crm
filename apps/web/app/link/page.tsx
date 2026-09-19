import { listSenders, CrmApiError } from '@/lib/crm';
import type { Sender } from '@/lib/crm';
import { LinkPanel } from './link-panel';

/** Rendered per request — linking state changes second by second. */
export const dynamic = 'force-dynamic';

/**
 * The screen for connecting a WhatsApp number.
 *
 * Linking is a two-process dance: this app records the request through the API, and the
 * **gateway** is what actually opens the socket and produces the QR. Nothing appears here
 * unless `npm run gateway` is running, so the page says so rather than spinning forever.
 */
export default async function LinkPage() {
  let senders: Sender[] = [];
  let failure: string | null = null;
  try {
    senders = await listSenders();
  } catch (error) {
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Numbers</h1>
        <p className="mt-1 text-sm text-muted">
          Scan the QR from WhatsApp on your phone: <strong>Settings → Linked Devices → Link a
          device</strong>. The gateway must be running — <code>npm run gateway</code>.
        </p>
      </header>

      {failure !== null && <p className="text-sm text-danger">{failure}</p>}

      {failure === null && senders.length === 0 && (
        <p className="text-sm text-muted">
          No senders exist yet. Create one first: <code>POST /api/v1/senders</code>.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {senders.map((s) => (
          <li key={s.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{s.label ?? 'Unnamed sender'}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {s.phoneE164 ?? 'no number yet'} · status <code>{s.status}</code> · socket{' '}
                  <code>{s.connectionState ?? 'none'}</code>
                </p>
              </div>
            </div>
            <LinkPanel senderId={s.id} alreadyOpen={s.connectionState === 'open'} />
          </li>
        ))}
      </ul>
    </main>
  );
}
