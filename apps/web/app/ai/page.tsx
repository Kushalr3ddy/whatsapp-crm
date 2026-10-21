import { redirect } from 'next/navigation';
import { getAiSettings, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiSettings } from '@/lib/crm';
import { PageHeader } from '../ui';
import { AiPanel } from './ai-panel';

/** Rendered per request: the switch and the consent come from the database. */
export const dynamic = 'force-dynamic';

/**
 * The AI assistant's settings: switch it on, tell it what it may talk about, and cap what it can send.
 *
 * Admin only. A non-admin who opens the address is told so; the API refuses them as well.
 */
export default async function AiPage() {
  let settings: AiSettings | null = null;
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    if (isAdmin) settings = await getAiSettings();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect('/login?next=/ai');

  return (
    <main className="page page-wide">
      <PageHeader
        title="AI assistant"
        description="An assistant that replies in conversations you assign to it. It has its own name in the inbox and in the audit log."
      />
      {failure !== null && <p className="notice notice-danger">{failure}</p>}
      {failure === null && !isAdmin && (
        <p className="notice notice-warning">Only admins can change the AI assistant. Ask an admin if you need a change.</p>
      )}
      {failure === null && settings !== null && <AiPanel settings={settings} />}
    </main>
  );
}
