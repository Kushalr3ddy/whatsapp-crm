import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAiAlwaysOnRules, getAiSettings, getContactSources, getMe, listTeam, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiSettings, ContactSources, TeamMember } from '@/lib/crm';
import { PageHeader } from '../../ui';
import { AiTabs } from '../ai-tabs';
import { TemplateEditor } from '../template-editor';

/** Rendered per request: whether the AI is switched on, the team and the files come from the database. */
export const dynamic = 'force-dynamic';

/** A new template: say what it is for, answer the AI's questions, check the example, save. Needs the AI switched on to write. */
export default async function NewTemplatePage() {
  let settings: AiSettings | null = null;
  let members: TeamMember[] = [];
  let sources: ContactSources | null = null;
  let rules: string[] = [];
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    if (isAdmin) [settings, members, sources, rules] = await Promise.all([getAiSettings(), listTeam(), getContactSources(), getAiAlwaysOnRules().catch((): string[] => [])]);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect('/login?next=/ai/new');

  return (
    <main className="page page-studio">
      <div className="text-sm text-muted"><Link href="/ai" className="text-accent">AI assistant</Link> / Templates</div>
      <PageHeader title="New template" description="Say what it is for, answer the AI’s questions, check the example, save." />
      <AiTabs />
      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}
      {failure === null && !isAdmin && <p className="notice notice-warning mt-4">Only admins can change the AI assistant.</p>}
      {failure === null && isAdmin && settings?.enabled !== true && (
        <p className="notice notice-warning mt-4" role="status">
          The AI is switched off, so it cannot write a template yet. <Link href="/ai/settings" className="font-medium underline">Switch it on</Link>.
        </p>
      )}
      {failure === null && isAdmin && settings?.enabled === true && sources !== null && (
        <TemplateEditor template={null} members={members.filter((m) => !m.isBot && m.status === 'active')} sources={sources} rules={rules} usedLine="" />
      )}
    </main>
  );
}
