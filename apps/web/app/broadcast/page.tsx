import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ChevronRight, Megaphone } from 'lucide-react';
import { listCampaigns, getCampaignEta, NotAuthenticatedError } from '@/lib/crm';
import type { Campaign, CampaignEta } from '@/lib/crm';
import { campaignStatusBadge } from './campaign-status';
import { PageHeader, EmptyState } from '../ui';
import { etaLine, formatWhen } from '@/lib/campaign-time';

/** Rendered per request — campaigns are live data that changes as the gateway dispatches. */
export const dynamic = 'force-dynamic';

/**
 * Broadcast — every campaign, grouped by what you would want to do with it: the ones sending now,
 * the drafts you have not started, and the finished ones. Its own section rather than something
 * inside the inbox on purpose: a campaign to 500 people would otherwise bury every real
 * conversation. Open one to see exactly who it reached and why not the rest.
 */
export default async function BroadcastPage() {
  let campaigns: Campaign[] = [];
  let failure = false;
  let expired = false;
  try {
    campaigns = await listCampaigns();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = true;
  }

  if (expired) redirect('/login?next=/broadcast');

  const active = campaigns.filter((c) => c.status === 'running' || c.status === 'paused');
  const drafts = campaigns.filter((c) => c.status === 'draft');
  const finished = campaigns.filter((c) => !['running', 'paused', 'draft'].includes(c.status));

  // One estimate per campaign that is sending. A campaign whose estimate cannot be read just shows no finish time.
  const etas = new Map<string, CampaignEta | null>(await Promise.all(
    active.filter((c) => c.status === 'running').map(async (c): Promise<[string, CampaignEta | null]> =>
      [c.id, await getCampaignEta(c.id).catch((): null => null)])
  ));

  return (
    <main className="page page-full">
      <PageHeader
        title="Campaigns"
        description="Send one message to many people, a few at a time, so a burst never goes out at once."
        actions={
          <>
            <Link href="/segments" className="btn">Saved audiences</Link>
            <Link href="/broadcast/new" className="btn btn-primary">New campaign</Link>
          </>
        }
      />

      {failure && (
        <div role="alert" className="notice notice-danger flex flex-wrap items-center justify-between gap-3">
          <p>We couldn&apos;t load your campaigns. Check your connection and try again.</p>
          <Link href="/broadcast" className="btn btn-sm">Try again</Link>
        </div>
      )}

      {!failure && campaigns.length === 0 && (
        <EmptyState
          title="No campaigns yet"
          body="Pick an audience (a tag, a segment, or an import), write the message, preview who it will reach, then start it."
          action={<Link href="/broadcast/new" className="btn btn-primary btn-sm">Create a campaign</Link>}
        />
      )}

      <div className="flex flex-col gap-6">
        {active.length > 0 && <Group title="Sending now" campaigns={active} etas={etas} />}
        {drafts.length > 0 && <Group title="Drafts" campaigns={drafts} etas={etas} />}
        {finished.length > 0 && <Group title="Finished" campaigns={finished} etas={etas} />}
      </div>
    </main>
  );
}

/** A titled card of campaign rows, with how many there are. */
function Group({ title, campaigns, etas }: { title: string; campaigns: Campaign[]; etas: Map<string, CampaignEta | null> }) {
  return (
    <section aria-label={title}>
      <h2 className="section-title mb-2.5 flex items-baseline gap-2">
        {title} <b className="font-mono font-medium text-ink">{campaigns.length}</b>
      </h2>
      <ul className="card list overflow-hidden">
        {campaigns.map((c, i) => <CampaignRow key={c.id} campaign={c} index={i} eta={etaLine(etas.get(c.id) ?? null)} />)}
      </ul>
    </section>
  );
}

/** The first part of the message, with each {{fill-in}} drawn as a small chip instead of raw brackets. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/\{\{(\w+)\}\}/);
  return (
    <>
      “{parts.map((p, i) => i % 2 === 1
        ? <span key={i} className="rounded-md bg-accent-soft px-1.5 font-mono text-xs text-accent">{p}</span>
        : p)}”
    </>
  );
}

/** One campaign: name, status, when it started, who it reaches and from which number, and the start of the message. */
function CampaignRow({ campaign, index, eta }: { campaign: Campaign; index: number; eta: string | null }) {
  const badge = campaignStatusBadge(campaign.status);
  const when = campaign.startedAt ?? campaign.createdAt;
  const sender = campaign.senderLabel ?? campaign.senderPhone ?? null;
  return (
    <li className="row-in" style={{ '--i': Math.min(index, 12) } as CSSProperties}>
      <Link
        href={`/broadcast/${campaign.id}`}
        className="grid min-h-[4.5rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 px-[1.125rem] py-3.5 transition-colors hover:bg-surface-2"
      >
        <span aria-hidden className="flex size-9 items-center justify-center rounded-[0.625rem] bg-accent-soft text-accent">
          <Megaphone size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="break-words font-medium">{campaign.name}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3.5 text-sm text-muted">
            <span>{campaign.startedAt !== null ? 'Started' : 'Created'} {formatWhen(when)}</span>
            {campaign.audienceSize !== undefined && (
              <span><b className="font-mono font-medium text-ink">{campaign.audienceSize}</b> {campaign.audienceSize === 1 ? 'person' : 'people'}</span>
            )}
            {sender !== null && (
              <span>from {sender}{campaign.senderLabel !== null && campaign.senderPhone !== null && campaign.senderPhone !== undefined ? ` ${campaign.senderPhone}` : ''}</span>
            )}
            {eta !== null && <span className="font-medium text-accent">{eta}</span>}
          </p>
          {campaign.bodySnippet !== undefined && campaign.bodySnippet !== '' && (
            <p className="mt-1 truncate text-sm text-muted"><Snippet text={campaign.bodySnippet} /></p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <span className={`badge hidden sm:inline-flex ${badge.cls}`}>
            <span aria-hidden className={`size-1.5 rounded-full bg-current ${campaign.status === 'running' ? 'live-dot' : ''}`} />
            {badge.label}
          </span>
          <ChevronRight aria-hidden size={16} strokeWidth={2} className="text-muted" />
        </span>
      </Link>
    </li>
  );
}
