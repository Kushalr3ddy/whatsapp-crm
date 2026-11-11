import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSenders, listTags, listImportRuns, listSegments, listAiTemplates, getAudienceHistory, countContacts, getCampaign,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Sender, Tag, ImportRun, Segment, AiTemplate, AudienceHistory, CampaignDetail, ReviewTarget } from '@/lib/crm';
import { NewCampaign, type EditingDraft } from './new-campaign';

/** Rendered per request: the files, tags and numbers reflect live data. */
export const dynamic = 'force-dynamic';

/** Turns a create error code from the redirect back into a human sentence. */
function errorMessage(code: string): string {
  switch (code) {
    case 'missing': return 'Fill in a name, a message, a number, and who gets it.';
    case 'NOT_FOUND': return 'That number, tag or file no longer exists, or nobody is in what you picked. Pick again.';
    case 'VALIDATION_FAILED': return 'The message is too long, or a field was invalid.';
    case 'NOT_EDITABLE': return 'This campaign has started, so it can no longer be changed.';
    default: return 'Could not create the campaign. Try again.';
  }
}

/**
 * New campaign: three steps (the message, who gets it, the number it sends from) and a review that updates as you go. Creating only
 * makes a draft; nothing sends until it is started on the next page.
 */
export default async function NewCampaignPage(
  { searchParams }: { searchParams: Promise<{ error?: string; tag?: string; import?: string; edit?: string; template?: string }> }
) {
  const { error, tag, import: importId, edit, template: templateParam } = await searchParams;

  let senders: Sender[] = [];
  let tags: Tag[] = [];
  let imports: ImportRun[] = [];
  let templates: AiTemplate[] = [];
  let history: AudienceHistory = { imports: {}, tags: {}, segments: {} };
  let everyoneCount = 0;
  let segments: Segment[] = [];
  let draft: CampaignDetail | null = null;
  let failure: string | null = null;
  let expired = false;
  try {
    [senders, tags, imports, templates, history, everyoneCount] = await Promise.all([
      listSenders(), listTags(), listImportRuns(),
      listAiTemplates().catch((): AiTemplate[] => []),
      getAudienceHistory().catch((): AudienceHistory => ({ imports: {}, tags: {}, segments: {} })),
      countContacts().catch(() => 0)
    ]);
    // Editing: the draft to open, and the saved lists its picks may name.
    if (edit !== undefined) {
      draft = await getCampaign(edit);
      segments = await listSegments().catch((): Segment[] => []);
    }
  } catch (e) {
    if (e instanceof NotAuthenticatedError) expired = true;
    failure = e instanceof CrmApiError
      ? `${e.code}: ${e.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect(`/login?next=${edit === undefined ? '/broadcast/new' : `/broadcast/new?edit=${edit}`}`);
  // Only a draft can be edited: once it has started, go to its page.
  if (draft !== null && (draft as CampaignDetail).status !== 'draft') redirect(`/broadcast/${edit ?? ''}`);

  // A campaign needs a number to send from.
  const canSend = senders.length > 0;
  const editing: EditingDraft | undefined = draft === null ? undefined : editingFrom(draft as CampaignDetail);

  return (
    <main className="page page-full" style={{ maxWidth: '73.75rem' }}>
      <p className="text-sm text-muted"><Link href="/broadcast" className="hover:text-ink">Campaigns</Link> / <b className="font-medium text-ink">{editing === undefined ? 'New campaign' : 'Edit draft'}</b></p>
      <header className="mb-5 mt-3">
        <h1 className="page-title">{editing === undefined ? 'New campaign' : 'Edit draft'}</h1>
        <p className="page-desc">{editing === undefined ? 'A draft to review before it sends. Nothing goes out until you start it.' : 'Change anything, then save. Nothing goes out until you start it.'}</p>
      </header>

      {error !== undefined && <p role="alert" className="notice notice-danger mb-4">{errorMessage(error)}</p>}
      {failure !== null && <p className="notice notice-danger mb-4">{failure}</p>}

      {!canSend && failure === null && <p className="notice">Link a WhatsApp number first, on the Numbers tab.</p>}

      {canSend && (
        <NewCampaign
          senders={senders} imports={imports} tags={tags} templates={templates} history={history} everyoneCount={everyoneCount}
          defaultImportId={importId} defaultTagId={tag} segments={segments} editing={editing} defaultTemplateId={templateParam}
        />
      )}
    </main>
  );
}

/** What the form needs to open a draft with everything it was made with. */
function editingFrom(c: CampaignDetail): EditingDraft {
  // Made on this screen: the picks are kept. Made another way (a tag from Contacts, a ticked list): the columns say who.
  let targets: ReviewTarget[] = c.audienceTargets ?? [];
  if (targets.length === 0) {
    if (c.fromImportRunId !== null) targets = [{ kind: 'import', id: c.fromImportRunId }];
    else if (c.fromTagId !== null) targets = [{ kind: 'tag', id: c.fromTagId }];
    else if (c.fromSegmentId !== null) targets = [{ kind: 'segment', id: c.fromSegmentId }];
    else if (c.explicitContactIds !== null) targets = [{ kind: 'people', ids: c.explicitContactIds }];
  }
  return {
    id: c.id, name: c.name, body: c.body, senderIdentityId: c.senderIdentityId, targets,
    mediaAssetId: c.mediaAssetId, mediaFilename: c.mediaFilename, mediaSizeBytes: c.mediaSizeBytes, mediaAfterReply: c.mediaAfterReply,
    aiTemplateId: c.aiTemplateId, blankFillInChoice: c.blankFillInChoice, recentDays: c.recentDays, leaveOutRecent: c.leaveOutRecent
  };
}
