import { redirect } from 'next/navigation';
import { listSenders, listHealthEvents, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Sender, HealthEvent } from '@/lib/crm';
import { LinkPanel } from './link-panel';
import { PageHeader, EmptyState } from '../ui';
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
  const events = new Map<string, HealthEvent[]>();
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    [senders, isAdmin] = await Promise.all([listSenders(), getMe().then((m) => m.role === 'admin')]);
    // The timeline is secondary: if it cannot be read the page still works.
    await Promise.all(senders.map(async (s) => {
      events.set(s.id, await listHealthEvents(s.id).catch((): HealthEvent[] => []));
    }));
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
    <main className="page">
      <PageHeader
        title="Numbers"
        description={
          <>
            Scan the QR from WhatsApp on your phone: <strong>Settings → Linked Devices → Link a device</strong>.
            The gateway must be running — <code>npm run gateway</code>.
          </>
        }
      />

      {failure !== null && <p className="notice notice-danger">{failure}</p>}

      {failure === null && senders.length === 0 && (
        <EmptyState
          title="No numbers yet"
          body={<>Create one first: <code>POST /api/v1/senders</code>, then link it here.</>}
        />
      )}

      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {active.map((s) => <SenderCard key={s.id} sender={s} isAdmin={isAdmin} events={events.get(s.id) ?? []} />)}
      </ul>

      {previouslyLinked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-muted">Previously linked numbers</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted">
            Unlinked, kept so their conversations stay reachable in the inbox. Link one again to
            reconnect it.
          </p>
          <ul className="grid items-start gap-4 opacity-80 lg:grid-cols-2">
            {previouslyLinked.map((s) => <SenderCard key={s.id} sender={s} isAdmin={isAdmin} events={events.get(s.id) ?? []} />)}
          </ul>
        </section>
      )}
    </main>
  );
}

/** One number's card: its label and live state, the health panel, and the link/unlink panel. */
function SenderCard({ sender, isAdmin, events }: { sender: Sender; isAdmin: boolean; events: HealthEvent[] }) {
  return (
    <li className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="avatar size-11" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{sender.label ?? 'Unnamed sender'}</p>
            <p className="truncate text-sm text-muted">{sender.phoneE164 ?? 'no number yet'}</p>
          </div>
        </div>
        <span className={`badge ${sender.connectionState === 'open' ? 'badge-success' : 'badge-warning'}`}>
          {sender.connectionState === 'open' ? 'Connected' : sender.connectionState === 'connecting' ? 'Connecting' : 'Not connected'}
        </span>
      </div>
      <BanSuspicionBanner sender={sender} events={events} />
      <LinkFailureBanner sender={sender} />
      <AdvisoryBanner sender={sender} />
      <RestrictionBanner sender={sender} />
      <HealthPanel sender={sender} />
      <HealthTimeline events={events} />
      {isAdmin && <EnforcementControl sender={sender} />}
      {sender.provider === 'fake' ? (
        // The in-memory test channel has nothing to scan. A Link button here once started a real QR
        // for the wrong card, so a test number is shown without one.
        <p className="mt-3 text-xs text-muted">
          Test channel: it never connects to WhatsApp, so there is nothing to link.
        </p>
      ) : (
        <LinkPanel
          senderId={sender.id}
          alreadyOpen={sender.connectionState === 'open'}
          linked={sender.linked}
        />
      )}
    </li>
  );
}

/**
 * The loudest thing a number can show: WhatsApp refused it (403) or ended its session unasked (401).
 * We cannot tell a ban from an unlink, only the phone can, so the banner's job is to send the operator
 * there before they relink, and to say the campaigns were stopped. Shown while the event is recent and
 * the number has not connected since.
 */
function BanSuspicionBanner({ sender, events }: { sender: Sender; events: HealthEvent[] }) {
  const hit = events.find((e) => e.kind === 'forbidden_suspected' || e.kind === 'hard_ban_suspected');
  if (!hit) return null;
  const at = new Date(hit.at).getTime();
  const connectedSince = sender.connectionState === 'open'
    && sender.lastConnectedAt !== null && new Date(sender.lastConnectedAt).getTime() > at;
  if (connectedSince || Date.now() - at > 3 * 24 * 60 * 60 * 1000) return null;
  const refused = hit.kind === 'forbidden_suspected';
  return (
    <div role="alert" className="mt-3 notice notice-danger text-[13px]">
      <p className="font-semibold">
        {refused ? 'WhatsApp refused this number' : 'WhatsApp logged this number out'}: check the phone first
      </p>
      <ol className="mt-1 list-decimal pl-5">
        <li>Open WhatsApp on the phone that owns this number. A ban shows as an &ldquo;account banned&rdquo; or
          &ldquo;temporarily banned&rdquo; notice.</li>
        <li>If you see one, stop. Do not relink; the notice says how long it lasts and how to appeal.</li>
        <li>If there is no notice, someone unlinked the device. Then link again, once, from this page.</li>
      </ol>
      <p className="mt-1 text-muted">{hit.summary}</p>
      <p className="mt-1 text-[11px] text-muted">{new Date(hit.at).toLocaleString()}</p>
    </div>
  );
}

