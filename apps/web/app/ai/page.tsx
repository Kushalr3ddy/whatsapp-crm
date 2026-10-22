import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAiSettings, getMe, listAiJobs, listAiTemplates, getAiAlwaysOnRules, getLlmSettings, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiJob, AiSettings, AiTemplate } from '@/lib/crm';
import { PageHeader } from '../ui';
import { AiPanel } from './ai-panel';
import { AiQueue } from './ai-queue';
import { TemplatesPanel } from './templates-panel';
import { AiTabs } from './ai-tabs';

/** Rendered per request: the switch and the consent come from the database. */
export const dynamic = 'force-dynamic';

/**
 * The AI assistant's settings: switch it on, tell it what it may talk about, and cap what it can send.
 *
 * Admin only. A non-admin who opens the address is told so; the API refuses them as well.
 */
export default async function AiPage() {
  let settings: AiSettings | null = null;
  let jobs: AiJob[] = [];
  let templates: AiTemplate[] = [];
  let rules: string[] = [];
  let modelReady = true;
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    modelReady = await getLlmSettings().then((l) => l.ready).catch(() => true);
    if (isAdmin) {
      [settings, jobs, templates, rules] = await Promise.all([
        getAiSettings(), listAiJobs().catch((): AiJob[] => []),
        listAiTemplates().catch((): AiTemplate[] => []), getAiAlwaysOnRules().catch((): string[] => [])
      ]);
    }
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
      <AiTabs />
      {failure === null && !modelReady && (
        <p className="notice notice-warning mt-4" role="status">
          No AI model is set up, so nothing here can write yet. <Link href="/ai/settings" className="font-medium underline">Open AI settings</Link> to choose a provider, enter its key and pick a model.
        </p>
      )}
      {failure !== null && <p className="notice notice-danger">{failure}</p>}
      {failure === null && !isAdmin && (
        <p className="notice notice-warning">Only admins can change the AI assistant. Ask an admin if you need a change.</p>
      )}
      {failure === null && settings?.enabled === true && <TemplatesPanel templates={templates} rules={rules} />}
      {failure === null && settings !== null && <AiPanel settings={settings} rules={rules} />}
      {failure === null && settings?.enabled === true && (
        <div className="mt-6"><AiQueue initial={jobs} mayStart={settings.mayStartCampaigns} /></div>
      )}
    </main>
  );
}
