import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSenders, listTags, listImportRuns, listSegments, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Sender, Tag, ImportRun, Segment } from '@/lib/crm';
import { createCampaignAction } from '../actions';
import { AudiencePicker } from './audience-picker';

/** Rendered per request — the sender and tag pickers reflect live data. */
export const dynamic = 'force-dynamic';

/** Turns a create error code from the redirect back into a human sentence. */
function errorMessage(code: string): string {
  switch (code) {
    case 'missing': return 'Fill in a name, a message, a number, and exactly one audience — a tag or an import.';
    case 'NOT_FOUND': return 'That number, tag or import no longer exists. Pick another.';
    case 'VALIDATION_FAILED': return 'The message is too long, or a field was invalid.';
    default: return 'Could not create the campaign. Try again.';
  }
}

/**
 * New campaign (Broadcast slice 2): name it, write the message, pick the number it sends from, and
 * choose the audience by **tag** — everyone carrying that tag, resolved and frozen when the campaign
 * starts. Creating only makes a draft; nothing sends until it is started on the next page.
 *
 * Tag targeting pairs with the Contacts page: label the people you want, then blast that label.
 * Whole-import and hand-picked audiences exist in the API and are a later addition here.
 */
export default async function NewCampaignPage(
  { searchParams }: { searchParams: Promise<{ error?: string; import?: string }> }
) {
  const { error, import: importId } = await searchParams;

  let senders: Sender[] = [];
  let tags: Tag[] = [];
  let imports: ImportRun[] = [];
  let segments: Segment[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [senders, tags, imports, segments] = await Promise.all([
      listSenders(), listTags(), listImportRuns(), listSegments()
    ]);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) expired = true;
    failure = e instanceof CrmApiError
      ? `${e.code}: ${e.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect('/login?next=/broadcast/new');

  // A campaign needs a number to send from and an audience — a tag, an import, or a segment.
  // A filter can always be built inline, so a number is the only prerequisite.
  const canSend = senders.length > 0;

  /** A numbered step heading, so the form reads as three decisions rather than one long list. */
  const step = (n: number, title: string, hint?: string) => (
    <div className="mb-3 flex items-start gap-3">
      <span className="avatar size-7 text-sm" aria-hidden>{n}</span>
      <div>
        <h2 className="font-semibold leading-7">{title}</h2>
        {hint !== undefined && <p className="text-sm text-muted">{hint}</p>}
      </div>
    </div>
  );

  return (
    <main className="page page-narrow">
      <Link href="/broadcast" className="text-sm text-muted hover:text-ink">← All campaigns</Link>
      <header className="mb-6 mt-3">
        <h1 className="page-title">New campaign</h1>
        <p className="page-desc">A draft to review before it sends. Nothing goes out until you start it.</p>
      </header>

      {error !== undefined && <p role="alert" className="notice notice-danger mb-4">{errorMessage(error)}</p>}
      {failure !== null && <p className="notice notice-danger mb-4">{failure}</p>}

      {!canSend && failure === null && (
        <p className="notice">
          {senders.length === 0
            ? 'Link a WhatsApp number first, on the Numbers tab.'
            : 'Something went wrong loading this form. Try again.'}
        </p>
      )}

      {canSend && (
        <form action={createCampaignAction} className="flex flex-col gap-5">
          <section className="card p-5">
            {step(1, 'Write the message')}
            <label className="mb-3 flex flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <input name="name" required maxLength={200} placeholder="e.g. October Pune outreach" className="field" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Message</span>
              <textarea
                name="body" required maxLength={4096} rows={5}
                placeholder="What every recipient receives…" className="field"
              />
              <span className="text-sm text-muted">
                Use <code>{'{{name}}'}</code> for the contact&apos;s name, and <code>{'{Hi|Hey|Hello}'}</code> to
                vary the wording — each recipient gets a slightly different message, which is safer than 500
                identical sends.
              </span>
            </label>
          </section>

          <section className="card p-5">
            {step(2, 'Choose who gets it', 'Pick one. The audience is frozen when you start, so later changes will not alter the run.')}
            <AudiencePicker
              tags={tags}
              defaultImportId={importId}
              imports={imports.map((r) => ({
                id: r.id,
                label: `${r.filename ?? 'import'} · ${String(r.contactCount)} contacts · ${new Date(r.createdAt).toLocaleDateString()}`
              }))}
              segments={segments}
            />
            <p className="mt-3 text-sm text-muted">
              To pick specific people instead, tick them on the Contacts tab.
            </p>
          </section>

          <section className="card p-5">
            {step(3, 'Send from')}
            <select name="senderIdentityId" required defaultValue="" aria-label="Send from" className="field w-full">
              <option value="" disabled>Choose a number…</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label ?? 'number'}{s.phoneE164 !== null ? ` · ${s.phoneE164}` : ''}
                  {s.status !== 'active' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          </section>

          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary">Create draft</button>
            <Link href="/broadcast" className="text-sm text-muted hover:text-ink">Cancel</Link>
          </div>
        </form>
      )}
    </main>
  );
}
