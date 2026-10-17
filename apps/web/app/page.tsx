import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSenders, listConversations, listCampaigns, countContacts, getMe,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Sender, Conversation, Campaign } from '@/lib/crm';
import { campaignStatusBadge } from './broadcast/campaign-status';
import { PageHeader, Stat, Section, EmptyState, initialsOf } from './ui';

/** Rendered per request — an overview of live state is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** How a number is doing, in one badge. The socket decides "can it send"; status decides "is it healthy". */
function numberBadge(s: Sender): { label: string; cls: string } {
  if (s.status === 'quarantined') return { label: 'Quarantined', cls: 'badge-danger' };
  if (s.connectionState !== 'open') return { label: 'Not connected', cls: 'badge-warning' };
  if (s.status === 'degraded') return { label: 'Degraded', cls: 'badge-warning' };
  return { label: 'Connected', cls: 'badge-success' };
}

/**
 * The landing screen: how the whole operation is doing at a glance — are the numbers up, is anyone
 * waiting on a reply, what is running — with a way into each. It reads only things other screens
 * already own, so it can never disagree with them.
 */
export default async function Home() {
  let senders: Sender[] = [];
  let conversations: Conversation[] = [];
  let campaigns: Campaign[] = [];
  let contacts = 0;
  let name: string | null = null;
  let failure: string | null = null;
  let expired = false;
  try {
    const [s, c, k, n, me] = await Promise.all([
      listSenders(), listConversations(), listCampaigns(), countContacts(), getMe()
    ]);
    senders = s; conversations = c; campaigns = k; contacts = n;
    name = me.role === null ? null : me.role;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect('/login');

  const connected = senders.filter((s) => s.connectionState === 'open' && s.status !== 'quarantined');
  const needsAttention = senders.filter((s) => s.status === 'quarantined' || s.status === 'degraded');
  const open = conversations.filter((c) => c.status === 'open');
  const unread = open.reduce((n, c) => n + c.unreadCount, 0);
  const waiting = conversations.reduce((n, c) => n + c.queuedCount, 0);
  const running = campaigns.filter((c) => c.status === 'running');
  void name;

  return (
    <main className="page">
      <PageHeader
        title="Overview"
        description="How your numbers, conversations and campaigns are doing right now."
        actions={
          <>
            <Link href="/import" className="btn">Import contacts</Link>
            <Link href="/broadcast/new" className="btn btn-primary">New campaign</Link>
          </>
        }
      />

      {failure !== null && <p className="notice notice-danger mb-6">{failure}</p>}

      {failure === null && needsAttention.length > 0 && (
        <p role="alert" className="notice notice-warning mb-6">
          {needsAttention.length === 1 ? 'One number needs' : `${String(needsAttention.length)} numbers need`}{' '}
          attention: {needsAttention.map((s) => s.label ?? s.phoneE164 ?? 'number').join(', ')}.{' '}
          <Link href="/link" className="font-medium underline">Open Numbers</Link>
        </p>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Linked numbers" href="/link"
          value={`${String(connected.length)}/${String(senders.length)}`}
          hint={senders.length === 0 ? 'None added yet' : connected.length === senders.length ? 'All connected' : 'connected'}
          tone={senders.length === 0 || connected.length === senders.length ? 'default' : 'warning'}
        />
        <Stat
          label="Open conversations" href="/inbox" value={open.length}
          hint={unread > 0 ? `${String(unread)} unread` : 'Nothing unread'}
          tone={unread > 0 ? 'warning' : 'default'}
        />
        <Stat label="Contacts" href="/contacts" value={contacts} hint="in your book" />
        <Stat
          label="Campaigns" href="/broadcast" value={running.length}
          hint={running.length === 1 ? 'running now' : 'running now'}
          tone={running.length > 0 ? 'success' : 'default'}
        />
      </div>

      {waiting > 0 && (
        <p className="notice notice-warning mb-6">
          {waiting} message{waiting === 1 ? ' is' : 's are'} queued and not sent yet — usually a number that
          is not connected or pacing itself.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Linked numbers" action={<Link href="/link" className="text-sm text-accent">Manage</Link>}>
          {senders.length === 0 ? (
            <EmptyState
              title="No number yet"
              body="Add and link a WhatsApp number to start sending and receiving."
              action={<Link href="/link" className="btn btn-primary btn-sm">Link a number</Link>}
            />
          ) : (
            <ul className="card list">
              {senders.map((s) => {
                const b = numberBadge(s);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.label ?? 'Unnamed number'}</p>
                      <p className="truncate text-sm text-muted">{s.phoneE164 ?? 'no number yet'}</p>
                    </div>
                    <span className={`badge ${b.cls}`}>{b.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Latest conversations" action={<Link href="/inbox" className="text-sm text-accent">Open inbox</Link>}>
          {conversations.length === 0 ? (
            <EmptyState title="No conversations yet" body="They appear here once a message is sent or received." />
          ) : (
            <ul className="card list">
              {conversations.slice(0, 6).map((c) => {
                const title = c.contactName ?? c.contactPhone ?? 'Unknown';
                return (
                  <li key={c.id}>
                    <Link href={`/inbox/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                      <span className="avatar size-9 text-sm" aria-hidden>{initialsOf(title)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{title}</span>
                        <span className="block truncate text-sm text-muted">
                          {c.assigneeName ?? 'Unassigned'} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      {c.unreadCount > 0 && <span className="badge badge-accent tabular-nums">{c.unreadCount}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="lg:col-span-2">
          <Section title="Recent campaigns" action={<Link href="/broadcast" className="text-sm text-accent">All campaigns</Link>}>
            {campaigns.length === 0 ? (
              <EmptyState
                title="No campaigns yet"
                body="Send one message to many people, paced so a burst never goes out at once."
                action={<Link href="/broadcast/new" className="btn btn-primary btn-sm">Create a campaign</Link>}
              />
            ) : (
              <ul className="card list">
                {campaigns.slice(0, 5).map((c) => {
                  const badge = campaignStatusBadge(c.status);
                  return (
                    <li key={c.id}>
                      <Link href={`/broadcast/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="block text-sm text-muted">
                            {c.startedAt !== null ? `started ${new Date(c.startedAt).toLocaleString()}` : 'draft'}
                          </span>
                        </span>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
