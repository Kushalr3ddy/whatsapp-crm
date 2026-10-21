import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAiTemplate, getMe, listTags, listSenders, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiTemplate, Sender, Tag } from '@/lib/crm';
import { PageHeader } from '../../../ui';
import { NextPanel } from './next-panel';

/** Rendered per request: the template and its use count come from the database. */
export const dynamic = 'force-dynamic';

/**
 * What to do with a saved template: its own page, reached after saving. Choosing one of the options opens its section below
 * (messaging a group, a test to yourself, answering chats), and the replies section sits at the end.
 */
export default async function TemplateNextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let template: AiTemplate | null = null;
  let tags: Tag[] = [];
  let senders: Sender[] = [];
  let isAdmin = false;
  let failure: string | null = null;
  let expired = false;
  try {
    isAdmin = (await getMe()).role === 'admin';
    if (isAdmin) [template, tags, senders] = await Promise.all([getAiTemplate(id), listTags(), listSenders()]);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    else if (error instanceof CrmApiError && error.status === 404) notFound();
    else failure = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }
  if (expired) redirect(`/login?next=/ai/t/${id}`);

  return (
    <main className="page page-wide">
      <PageHeader
        title={template?.name ?? 'AI template'}
        description="Saved. Pick what to do with it. Nothing is forced."
        actions={<Link href="/ai" className="btn btn-sm">Back to the AI page</Link>}
      />
      {failure !== null && <p className="notice notice-danger">{failure}</p>}
      {failure === null && !isAdmin && <p className="notice notice-warning">Only admins can use AI templates.</p>}
      {failure === null && template !== null && <NextPanel template={template} tags={tags} senders={senders} />}
    </main>
  );
}
