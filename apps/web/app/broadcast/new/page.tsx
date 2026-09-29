import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSenders, listTags, listImportRuns, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { Sender, Tag, ImportRun } from '@/lib/crm';
import { createCampaignAction } from '../actions';

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
  { searchParams }: { searchParams: Promise<{ error?: string }> }
) {
  const { error } = await searchParams;

  let senders: Sender[] = [];
  let tags: Tag[] = [];
  let imports: ImportRun[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [senders, tags, imports] = await Promise.all([listSenders(), listTags(), listImportRuns()]);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) expired = true;
    failure = e instanceof CrmApiError
      ? `${e.code}: ${e.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }
  if (expired) redirect('/login?next=/broadcast/new');

  // A campaign needs a number to send from and an audience — a tag or an import — to aim at.
  const canSend = senders.length > 0 && (tags.length > 0 || imports.length > 0);

  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <Link href="/broadcast" className="text-xs text-muted hover:text-ink">← All campaigns</Link>
      <header className="mb-5 mt-2">
        <h1 className="text-lg font-semibold tracking-tight">New campaign</h1>
        <p className="mt-1 text-sm text-muted">
          A draft to review before it sends. Nothing goes out until you start it.
        </p>
      </header>

      {error !== undefined && (
        <p className="mb-4 rounded-lg border border-danger/50 px-3 py-2 text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
      {failure !== null && <p className="mb-4 text-sm text-danger">{failure}</p>}

      {!canSend && failure === null && (
        <p className="text-sm text-muted">
          {senders.length === 0
            ? 'Link a WhatsApp number first, on the Numbers tab.'
            : 'No audience yet — tag some contacts on the Contacts tab, or import a spreadsheet on the Import tab. A campaign aims at a tag or an import.'}
        </p>
      )}

      {canSend && (
        <form action={createCampaignAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Name</span>
            <input
              name="name" required maxLength={200}
              placeholder="e.g. October Pune outreach"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Message</span>
            <textarea
              name="body" required maxLength={4096} rows={4}
              placeholder="What every recipient receives…"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <span className="text-xs text-muted">
              Use <code>{'{{name}}'}</code> for the contact&apos;s name, and{' '}
              <code>{'{Hi|Hey|Hello}'}</code> to vary the wording — each recipient gets a slightly
              different message, which is safer than 500 identical sends.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Send from</span>
            <select
              name="senderIdentityId" required defaultValue=""
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="" disabled>Choose a number…</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label ?? 'number'}{s.phoneE164 !== null ? ` · ${s.phoneE164}` : ''}
                  {s.status !== 'active' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2 rounded-md border border-border px-3 py-3">
            <legend className="px-1 text-sm font-medium">Audience</legend>
            <p className="text-xs text-muted">
              Choose <em>one</em> — everyone carrying a tag, or everyone from an import. To pick
              specific people instead, select them on the Contacts tab. Frozen when the campaign
              starts, so changes afterwards won&apos;t alter the run.
            </p>

            {tags.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Everyone tagged</span>
                <select
                  name="fromTagId" defaultValue=""
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
                >
                  <option value="">— no tag —</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.contactCount !== undefined ? ` · ${t.contactCount} contacts` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {imports.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Everyone from an import</span>
                <select
                  name="fromImportRunId" defaultValue=""
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
                >
                  <option value="">— no import —</option>
                  {imports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.filename ?? 'import'} · {r.contactCount} contacts ·{' '}
                      {new Date(r.createdAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              className="rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-sm text-ink hover:bg-accent-soft/70"
            >
              Create draft
            </button>
            <Link href="/broadcast" className="text-sm text-muted hover:text-ink">Cancel</Link>
          </div>
        </form>
      )}
    </main>
  );
}
