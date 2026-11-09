import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  getCampaign, listCampaignRecipients, previewCampaign, getMe, listConversations, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Me, CampaignDetail, CampaignRecipient, CampaignPreview, Conversation, CampaignAiStatus } from '@/lib/crm';
import { campaignStatusBadge } from '../campaign-status';
import { initialsOf } from '../../ui';
import { CampaignControls, SendAnywayButton } from '../campaign-controls';
import { AiCampaignCard } from '../ai-campaign-card';
import { AutoRefresh } from '../auto-refresh';
import { ChatRow } from './chat-row';
import { GATE_LABEL } from '../gates';
import { holdLabel } from '@/lib/hold-label';

/** Rendered per request — progress and the status/search filters come live from the query string. */
export const dynamic = 'force-dynamic';

/**
 * One campaign's page: its progress, the message it sends, and — the point of this
 * slice — the **per-recipient results**: every recipient in a terminal or pending state, none
 * silently absent, filterable by status and searchable by name or number. This is how an operator
 * answers "who did this reach, and why not the rest?" (F5 AC-5).
 */
export default async function CampaignPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ status?: string; q?: string; ai?: string; created?: string; saved?: string }>;
  }
) {
  const { id } = await params;
  const { status, q, ai, created, saved } = await searchParams;
  const activeAi = typeof ai === 'string' && AI_STATES.some((s) => s.key === ai) ? ai : '';
  const activeStatus = typeof status === 'string' ? status : '';
  const query = typeof q === 'string' ? q : '';

  let me: Me | null = null;
  let campaign: CampaignDetail | null = null;
  let recipients: CampaignRecipient[] = [];
  let preview: CampaignPreview | null = null;
  let conversations: Conversation[] = [];
  let failure: string | null = null;
  let expired = false;
  let missing = false;
  try {
    [campaign, recipients, me, conversations] = await Promise.all([
      getCampaign(id),
      listCampaignRecipients(id, { status: activeStatus, q: query, ai: activeAi }),
      getMe(),
      // Only used to make a row open its chat; a failure here just leaves the rows unlinked.
      listConversations().catch((): Conversation[] => [])
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
    <main className="page page-full">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/broadcast" className="hover:text-ink">Campaigns</Link>
        {campaign !== null && <> / <span className="font-medium text-ink">{campaign.name}</span></>}
      </nav>

      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}

      {campaign !== null && (
        <>
          <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="page-title">{campaign.name}</h1>
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

          {campaign.aiTemplateId !== null && campaign.aiUsage !== null && (
            <AiCampaignCard
              id={id} stopped={campaign.aiStopped} credits={campaign.aiUsage.credits} openings={campaign.aiUsage.openings} replies={campaign.aiUsage.replies}
              finished={campaign.status === 'completed' || campaign.status === 'cancelled'}
            />
          )}

          {campaign.aiStatus !== null && campaign.status !== 'draft' && <AiStates id={id} counts={campaign.aiStatus} activeAi={activeAi} />}

          {saved === '1' && campaign.status === 'draft' && (
            <p role="status" className="mb-4 notice notice-success">Changes saved. Nothing has been sent yet.</p>
          )}

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
                : <Progress campaign={campaign} activeStatus={activeStatus} query={query} id={id} />}

              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold tracking-tight">Recipients</h2>
                  <span className="text-sm text-muted">{recipients.length} shown</span>
                </div>

                <SearchBox id={id} activeStatus={activeStatus} activeAi={activeAi} query={query} />

                {recipients.length === 0 && (
                  <p className="text-sm text-muted">
                    {campaign.progress.total === 0
                      ? 'No recipients yet — this campaign has not been started, so its audience is not frozen.'
                      : 'No recipients match this filter.'}
                  </p>
                )}

                {recipients.length > 0 && (
                  <ul className="card list overflow-hidden">
                    {recipients.map((r, i) => (
                      <RecipientRow
                        key={r.id} recipient={r} index={i}
                        chatId={conversations.find((c) => r.identity !== null && c.contactPhone === r.identity)?.id ?? null}
                      />
                    ))}
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

/** The campaign status as a pill with a dot; the dot pulses while the campaign is sending. */
function StatusBadge({ status }: { status: string }) {
  const badge = campaignStatusBadge(status);
  return (
    <span className={`badge ${badge.cls}`}>
      <span aria-hidden className={`size-1.5 rounded-full bg-current ${status === 'running' ? 'live-dot' : ''}`} />
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
 * The progress card: how many people the campaign has reached, a two-colour bar (reached, not reached),
 * and the counts as filter chips that narrow the list below. The summary and the detail are one thing.
 */
function Progress(
  { campaign, activeStatus, query, id }:
  { campaign: CampaignDetail; activeStatus: string; query: string; id: string }
) {
  const p = campaign.progress;
  const chips: Array<{ label: string; value: number; filter: string }> = [
    { label: 'Everyone', value: p.total, filter: '' },
    { label: 'Sent', value: p.sent, filter: 'sent' },
    { label: 'Queued', value: p.queued, filter: 'queued' },
    { label: 'Pending', value: p.pending, filter: 'pending' },
    { label: 'Skipped', value: p.skipped, filter: 'skipped' },
    { label: 'Failed', value: p.failed, filter: 'failed' }
  ];

  // The bar counts people actually attempted. Skipped people were never sent anything, so a campaign that skipped everyone
  // must not look finished.
  const done = p.sent + p.failed;
  const allSkipped = p.total > 0 && p.skipped === p.total;
  const pct = (n: number): string => `${String(p.total === 0 ? 0 : (n / p.total) * 100)}%`;
  return (
    <>
      <section className="card mb-4 p-6" aria-label="Progress">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Reached</p>
        <p className="mt-2 font-mono text-5xl font-medium leading-none tracking-tight tabular-nums">
          {p.sent} <span className="text-lg font-normal tracking-normal text-muted">of {p.total}</span>
        </p>
        <div
          role="progressbar" aria-label="Campaign progress" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={done}
          className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full bg-success" style={{ width: pct(p.sent) }} />
          <div className="h-full bg-warning" style={{ width: pct(p.failed + p.skipped) }} />
        </div>
        <p className="mt-3 text-sm tabular-nums text-muted">
          <span className="tabular-nums">{done}</span> of <span className="tabular-nums">{p.total}</span> sent
          {p.skipped > 0 && <> · {p.skipped} skipped</>}
          {p.queued > 0 && <> · {p.queued} queued</>}
          {' · '}{p.total === 0 ? 0 : Math.round((done / p.total) * 100)}%
        </p>
        {allSkipped && (
          <p role="alert" className="mt-2 text-sm text-warning">
            Nothing was sent: all {p.total} people were skipped. See the Skipped list below for why.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {chips.map((c) => {
          const active = activeStatus === c.filter;
          return (
            <Link
              key={c.label}
              href={hrefFor(id, c.filter, query)}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                active ? 'border-transparent bg-accent-soft text-accent' : 'border-border bg-surface text-muted hover:text-ink'
              }`}
            >
              {c.label}
              <b className={`font-mono font-medium tabular-nums ${active ? 'text-accent' : 'text-ink'}`}>{c.value}</b>
            </Link>
          );
        })}
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

/** Search by contact name or number, keeping the active status filter. */
function SearchBox({ id, activeStatus, activeAi, query }: { id: string; activeStatus: string; activeAi: string; query: string }) {
  return (
    <form className="mb-4 mt-3 flex gap-2" action={`/broadcast/${id}`}>
      {activeStatus !== '' && <input type="hidden" name="status" value={activeStatus} />}
      {activeAi !== '' && <input type="hidden" name="ai" value={activeAi} />}
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
function RecipientRow({ recipient, index, chatId }: { recipient: CampaignRecipient; index: number; chatId: string | null }) {
  const rowClass = 'flex min-h-16 items-center justify-between gap-3 px-4 py-3';
  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <span className="avatar size-9 text-sm" aria-hidden>
          {initialsOf(recipient.displayName ?? recipient.identity ?? '?')}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">
            {recipient.displayName ?? recipient.identity ?? 'Unnamed contact'}
            {recipient.displayName !== null && recipient.identity !== null && (
              <span className="ml-2 font-mono text-xs font-normal text-muted">{recipient.identity}</span>
            )}
          </p>
          <p className="truncate text-sm text-muted">
            {recipient.displayName === null && recipient.identity === null ? 'no contact details' : null}
            {recipient.attemptedAt !== null && <>{new Date(recipient.attemptedAt).toLocaleString()}</>}
          </p>
          {(recipient.aiSummary ?? null) !== null && <p className="mt-1 text-sm [overflow-wrap:anywhere]">{recipient.aiSummary}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <RecipientStatus recipient={recipient} />
        <AiBadge status={recipient.aiStatus ?? null} />
      </div>
    </>
  );
  return (
    <li className="row-in" style={{ '--i': Math.min(index, 12) } as CSSProperties}>
      {chatId !== null
        ? <ChatRow chatId={chatId} label={recipient.displayName ?? recipient.identity ?? 'Chat'}>{inner}</ChatRow>
        : <div className={rowClass}>{inner}</div>}
    </li>
  );
}

/** The recipient's outcome as a badge, with the reason a skip/failure carries. */
function RecipientStatus({ recipient }: { recipient: CampaignRecipient }) {
  const { status, skipReason, messageStatus, holdReason } = recipient;
  // Waiting to go out: say why, in words, instead of a bare "pending".
  const waiting = (status === 'pending' || status === 'queued') && messageStatus === 'queued';
  const cls =
    messageStatus === 'read' ? 'badge-info'
    : status === 'sent' ? 'badge-success'
    : status === 'failed' ? 'badge-danger'
    : status === 'skipped' ? 'badge-warning'
    : 'bg-surface-2 text-muted border-transparent';
  // For a sent recipient the message's own state (delivered/read) is more informative than "sent".
  const label = status === 'sent' && messageStatus !== null && messageStatus !== 'sent'
    ? messageStatus
    : status;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right sm:flex-row sm:items-center sm:gap-2">
      {(skipReason !== null) && <span className="text-xs text-muted">{SKIP_LABEL[skipReason] ?? skipReason}</span>}
      {waiting && <span className="text-xs text-warning">waiting: {holdLabel(holdReason ?? null)}</span>}
      <span className={`badge capitalize ${cls}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {label}
      </span>
    </div>
  );
}

/** The states of the AI's conversation with a person, in the order a person acts on them. */
const AI_STATES: ReadonlyArray<{ key: 'interested' | 'needs_person' | 'talking' | 'not_interested' | 'none'; label: string; cls: string }> = [
  { key: 'interested', label: 'Interested', cls: 'badge-success' },
  { key: 'needs_person', label: 'Needs a person', cls: 'badge-warning' },
  { key: 'talking', label: 'Talking', cls: 'badge-info' },
  { key: 'not_interested', label: 'Not interested', cls: 'badge-danger' },
  { key: 'none', label: 'No reply yet', cls: 'bg-surface-2 text-muted border-transparent' }
];

/** What people said: how many are interested, need a person, are still talking, said no, or have not written back. Each count narrows the list below. */
function AiStates({ id, counts, activeAi }: { id: string; counts: CampaignAiStatus; activeAi: string }) {
  const value = (k: string): number => (k === 'none' ? counts.noAnswer : counts[k as keyof CampaignAiStatus]);
  return (
    <section className="card mb-4 p-4" aria-label="What people said">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">What people said</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show people by what they said">
        {AI_STATES.map((s) => {
          const active = activeAi === s.key;
          return (
            <Link
              key={s.key} href={`/broadcast/${id}${active ? '' : `?ai=${s.key}`}`} aria-current={active ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                active ? 'border-transparent bg-accent-soft text-accent' : 'border-border bg-surface text-muted hover:text-ink'
              }`}
            >
              {s.label}
              <b className={`font-mono font-medium tabular-nums ${active ? 'text-accent' : 'text-ink'}`}>{value(s.key)}</b>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Where the AI's chat with this person stands, as a badge; nothing before they have answered. */
function AiBadge({ status }: { status: string | null }) {
  const s = AI_STATES.find((x) => x.key === status);
  if (s === undefined) return null;
  return <span className={`badge ${s.cls}`}><span aria-hidden className="size-1.5 rounded-full bg-current" />{s.label}</span>;
}

/** Builds a link to this campaign filtered by status and search term. */
function hrefFor(id: string, status: string, query: string): string {
  const p = new URLSearchParams();
  if (status !== '') p.set('status', status);
  if (query !== '') p.set('q', query);
  const qs = p.toString();
  return `/broadcast/${id}${qs === '' ? '' : `?${qs}`}`;
}