/**
 * The last link attempt's failure, summarised: what happened, why it matters, and the next step.
 * Cleared by the gateway the moment the number connects.
 */
function LinkFailureBanner({ sender }: { sender: Sender }) {
  const e = sender.linkError;
  if (!e || sender.connectionState === 'open') return null;
  return (
    <div role="alert" className="mt-3 notice notice-danger text-[13px]">
      <p className="font-semibold">{e.title}</p>
      <p className="mt-0.5">{e.summary}</p>
      <p className="mt-1 text-muted">{e.hint}</p>
      <p className="mt-1 text-[11px] text-muted">
        Code: <code>{e.code}</code>
        {e.statusCode ? <> · WhatsApp status {e.statusCode}</> : null}
        {e.at ? <> · {new Date(e.at).toLocaleString()}</> : null}
      </p>
    </div>
  );
}

/**
 * WhatsApp does not announce a restriction; the detector infers it from delivery (docs/27). This is
 * where that inference is shown: what we suspect, why, and what the system has already done.
 */
function RestrictionBanner({ sender }: { sender: Sender }) {
  if (sender.restrictionState === 'ok') return null;
  const likely = sender.restrictionState === 'likely';
  return (
    <div role="alert" className={`notice mt-4 ${likely ? 'notice-danger' : 'notice-warning'}`}>
      <p className="font-semibold">
        {likely ? 'This number looks restricted by WhatsApp.' : 'WhatsApp may be limiting this number.'}
      </p>
      <p className="mt-1 text-sm">
        {likely
          ? 'Messages are not being delivered. Its campaigns are paused and it is cooling off — do not '
            + 'push more through it. Check the health timeline below for what was seen.'
          : 'Delivery has slowed or messages are stuck at one tick. Sending is slowed while this is checked; '
            + 'it clears itself if delivery recovers.'}
        {sender.restrictionSince !== null && <> Since {new Date(sender.restrictionSince).toLocaleString()}.</>}
      </p>
    </div>
  );
}

/** What has happened to this number lately: restrictions raised and cleared, possible bans. */
function HealthTimeline({ events }: { events: HealthEvent[] }) {
  if (events.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Health timeline ({events.length})</summary>
      <ol className="mt-2 flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                e.severity === 'critical' ? 'bg-danger' : e.severity === 'warning' ? 'bg-warning' : 'bg-success'}`}
            />
            <div>
              <p>{e.summary}</p>
              <p className="text-xs text-muted">{new Date(e.at).toLocaleString()}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
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
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
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

  const risk = Math.max(0, Math.min(100, sender.riskScore));
  const riskCls = risk >= 60 ? 'bg-danger' : risk >= 30 ? 'bg-warning' : 'bg-success';

  return (
    <div className="mt-4 rounded-xl border border-border bg-canvas p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        <span className="text-sm text-muted">
          Risk <span className="font-semibold tabular-nums text-ink">{sender.riskScore}</span>/100
        </span>
      </div>
      <div
        role="progressbar" aria-label="Risk score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={risk}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${riskCls}`} style={{ width: `${String(risk)}%` }} />
      </div>

      <RecoveryBanner sender={sender} />

      {scored ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Delivery" value={delivery !== undefined ? `${String(Math.round(delivery * 100))}%` : '—'} />
          <Stat label="Sent · 24h" value={String(sender.health.sentRecent ?? 0)} />
          <Stat label="Failed · 24h" value={String(sender.health.failedRecent ?? 0)} />
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Not scored yet — the gateway scores each number as it runs.
        </p>
      )}

      <p className="mt-3 text-sm text-muted">
        Contacts: <span className="font-medium text-ink">{sender.knownContacts}</span> replied
        {' · '}
        <span className="font-medium text-ink">{sender.contactedContacts}</span> no reply
        {replyRate !== null && <> · <span className="tabular-nums">{replyRate}%</span> reply rate</>}
      </p>
    </div>
  );
}
