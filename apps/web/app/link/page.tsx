import { redirect } from 'next/navigation';
import { listSenders, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
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
  let expired = false;
  try {
    senders = await listSenders();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }

  if (expired) redirect('/login?next=/link');

  // A number is "previously linked" once it has no stored credentials but was connected before —
  // keep it, at the bottom, so its conversations stay reachable and it can be linked again. A
  // number that was never connected is just new, and belongs with the active ones to be linked.
  const active = senders.filter((s) => s.linked || s.lastConnectedAt === null);
  const previouslyLinked = senders.filter((s) => !s.linked && s.lastConnectedAt !== null);

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
        {active.map((s) => <SenderCard key={s.id} sender={s} />)}
      </ul>

      {previouslyLinked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-muted">Previously linked numbers</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted">
            Unlinked, kept so their conversations stay reachable in the inbox. Link one again to
            reconnect it.
          </p>
          <ul className="flex flex-col gap-3 opacity-80">
            {previouslyLinked.map((s) => <SenderCard key={s.id} sender={s} />)}
          </ul>
        </section>
      )}
    </main>
  );
}

/** One number's card: its label and live state, the health panel, and the link/unlink panel. */
function SenderCard({ sender }: { sender: Sender }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{sender.label ?? 'Unnamed sender'}</p>
          <p className="mt-0.5 text-xs text-muted">
            {sender.phoneE164 ?? 'no number yet'} · socket{' '}
            <code>{sender.connectionState ?? 'none'}</code>
          </p>
        </div>
      </div>
      <HealthPanel sender={sender} />
      <LinkPanel
        senderId={sender.id}
        alreadyOpen={sender.connectionState === 'open'}
        linked={sender.linked}
      />
    </li>
  );
}

/** The colour and label for a sender's health status. */
function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'active':
      return { label: 'Healthy', cls: 'text-accent border-accent/40 bg-accent-soft' };
    case 'degraded':
      return { label: 'Degraded', cls: 'text-warning border-warning/40 bg-warning-soft' };
    case 'quarantined':
      return { label: 'Quarantined', cls: 'text-danger border-danger/50' };
    case 'linking':
      return { label: 'Linking', cls: 'text-muted border-border' };
    default:
      return { label: status, cls: 'text-muted border-border' };
  }
}

/** One labelled figure in the health panel's stat row. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 tabular-nums font-medium text-ink">{value}</dd>
    </div>
  );
}

/**
 * The sender-health panel: the risk band the scorer assigned, the evidence behind it (delivery,
 * recent sends, failures) and the relationship breakdown (who has replied). This surfaces what
 * the anti-ban engine's health scoring (docs/08-antiban.md) is doing to each number, so an
 * operator can see *why* a number was degraded or quarantined rather than trusting a bare status.
 */
function HealthPanel({ sender }: { sender: Sender }) {
  const badge = statusBadge(sender.status);
  const scored = sender.health.band !== undefined;
  const totalTalkedTo = sender.knownContacts + sender.contactedContacts;
  const replyRate = totalTalkedTo > 0
    ? Math.round((sender.knownContacts / totalTalkedTo) * 100)
    : null;
  const delivery = sender.health.deliveryRatio;

  return (
    <div className="mt-3 rounded-lg border border-border bg-canvas p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="text-xs text-muted">
          risk <span className="tabular-nums text-ink">{sender.riskScore}</span>/100
        </span>
      </div>

      {scored ? (
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Delivery" value={delivery !== undefined ? `${String(Math.round(delivery * 100))}%` : '—'} />
          <Stat label="Sent · 24h" value={String(sender.health.sentRecent ?? 0)} />
          <Stat label="Failed · 24h" value={String(sender.health.failedRecent ?? 0)} />
        </dl>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Not scored yet — the gateway scores each number as it runs.
        </p>
      )}

      <p className="mt-2 text-xs text-muted">
        Contacts: <span className="font-medium text-ink">{sender.knownContacts}</span> replied
        {' · '}
        <span className="font-medium text-ink">{sender.contactedContacts}</span> no reply
        {replyRate !== null && <> · <span className="tabular-nums">{replyRate}%</span> reply rate</>}
      </p>
    </div>
  );
}
