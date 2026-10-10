import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listCampaigns, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Campaign } from '@/lib/crm';
import { campaignStatusBadge } from './campaign-status';
import { PageHeader, Section, EmptyState } from '../ui';

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
  let failure: string | null = null;
  let expired = false;
  try {
    campaigns = await listCampaigns();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }

  if (expired) redirect('/login?next=/broadcast');

  const active = campaigns.filter((c) => c.status === 'running' || c.status === 'paused');
  const drafts = campaigns.filter((c) => c.status === 'draft');
  const finished = campaigns.filter((c) => !['running', 'paused', 'draft'].includes(c.status));

  return (
    <main className="page">
      <PageHeader
        title="Broadcast"
        description="Send one message to many people, paced by the anti-ban engine so a burst can never go out at once."
        actions={<Link href="/broadcast/new" className="btn btn-primary">New campaign</Link>}
      />

      <details className="card mb-6 px-4 py-2.5 text-sm">
        <summary className="cursor-pointer font-medium">How sending is paced</summary>
        <p className="mt-2 text-muted">
          Every send passes the anti-ban engine: warmup, per-minute/hour/day caps, jitter, circadian
          pacing, contact-graph gates, health scoring and a human-like typing delay. A campaign is
          deliberately slow; the forecast on each one says how long it will take.
        </p>
      </details>

      {failure !== null && <p className="notice notice-danger">{failure}</p>}

      {failure === null && campaigns.length === 0 && (
        <EmptyState
          title="No campaigns yet"
          body="Pick an audience (a tag, a segment, or an import), write the message, preview who it will reach, then start it."
          action={<Link href="/broadcast/new" className="btn btn-primary btn-sm">Create a campaign</Link>}
        />
      )}

      {active.length > 0 && (
        <Section title={`Sending now (${String(active.length)})`}>
          <CampaignList campaigns={active} />
        </Section>
      )}
      {drafts.length > 0 && (
        <Section title={`Drafts (${String(drafts.length)})`}>
          <CampaignList campaigns={drafts} />
        </Section>
      )}
      {finished.length > 0 && (
        <Section title={`Finished (${String(finished.length)})`}>
          <CampaignList campaigns={finished} />
        </Section>
      )}
    </main>
  );
}

/** A card of campaign rows. */
function CampaignList({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <ul className="card list overflow-hidden">
      {campaigns.map((c) => <CampaignRow key={c.id} campaign={c} />)}
    </ul>
  );
}

/** One campaign: name, status and when it started, linking to its per-recipient results. */
function CampaignRow({ campaign }: { campaign: Campaign }) {
  const badge = campaignStatusBadge(campaign.status);
  const when = campaign.startedAt ?? campaign.createdAt;
  return (
    <li>
      <Link
        href={`/broadcast/${campaign.id}`}
        className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-canvas"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{campaign.name}</p>
          <p className="mt-0.5 text-sm text-muted">
            {campaign.startedAt !== null ? 'Started' : 'Created'} {new Date(when).toLocaleString()}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>
    </li>
  );
}
