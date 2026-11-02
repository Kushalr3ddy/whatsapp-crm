import { redirect } from 'next/navigation';
import { listSenders, listHealthEvents, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Sender, HealthEvent } from '@/lib/crm';
import { LinkPanel } from './link-panel';
import { AddNumber } from './add-number';
import { PageHeader } from '../ui';
import { ConfirmAction } from '@/components/confirm-action';
import { removeSenderAction } from './actions';

/** Rendered per request — linking state changes second by second. */
export const dynamic = 'force-dynamic';

/**
 * The screen for connecting a WhatsApp number.
 *
 * Linking is a two-process dance: this app records the request through the API, and the
 * **gateway** is what actually opens the socket and produces the QR. If the gateway is down the
 * card says so and the Link button reports it, rather than spinning forever.
 */
export default async function LinkPage(
  { searchParams }: { searchParams: Promise<{ start?: string }> }
) {
  // A number that was just added: its QR starts by itself.
  const { start } = await searchParams;
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
        title="Linked numbers"
        description={
          <>
            Add a number, then scan its QR from WhatsApp on that phone:{' '}
            <strong>Settings → Linked Devices → Link a device</strong>.
          </>
        }
        actions={failure === null && senders.length > 0 ? <AddNumber first={false} /> : undefined}
      />

      {failure !== null && <p className="notice notice-danger">{failure}</p>}

      {failure === null && senders.length === 0 && (
        <AddNumber first />
      )}

      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {active.map((s) => <SenderCard key={s.id} sender={s} isAdmin={isAdmin} events={events.get(s.id) ?? []} autoStart={s.id === start} />)}
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

/** One number's card: its label and live state, what has happened to it, and the link/unlink panel. */
function SenderCard({ sender, isAdmin, events, autoStart = false }: { sender: Sender; isAdmin: boolean; events: HealthEvent[]; autoStart?: boolean }) {
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
          {sender.connectionState === 'open' ? 'Linked' : sender.connectionState === 'connecting' ? 'Linking…' : 'Not linked'}
        </span>
      </div>
      <BanSuspicionBanner sender={sender} events={events} />
      <LinkFailureBanner sender={sender} />
      <HealthTimeline events={events} />
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
          autoStart={autoStart}
        />
      )}
      {isAdmin && <RemoveNumber sender={sender} />}
    </li>
  );
}

/** Admin-only: take a number off this page. A linked number must be unlinked first. */
function RemoveNumber({ sender }: { sender: Sender }) {
  if (sender.linked) {
    return <p className="mt-3 text-xs text-muted">To remove this number, press Unlink first.</p>;
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      <ConfirmAction label="Remove this number" title="Remove this number?" confirmLabel="Remove"
        fields={{ senderId: sender.id }} action={removeSenderAction} className="text-xs text-muted hover:text-danger">
        <p>
          <strong>{sender.label ?? 'This number'}</strong> will disappear from this page. Its conversations and
          messages stay in the inbox, and nothing is sent or deleted on WhatsApp.
        </p>
      </ConfirmAction>
    </div>
  );
}

/**
 * The loudest thing a number can show: WhatsApp refused it (403) or ended its session unasked (401).
 * We cannot tell a ban from an unlink, only the phone can, so the banner's job is to send the operator
 * there before they relink, and to say the campaigns were stopped. Shown while the event is recent and
 * the number has not connected since.
 *
 * A `device_removed` stream error is the exception: WhatsApp saying the device was taken off the phone's
 * Linked devices list. That is an unlink, so it gets a calm warning instead of the ban alarm (R-017).
 */
function BanSuspicionBanner({ sender, events }: { sender: Sender; events: HealthEvent[] }) {
  const hit = events.find((e) => e.kind === 'forbidden_suspected' || e.kind === 'hard_ban_suspected' || e.kind === 'unlinked_on_phone');
  if (!hit) return null;
  const at = new Date(hit.at).getTime();
  const connectedSince = sender.connectionState === 'open'
    && sender.lastConnectedAt !== null && new Date(sender.lastConnectedAt).getTime() > at;
  if (connectedSince || Date.now() - at > 3 * 24 * 60 * 60 * 1000) return null;
  if (hit.kind === 'unlinked_on_phone') {
    return (
      <div role="status" className="mt-3 notice notice-warning text-[13px]">
        <p className="font-semibold">Unlinked from the phone</p>
        <p className="mt-1">
          Link it again once, from this page. If the phone shows a ban notice instead, stop and do not relink.
        </p>
        <p className="mt-1 text-muted">{hit.summary}</p>
        <p className="mt-1 text-[11px] text-muted">{new Date(hit.at).toLocaleString()}</p>
      </div>
    );
  }
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

/** What has happened to this number lately: refused connections, sessions ended unasked, devices removed on the phone. */
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
