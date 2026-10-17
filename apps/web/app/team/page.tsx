import { redirect } from 'next/navigation';
import { listTeam, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { TeamMember } from '@/lib/crm';
import { PageHeader } from '../ui';
import { TeamPanel } from './team-panel';

/** Rendered per request: the list changes as people are added, disabled or sign in. */
export const dynamic = 'force-dynamic';

/**
 * The Team page: who is in the organisation, and what an admin can do about it.
 *
 * Admin only. A non-admin who opens the address is told so plainly; the API refuses them as well,
 * so hiding the tab is a convenience and not the protection.
 */
export default async function TeamPage() {
  let members: TeamMember[] = [];
  let me: { userId: string | null; role: string | null } | null = null;
  let failure: string | null = null;
  let expired = false;
  try {
    me = await getMe();
    if (me.role === 'admin') members = await listTeam();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect('/login?next=/team');

  return (
    <main className="page">
      <PageHeader
        title="Team"
        description="Add people, choose what they can do, and take access away. Admins can do everything; agents work in the inbox."
      />
      {failure !== null && <p className="notice notice-danger">{failure}</p>}
      {failure === null && me?.role !== 'admin' && (
        <p className="notice notice-warning">Only admins can manage the team. Ask an admin if you need a change.</p>
      )}
      {failure === null && me?.role === 'admin' && <TeamPanel members={members} meId={me.userId} />}
    </main>
  );
}
