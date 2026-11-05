import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSenders, listConversations, listCampaigns, countContacts, getMe, listTeam,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Sender, Conversation, Campaign } from '@/lib/crm';
import { campaignStatusBadge } from './broadcast/campaign-status';
import { PageHeader, Stat, Section, EmptyState, Checklist, GlyphIcon, initialsOf } from './ui';

/** Rendered per request — an overview of live state is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** How a number is doing, in one badge: the socket decides "can it send". */
function numberBadge(s: Sender): { label: string; cls: string } {
  if (s.connectionState !== 'open') return { label: 'Not linked', cls: 'badge-warning' };
  return { label: 'Linked', cls: 'badge-success' };
}

/** "Good morning/afternoon/evening" for the install's time zone (SEND_TIMEZONE), or a plain "Welcome" if it is not valid. */
function greeting(): string {
  try {
    const zone = process.env.SEND_TIMEZONE ?? 'Asia/Kolkata';
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(new Date()));
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  } catch {
    return 'Welcome';
  }
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
  let isAdmin = false;
  let teamSize = 1;
  let failure: string | null = null;
  let expired = false;
  try {
    const [s, c, k, n, me] = await Promise.all([
      listSenders(), listConversations(), listCampaigns(), countContacts(), getMe()
    ]);
    senders = s; conversations = c; campaigns = k; contacts = n;
    name = me.role === null ? null : me.role;
    isAdmin = me.role === 'admin';
    // Only an admin may list the team; if it cannot be read the checklist simply leaves that step out.
    if (isAdmin) teamSize = await listTeam().then((t) => t.length).catch(() => 1);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect('/login');

  const connected = senders.filter((s) => s.connectionState === 'open');
  const open = conversations.filter((c) => c.status === 'open');
  const unread = open.reduce((n, c) => n + c.unreadCount, 0);
  const waiting = conversations.reduce((n, c) => n + c.queuedCount, 0);
  const running = campaigns.filter((c) => c.status === 'running');
  void name;

  return (
    <main className="page">
      <PageHeader
        title={`${greeting()}, ${isAdmin ? 'Admin' : 'User'}`}
        description="How your numbers, conversations and campaigns are doing right now."
        actions={
          <>
            <Link href="/import" className="btn">Import contacts</Link>
            <Link href="/broadcast/new" className="btn btn-primary">New campaign</Link>
          </>
        }
      />

      {failure !== null && <p className="notice notice-danger mb-6">{failure}</p>}

      {failure === null && (
        <GettingStarted
          hasNumber={connected.length > 0} hasContacts={contacts > 0}
          hasCampaign={campaigns.length > 0} isAdmin={isAdmin} hasTeam={teamSize > 1}
        />
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Linked numbers" href="/link" icon={<GlyphIcon><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></GlyphIcon>}
          value={`${String(connected.length)}/${String(senders.length)}`}
          hint={senders.length === 0 ? 'None added yet' : connected.length === senders.length ? 'All connected' : 'connected'}
          tone={senders.length === 0 || connected.length === senders.length ? 'default' : 'warning'}
        />
        <Stat
          label="Open conversations" href="/inbox" value={open.length}
          icon={<GlyphIcon><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></GlyphIcon>}
          hint={unread > 0 ? `${String(unread)} unread` : 'Nothing unread'}
          tone={unread > 0 ? 'warning' : 'default'}
        />
        <Stat label="Contacts" href="/contacts" value={contacts} hint="in your book" icon={<GlyphIcon><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /></GlyphIcon>} />
        <Stat
          label="Campaigns" href="/broadcast" value={running.length}
          icon={<GlyphIcon><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></GlyphIcon>}
          hint={running.length === 1 ? 'running now' : 'running now'}
          tone={running.length > 0 ? 'success' : 'default'}
        />
      </div>

      {waiting > 0 && (
        <p className="notice notice-warning mb-6">
          {waiting} message{waiting === 1 ? ' is' : 's are'} queued and not sent yet — usually a number that
          is not connected.
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
                body="Send one message to many people, a few at a time rather than all at once."
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

/**
 * The first-run checklist on the Overview. It disappears once every step is done, so it only shows
 * while it is useful. "Invite your team" only appears for admins, who are the ones who can.
 */
function GettingStarted(
  { hasNumber, hasContacts, hasCampaign, isAdmin, hasTeam }:
  { hasNumber: boolean; hasContacts: boolean; hasCampaign: boolean; isAdmin: boolean; hasTeam: boolean }
) {
  const steps = [
    { label: 'Add and link a WhatsApp number', hint: 'Scan one QR code with the phone you want to send from.', href: '/link', done: hasNumber, cta: 'Add a number' },
    { label: 'Bring in your contacts', hint: 'Upload a CSV or Excel sheet; the columns match themselves.', href: '/import', done: hasContacts, cta: 'Import contacts' },
    ...(isAdmin ? [{ label: 'Invite your team', hint: 'Add the people who will answer messages, and choose what they can do.', href: '/team', done: hasTeam, cta: 'Open Team' }] : []),
    { label: 'Send your first campaign', hint: 'Pick an audience, write the message, preview, and start it.', href: '/broadcast/new', done: hasCampaign, cta: 'New campaign' }
  ];
  if (steps.every((s) => s.done)) return null;
  return <Checklist steps={steps} />;
}
