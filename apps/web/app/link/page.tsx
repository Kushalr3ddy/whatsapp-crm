import { redirect } from 'next/navigation';
import { listSenders, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Sender } from '@/lib/crm';
import { LinkPanel } from './link-panel';
import { setEnforcementAction } from './actions';

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
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    [senders, isAdmin] = await Promise.all([listSenders(), getMe().then((m) => m.role === 'admin')]);
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
    <main className="page page-narrow">
      <header className="mb-6">
        <h1 className="page-title">Numbers</h1>
        <p className="page-desc">
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
        {active.map((s) => <SenderCard key={s.id} sender={s} isAdmin={isAdmin} />)}
      </ul>

      {previouslyLinked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-muted">Previously linked numbers</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted">
            Unlinked, kept so their conversations stay reachable in the inbox. Link one again to
            reconnect it.
          </p>
          <ul className="flex flex-col gap-3 opacity-80">
            {previouslyLinked.map((s) => <SenderCard key={s.id} sender={s} isAdmin={isAdmin} />)}
          </ul>
        </section>
      )}
    </main>
  );
}

/** One number's card: its label and live state, the health panel, and the link/unlink panel. */
function SenderCard({ sender, isAdmin }: { sender: Sender; isAdmin: boolean }) {
  return (
    <li className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{sender.label ?? 'Unnamed sender'}</p>
          <p className="mt-0.5 text-xs text-muted">
            {sender.phoneE164 ?? 'no number yet'} · socket{' '}
            <code>{sender.connectionState ?? 'none'}</code>
          </p>
        </div>
      </div>
      <AdvisoryBanner sender={sender} />
      <HealthPanel sender={sender} />
      {isAdmin && <EnforcementControl sender={sender} />}
      <LinkPanel
        senderId={sender.id}
        alreadyOpen={sender.connectionState === 'open'}
        linked={sender.linked}
      />
    </li>
  );
}

/**
 * Loud and persistent, by design (D-29): while a number is in advisory mode the anti-ban engine is
 * NOT protecting it, and that must never be something an operator can forget.
 */
function AdvisoryBanner({ sender }: { sender: Sender }) {
  if (sender.enforcement !== 'advisory') return null;
  return (
    <div className="mt-3 notice notice-danger">
      <strong>Advisory mode — anti-ban is NOT enforced on this number.</strong> Pacing, health and
      recovery holds are recorded, not obeyed; a ban here is permanent.
      {sender.advisoryReason !== null && <> Reason: “{sender.advisoryReason}”.</>}
      {' '}Sent past a hold <span className="tabular-nums">{sender.advisoryBypassCount}</span> time(s)
      {sender.advisoryLastBypass !== null && <>, latest: <code>{sender.advisoryLastBypass}</code></>}.
    </div>
  );
}

/** Admin-only: turn advisory mode on (with a reason) or back off. */
function EnforcementControl({ sender }: { sender: Sender }) {
  if (sender.enforcement === 'advisory') {
    return (
      <form action={setEnforcementAction} className="mt-2">
        <input type="hidden" name="senderId" value={sender.id} />
        <input type="hidden" name="mode" value="enforce" />
        <button type="submit" className="btn btn-sm btn-primary text-ink">
          Back to enforcing
        </button>
      </form>
    );
  }
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">Advisory mode…</summary>
      <form action={setEnforcementAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="senderId" value={sender.id} />
        <input type="hidden" name="mode" value="advisory" />
        <p className="text-muted">
          Stops this number&apos;s pacing, health and recovery holds from blocking sends. For a throwaway
          number or a test only — a ban is permanent. Do-not-contact is never relaxed.
        </p>
        <textarea name="reason" required minLength={10} maxLength={500} rows={2}
          placeholder="Why? (recorded in the audit log)"
          className="field field-sm" />
        <button type="submit" className="self-start btn btn-sm btn-danger">
          Turn anti-ban enforcement off for this number
        </button>
      </form>
    </details>
  );
}

/** The colour and label for a sender's health status. */
function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'active':
      return { label: 'Healthy', cls: 'text-success border-transparent bg-success-soft' };
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

/** Human labels for the recovery incident classes (docs/08-antiban.md, Layer 6). */
const INCIDENT_LABEL: Record<'timelock_463' | 'rate_429' | 'soft_ban', string> = {
  timelock_463: '463 reachout timelock',
  rate_429: '429 rate limit',
  soft_ban: 'suspected soft ban'
};

/** A rough "resumes in ~Xh/Xm" from an ISO timestamp, for the recovery pause banner. */
function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'shortly';
  const hours = Math.round(ms / 3_600_000);
  if (hours >= 1) return `~${String(hours)}h`;
  return `~${String(Math.max(1, Math.round(ms / 60_000)))}m`;
}

/**
 * The at-risk / recovery banner: the prominent "this number is in trouble" line the status badge
 * alone does not give. A timed recovery (Layer 6) is shown first — a pause with its resume time, or
 * the reduced-cap ramp — then, failing that, a plain degraded/quarantined explanation so an
 * operator is never left guessing why a number has gone quiet (the "pacing has no window" gap).
 */
function RecoveryBanner({ sender }: { sender: Sender }) {
  const danger = 'mt-2 rounded-md border border-danger/50 px-2.5 py-1.5 text-xs text-danger';
  const warn = 'mt-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-xs text-warning';
  const r = sender.recovery;

  if (r !== null && r.phase === 'paused') {
    return (
      <div className={danger}>
        Cooling off after a {INCIDENT_LABEL[r.incident]} — sending is paused
        {r.resumesAt !== null && <>, resumes {untilLabel(r.resumesAt)}</>}.
      </div>
    );
  }
  if (r !== null && r.phase === 'ramping') {
    return (
      <div className={warn}>
        Recovering after a {INCIDENT_LABEL[r.incident]} — sending at{' '}
        <span className="tabular-nums">{Math.round(r.capFraction * 100)}%</span> of its cap, ramping
        back up.
      </div>
    );
  }
  if (sender.status === 'quarantined') {
    return <div className={danger}>Quarantined — sending is held until its health recovers.</div>;
  }
  if (sender.status === 'degraded') {
    return <div className={warn}>Elevated risk — sending at reduced speed while it recovers.</div>;
  }
  return null;
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

      <RecoveryBanner sender={sender} />

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
