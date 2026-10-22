import { redirect } from 'next/navigation';
import { getLlmSettings, getMe, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { LlmSettings } from '@/lib/crm';
import { PageHeader } from '../../ui';
import { AiTabs } from '../ai-tabs';
import { LlmForm } from './llm-form';

/** Rendered per request: what is in use comes from the settings file the API reads. */
export const dynamic = 'force-dynamic';

/**
 * AI settings: which AI provider, key and model the whole install uses. Choose the provider, enter the key, pick a model, test it, and
 * "Use this": it is saved to the settings file and applies from the next reply, with no restart. Admins only can change it; everyone
 * else can see which provider and model is in use.
 */
export default async function AiSettingsPage() {
  let settings: LlmSettings | null = null;
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    [isAdmin, settings] = await Promise.all([getMe().then((m) => m.role === 'admin'), getLlmSettings()]);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect('/login?next=/ai/settings');

  return (
    <main className="page page-wide">
      <PageHeader title="AI assistant" description="Choose which AI the assistant, the templates and the campaign wording use." />
      <AiTabs />
      {failure !== null && <p className="notice notice-danger mt-4">{failure}</p>}
      {failure === null && settings !== null && !isAdmin && (
        <section className="card mt-6 p-5">
          <p className="notice notice-warning">Only admins can change the AI provider. Ask an admin if you need a change.</p>
          <p className="mt-3 text-sm">
            {settings.ready
              ? <>In use: <strong>{settings.providers.find((p) => p.id === settings?.provider)?.label ?? settings.driver}</strong>, model <strong>{settings.model}</strong>.</>
              : 'No AI model is set up yet.'}
          </p>
        </section>
      )}
      {failure === null && settings !== null && isAdmin && <LlmForm settings={settings} />}
    </main>
  );
}
