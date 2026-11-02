import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getCampaign, listCampaignRecipients, previewCampaign, getMe, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Me, CampaignDetail, CampaignRecipient, CampaignPreview } from '@/lib/crm';
import { campaignStatusBadge } from '../campaign-status';
import { Meter, initialsOf } from '../../ui';
import { CampaignControls, SendAnywayButton } from '../campaign-controls';
import { AutoRefresh } from '../auto-refresh';
import { GATE_LABEL } from '../gates';
import { holdLabel } from '@/lib/hold-label';

/** Rendered per request — progress and the status/search filters come live from the query string. */
export const dynamic = 'force-dynamic';

/** The recipient statuses, in the order the filter bar shows them. */
const STATUSES = ['sent', 'queued', 'pending', 'skipped', 'failed'] as const;

/**
 * One campaign's page: its progress, the message it sends, and — the point of this
 * slice — the **per-recipient results**: every recipient in a terminal or pending state, none
 * silently absent, filterable by status and searchable by name or number. This is how an operator
 * answers "who did this reach, and why not the rest?" (F5 AC-5).
 */
export default async function CampaignPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ status?: string; q?: string; created?: string }>;
  }
) {
  const { id } = await params;
  const { status, q, created } = await searchParams;
  const activeStatus = typeof status === 'string' ? status : '';
  const query = typeof q === 'string' ? q : '';

  let me: Me | null = null;
  let campaign: CampaignDetail | null = null;
  let recipients: CampaignRecipient[] = [];
  let preview: CampaignPreview | null = null;
  let failure: string | null = null;
  let expired = false;
  let missing = false;
  try {
    [campaign, recipients, me] = await Promise.all([
      getCampaign(id),
      listCampaignRecipients(id, { status: activeStatus, q: query }),
      getMe()
    ]);
    // A draft has no frozen audience yet, so its progress is all zeros — a dry-run preview is the
    // useful thing to show before start. One extra round trip, and only for drafts.
    if (campaign.status === 'draft') preview = await previewCampaign(id);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    else if (error instanceof CrmApiError && error.status === 404) missing = true;
    else {
      failure = error instanceof CrmApiError
        ? `${error.code}: ${error.message}`
        : 'Could not reach the API. Is it running? Start it with: npm run dev';
    }
  }

  if (expired) redirect(`/login?next=/broadcast/${id}`);
  if (missing) notFound();

  return (
    <main className="page">
      <Link href="/broadcast" className="text-sm text-muted hover:text-ink">← All campaigns</Link>

      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}

      {campaign !== null && (
        <>
          <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="page-title truncate">{campaign.name}</h1>
                <StatusBadge status={campaign.status} />
              </div>
              <p className="page-desc">
                {campaign.startedAt !== null
                  ? <>Started {new Date(campaign.startedAt).toLocaleString()}</>
                  : <>Draft — not started yet</>}
              </p>
            </div>
            <CampaignControls id={id} status={campaign.status} isAdmin={me?.role === 'admin'} />
          </header>

          {created === '1' && campaign.status === 'draft' && (
            <p role="status" className="mb-4 notice notice-success">
              Draft created. Nothing has been sent yet — check the message and who it reaches, then press Start.
            </p>
          )}

          {campaign.status === 'running' && <AutoRefresh />}

          {campaign.status === 'draft' && preview !== null && (preview.audience.recentlyMessaged ?? 0) > 0 && (
            <div role="alert" className="mb-4 notice notice-warning flex flex-wrap items-center justify-between gap-3">
              <p>
                {preview.audience.recentlyMessaged} of {preview.audience.reachable} contacts were already messaged in another
                campaign{(preview.audience.recentCampaign ?? null) !== null ? <>, “{preview.audience.recentCampaign}”</> : null}, in the
                last 14 days. They will be skipped unless you send anyway.
              </p>
              {me?.role === 'admin' ? <SendAnywayButton /> : <span className="text-xs">Only an admin can send anyway.</span>}
            </div>
          )}

          {campaign.pauseReason === 'ban_suspected' && campaign.status === 'paused' && (
            <p role="alert" className="mb-4 notice notice-danger">
              Paused automatically: WhatsApp refused or logged out the sending number, which can mean a ban.
              Open WhatsApp on that phone and look for a notice before resuming anything. The Numbers page has
              the details.
            </p>
          )}

          {campaign.pauseReason === 'unlinked' && campaign.status === 'paused' && (
            <p role="alert" className="mb-4 notice notice-warning">
              Paused automatically: the sending number was removed under Linked devices on the phone. Link it
              again on the Numbers page, then resume.
            </p>
          )}

          {campaign.gateOverrides.length > 0 && (
            <p className="mb-4 notice notice-warning">
              An admin lifted: {campaign.gateOverrides.map((g) => GATE_LABEL[g]?.split(' — ')[0] ?? g).join(', ')}
              {campaign.gateOverrideReason !== null && <> — “{campaign.gateOverrideReason}”</>}
            </p>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              {campaign.status === 'draft' && preview !== null
                ? <DraftPreview preview={preview} />
                : <ProgressTiles campaign={campaign} activeStatus={activeStatus} query={query} id={id} />}

              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold tracking-tight">Recipients</h2>
                  <span className="text-sm text-muted">{recipients.length} shown</span>
                </div>

                <StatusFilterBar id={id} activeStatus={activeStatus} query={query} />
                <SearchBox id={id} activeStatus={activeStatus} query={query} />

                {recipients.length === 0 && (
                  <p className="text-sm text-muted">
                    {campaign.progress.total === 0
                      ? 'No recipients yet — this campaign has not been started, so its audience is not frozen.'
                      : 'No recipients match this filter.'}
                  </p>
                )}

                {recipients.length > 0 && (
                  <ul className="card list overflow-hidden">
                    {recipients.map((r) => <RecipientRow key={r.id} recipient={r} />)}
                  </ul>
                )}
              </section>
            </div>

            <aside className="lg:sticky lg:top-6">
              {campaign.mediaAssetId !== null && (
                <section className="card mb-4 p-4" aria-label="Picture">
                  <h2 className="text-sm font-semibold">Picture</h2>
                  {/* A safe re-encoded preview from our own server (the original is never shown inline). */}
                  <img src={`/media/${campaign.mediaAssetId}/thumb`} alt="The picture sent with this campaign" className="mt-2 max-h-52 rounded-lg border border-border" />
                  <p className="mt-2 text-xs text-muted">
                    {campaign.mediaFilename ?? 'picture'}{campaign.mediaSizeBytes !== null ? ` · ${(campaign.mediaSizeBytes / 1048576).toFixed(2)} MB` : ''}
                    {campaign.mediaContentType === 'image/gif' ? ' · GIF, sent as a looping clip' : ''}. Sent to everyone with the message below as its caption.
                  </p>
                </section>
              )}
              <MessageBody body={campaign.body} />
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

/** The campaign status badge, reusing the list's colours. */
function StatusBadge({ status }: { status: string }) {
  const badge = campaignStatusBadge(status);
  return (
    <span className={`badge ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

/** What each `skip_reason` means, for the per-recipient list. */
const SKIP_LABEL: Record<string, string> = {
  dnc: 'marked do-not-contact',
  no_phone: 'no phone number',
  cancelled: 'campaign cancelled',
  engaged: 'an agent is mid-conversation',
  cooldown: 'sent a campaign within 14 days',
  in_other_campaign: 'in another live campaign',
  own_number: 'the number sending this campaign (WhatsApp cannot message itself)'
};

/**
 * The progress counters, each a link that filters the list below to that status — so the summary
 * and the detail are one thing, not two.
 */
function ProgressTiles(
  { campaign, activeStatus, query, id }:
  { campaign: CampaignDetail; activeStatus: string; query: string; id: string }
) {
  const p = campaign.progress;
  const tiles: Array<{ key: string; label: string; value: number; filter: string }> = [
    { key: 'total', label: 'Total', value: p.total, filter: '' },
    { key: 'sent', label: 'Sent', value: p.sent, filter: 'sent' },
    { key: 'queued', label: 'Queued', value: p.queued, filter: 'queued' },
    { key: 'pending', label: 'Pending', value: p.pending, filter: 'pending' },
    { key: 'skipped', label: 'Skipped', value: p.skipped, filter: 'skipped' },
    { key: 'failed', label: 'Failed', value: p.failed, filter: 'failed' }
  ];

  // The bar counts people actually attempted. Skipped people were never sent anything, so a campaign that skipped everyone
  // must not look finished.
  const done = p.sent + p.failed;
  const allSkipped = p.total > 0 && p.skipped === p.total;
  return (
    <>
      <div className="card mb-3 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="font-medium">
            <span className="tabular-nums">{done}</span> of <span className="tabular-nums">{p.total}</span> sent
            {p.skipped > 0 && <span className="text-muted"> · {p.skipped} skipped</span>}
            {p.queued > 0 && <span className="text-muted"> · {p.queued} queued</span>}
          </p>
          <p className="text-sm tabular-nums text-muted">
            {p.total === 0 ? 0 : Math.round((done / p.total) * 100)}%
          </p>
        </div>
        <Meter value={done} max={p.total} label="Campaign progress" />
        {allSkipped && (
          <p role="alert" className="mt-2 text-sm text-warning">
            Nothing was sent: all {p.total} people were skipped. See the Skipped list below for why.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(id, t.filter, query)}
            className={`card px-3 py-2.5 transition-colors ${
              (activeStatus === t.filter || (t.filter === '' && activeStatus === ''))
                ? '!border-accent bg-accent-soft'
                : 'hover:border-accent/50'
            }`}
          >
            <div className="text-xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-muted">{t.label}</div>
          </Link>
        ))}
      </div>
    </>
  );
}

/**
 * The dry-run preview shown for a draft: who it would reach, before anything is
 * frozen. The unreachable count is called out because a tag of contacts with no numbers is a
 * mistake worth catching before pressing Start, not after.
 */
function DraftPreview({ preview }: { preview: CampaignPreview }) {
  const { audience } = preview;
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">Dry run — nothing sent yet</p>
      <p className="mt-1 text-sm">
        Would message <span className="font-semibold tabular-nums">{audience.reachable}</span>{' '}
        {audience.reachable === 1 ? 'person' : 'people'}
        {audience.unreachable > 0 && (
          <> · <span className="tabular-nums">{audience.unreachable}</span> skipped (no number)</>
        )}
        {' '}· {audience.total} in the audience.
      </p>
      {audience.reachable === 0 && (
        <p className="mt-1 text-xs text-danger">
          Nobody in this audience has a number — starting would send to no one. Check the tag.
        </p>
      )}
    </div>
  );
}

/** The message every recipient is sent — shown so the results are read next to what went out. */
function MessageBody({ body }: { body: string }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Message</h2>
      <div className="rounded-2xl rounded-tl-sm bg-accent-soft px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{body}</p>
      </div>
      <p className="mt-3 text-xs text-muted">
        Each person gets their own copy: <code>{'{{name}}'}</code> and any <code>{'{a|b}'}</code> choices are
        filled in per recipient.
      </p>
    </section>
  );
}

/** The row of status filters. "All" clears it; the active one is highlighted. */
function StatusFilterBar(
  { id, activeStatus, query }: { id: string; activeStatus: string; query: string }
) {
  const chip = (active: boolean): string =>
    `badge capitalize ${active ? 'badge-accent !border-accent/40 font-semibold' : 'text-muted hover:bg-accent-soft'}`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Status:</span>
      <Link href={hrefFor(id, '', query)} className={chip(activeStatus === '')}>All</Link>
      {STATUSES.map((s) => (
        <Link key={s} href={hrefFor(id, s, query)} className={chip(activeStatus === s)}>{s}</Link>
      ))}
    </div>
  );
}

/** Search by contact name or number, keeping the active status filter. */
function SearchBox({ id, activeStatus, query }: { id: string; activeStatus: string; query: string }) {
  return (
    <form className="mb-4 flex gap-2" action={`/broadcast/${id}`}>
      {activeStatus !== '' && <input type="hidden" name="status" value={activeStatus} />}
      <input
        name="q"
        defaultValue={query}
        placeholder="Search recipient name or number…"
        aria-label="Search recipients"
        className="flex-1 field"
      />
      <button
        type="submit"
        className="btn"
      >
        Search
      </button>
    </form>
  );
}

/** One recipient: who they are, where they ended up, and why (for a skip or failure). */
function RecipientRow({ recipient }: { recipient: CampaignRecipient }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="avatar size-9 text-sm" aria-hidden>
          {initialsOf(recipient.displayName ?? recipient.identity ?? '?')}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">
            {recipient.displayName ?? recipient.identity ?? 'Unnamed contact'}
          </p>
          <p className="truncate text-sm text-muted">
            {recipient.identity ?? 'no contact details'}
            {recipient.attemptedAt !== null && <> · {new Date(recipient.attemptedAt).toLocaleString()}</>}
          </p>
        </div>
      </div>
      <RecipientStatus recipient={recipient} />
    </li>
  );
}

/** The recipient's outcome as a badge, with the reason a skip/failure carries. */
function RecipientStatus({ recipient }: { recipient: CampaignRecipient }) {
  const { status, skipReason, messageStatus, holdReason } = recipient;
  // Waiting to go out: say why, in words, instead of a bare "pending".
  const waiting = (status === 'pending' || status === 'queued') && messageStatus === 'queued';
  const cls =
    status === 'sent' ? 'text-success border-transparent bg-success-soft'
    : status === 'failed' ? 'text-danger border-danger/50'
    : status === 'skipped' ? 'text-warning border-warning/40 bg-warning-soft'
    : 'text-muted border-border';
  // For a sent recipient the message's own state (delivered/read) is more informative than "sent".
  const label = status === 'sent' && messageStatus !== null && messageStatus !== 'sent'
    ? messageStatus
    : status;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {(skipReason !== null) && <span className="text-xs text-muted">{SKIP_LABEL[skipReason] ?? skipReason}</span>}
      {waiting && <span className="text-xs text-warning">waiting: {holdLabel(holdReason ?? null)}</span>}
      <span className={`badge capitalize ${cls}`}>{label}</span>
    </div>
  );
}

/** Builds a link to this campaign filtered by status and search term. */
function hrefFor(id: string, status: string, query: string): string {
  const p = new URLSearchParams();
  if (status !== '') p.set('status', status);
  if (query !== '') p.set('q', query);
  const qs = p.toString();
  return `/broadcast/${id}${qs === '' ? '' : `?${qs}`}`;
}
