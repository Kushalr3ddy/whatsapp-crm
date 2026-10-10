import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listCampaigns, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Campaign } from '@/lib/crm';
import { campaignStatusBadge } from './campaign-status';

/** Rendered per request — campaigns are live data that changes as the gateway dispatches. */
export const dynamic = 'force-dynamic';

/**
 * Broadcast — the campaigns list, and the way into each campaign's per-recipient results.
 *
 * Its own section rather than something inside the inbox on purpose: a campaign to 500 people
 * would otherwise bury every real conversation. This first slice is read-only — you can see what
 * campaigns exist and, drilling in, exactly who each one reached and why not the rest. Creating a
 * campaign is still over the API; a create → target → forecast → start flow is the next slice.
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

  return (
    <main className="page">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Broadcast</h1>
          <p className="page-desc">
            Send one message to many people, paced by the anti-ban engine so a burst can never go out
            at once. Open a campaign to see who it reached and who was skipped.
          </p>
        </div>
        <Link
          href="/broadcast/new"
          className="shrink-0 btn btn-primary"
        >
          New campaign
        </Link>
      </header>

      <p className="mb-5 notice">
        Every send passes the anti-ban engine — warmup, per-minute/hour/day caps, jitter, circadian
        pacing, contact-graph gates, health scoring and a human-like typing delay. A campaign is
        deliberately slow; the forecast on each one says how long it will take.
      </p>

      {failure !== null && <p className="text-sm text-danger">{failure}</p>}

      {failure === null && campaigns.length === 0 && (
        <p className="text-sm text-muted">
          No campaigns yet. They are created over the API for now (a create flow is the next slice);
          once one is started, it appears here with its per-recipient results.
        </p>
      )}

      {campaigns.length > 0 && (
        <ul className="card list">
          {campaigns.map((c) => <CampaignRow key={c.id} campaign={c} />)}
        </ul>
      )}
    </main>
  );
}

/** One campaign in the list: its name, status and when it started, linking to its results. */
function CampaignRow({ campaign }: { campaign: Campaign }) {
  const badge = campaignStatusBadge(campaign.status);
  const when = campaign.startedAt ?? campaign.createdAt;
  return (
    <li>
      <Link
        href={`/broadcast/${campaign.id}`}
        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent-soft/40"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{campaign.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {campaign.startedAt !== null ? 'started' : 'created'} {new Date(when).toLocaleString()}
          </p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${badge.cls}`}>
          {badge.label}
        </span>
      </Link>
    </li>
  );
}
