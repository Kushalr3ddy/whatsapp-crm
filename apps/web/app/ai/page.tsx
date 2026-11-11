import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAiSettings, getMe, listAiTemplates, listDeletedAiTemplates, getLlmSettings, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiSettings, AiTemplate, LlmSettings } from '@/lib/crm';
import { PageHeader } from '../ui';
import { AiTabs } from './ai-tabs';
import { TemplatesHome } from './templates-home';
import { SetupSteps } from './setup-steps';

/** Rendered per request: the templates, the switch and the consent come from the database. */
export const dynamic = 'force-dynamic';

/**
 * The AI assistant: the templates are its home. Each template is a playbook for one kind of conversation; campaigns that use one get
 * their openings written and their replies answered by the AI. Admin only.
 */
export default async function AiPage() {
  let settings: AiSettings | null = null;
  let llm: LlmSettings | null = null;
  let templates: AiTemplate[] = [];
  let deleted: AiTemplate[] = [];
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    llm = await getLlmSettings().catch(() => null);
    if (isAdmin) {
      [settings, templates, deleted] = await Promise.all([
        getAiSettings(), listAiTemplates().catch((): AiTemplate[] => []), listDeletedAiTemplates().catch((): AiTemplate[] => [])
      ]);
    }
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect('/login?next=/ai');

  const provider = llm === null ? null : (llm.providers.find((p) => p.id === llm?.provider)?.label ?? llm.driver);
  const ready = settings?.enabled === true && llm?.ready === true;
  const consented = settings?.consentAcceptedAt !== null && settings?.consentAcceptedAt !== undefined;
  // First run: no working model yet, or nobody has agreed that messages are shared.
  const needsSetup = isAdmin && settings !== null && (llm?.ready !== true || !consented);

  return (
    <main className="page page-studio">
      <PageHeader
        title="AI assistant"
        description="Build a template once. Campaigns that use it get their openings written and their replies answered by the AI."
      />
      {failure === null && needsSetup && <SetupSteps modelReady={llm?.ready === true} modelLabel={provider} consented={consented} />}
      {failure === null && isAdmin && settings !== null && !needsSetup && (
        <section className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm" aria-label="AI status">
          {ready
            ? <span className="inline-flex items-center gap-2 font-medium text-success"><span className="h-2 w-2 rounded-full bg-current" />Ready</span>
            : <span className="inline-flex items-center gap-2 font-medium text-warning"><span className="h-2 w-2 rounded-full bg-current" />{llm?.ready === true ? 'Switched off' : 'No AI model'}</span>}
          <span className="min-w-0 flex-1 basis-72 text-muted">
            {ready
              ? <>{provider} · at most {settings.dailyMessageCap} AI messages a day.</>
              : llm?.ready === true
                ? 'The AI is off, so templates cannot write or answer yet.'
                : 'No AI model is set up, so nothing here can write yet.'}
          </span>
          <Link href="/ai/settings" className="btn btn-sm btn-ghost">{ready ? 'Change' : llm?.ready === true ? 'Switch on' : 'Set up'}</Link>
        </section>
      )}
      <AiTabs />
      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}
      {failure === null && !isAdmin && (
        <p className="notice notice-warning mt-4">Only admins can change the AI assistant. Ask an admin if you need a change.</p>
      )}
      {failure === null && isAdmin && <TemplatesHome templates={templates} deleted={deleted} />}
    </main>
  );
}
