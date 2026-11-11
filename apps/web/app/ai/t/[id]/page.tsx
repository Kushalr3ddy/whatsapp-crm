import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAiAlwaysOnRules, getAiSettings, getAiTemplate, getContactSources, getMe, listTeam, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiSettings, AiTemplate, ContactSources, TeamMember } from '@/lib/crm';
import { PageHeader } from '../../../ui';
import { AiTabs } from '../../ai-tabs';
import { TemplateEditor } from '../../template-editor';

/** Rendered per request: the template and what it is used in come from the database. */
export const dynamic = 'force-dynamic';

/** "Used in 4 campaigns · last on 1 Nov 2026", or "Not used yet". */
function usedLine(t: AiTemplate): string {
  if (t.campaignCount === 0) return 'Not used yet';
  const last = t.lastUsedAt === null ? '' : ` · last on ${new Date(t.lastUsedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  return `Used in ${String(t.campaignCount)} ${t.campaignCount === 1 ? 'campaign' : 'campaigns'}${last}`;
}

/** Opens a saved template in the editor. Change it here once: campaigns, the example and the inbox all use this one template. */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let template: AiTemplate | null = null;
  let members: TeamMember[] = [];
  let sources: ContactSources | null = null;
  let settings: AiSettings | null = null;
  let rules: string[] = [];
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    if (isAdmin) {
      [template, members, sources, settings, rules] = await Promise.all([
        getAiTemplate(id), listTeam(), getContactSources(), getAiSettings(), getAiAlwaysOnRules().catch((): string[] => [])
      ]);
    }
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    else if (error instanceof CrmApiError && error.status === 404) notFound();
    else failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect(`/login?next=/ai/t/${id}`);

  return (
    <main className="page page-studio">
      <div className="text-sm text-muted"><Link href="/ai" className="text-accent">AI assistant</Link> / Templates</div>
      <PageHeader
        title={template?.name ?? 'AI template'}
        description={template === null ? undefined : `${usedLine(template)}. A template can be used in any number of campaigns. Change it here once. Campaigns, the example and the inbox all use this one template.`}
      />
      <AiTabs />
      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}
      {failure === null && !isAdmin && <p className="notice notice-warning mt-4">Only admins can change AI templates.</p>}
      {failure === null && isAdmin && settings?.enabled !== true && <p className="notice notice-warning mt-4">The AI is off, so the example cannot be written. You can still change and save the template.</p>}
      {failure === null && template !== null && sources !== null && (
        <TemplateEditor key={template.updatedAt} template={template} members={members.filter((m) => !m.isBot && m.status === 'active')} sources={sources} rules={rules} usedLine={usedLine(template)} />
      )}
    </main>
  );
}
