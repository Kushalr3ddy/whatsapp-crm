import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listContacts, listTags, listSenders, listCustomFields, listCampaigns, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Contact, Tag, Sender, CustomField, Campaign } from '@/lib/crm';
import {
  createFieldAction, deleteFieldAction, saveContactFieldsAction, setDncAction,
  bulkTagPreviewAction, bulkTagConfirmAction, bulkTagCheckedAction,
  createTagAction, attachTagAction, detachTagAction, createCampaignFromSelectionAction
} from './actions';
import { PageHeader, EmptyState, initialsOf } from '../ui';
import { TagChip } from './tag-chip';
import { RemoveTag } from './remove-tag';

/** Rendered per request — the search term and tag filter come from the query string. */
export const dynamic = 'force-dynamic';

/**
 * The contacts screen: search by name/phone/email, filter by tag, and label people.
 *
 * Everything is server-rendered — the search box and every tag action are plain forms, so this
 * works with no client JavaScript. It is what lets an operator find and label specific people out
 * of an imported book, which is the raw material for hand-picking a campaign audience.
 */
export default async function ContactsPage(
  { searchParams }: {
    searchParams: Promise<{
      q?: string; tag?: string; campaignError?: string;
      bulkTag?: string; bulkAction?: string; bulkScope?: string; bulkCount?: string;
      bulkDone?: string; bulkError?: string;
    }>;
  }
) {
  const sp = await searchParams;
  const { q, tag, campaignError } = sp;
  const query = typeof q === 'string' ? q : '';
  const activeTag = typeof tag === 'string' ? tag : '';

  let contacts: Contact[] = [];
  let tags: Tag[] = [];
  let senders: Sender[] = [];
  let fields: CustomField[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [contacts, tags, senders, fields] = await Promise.all([
      listContacts({ q: query, tag: activeTag }),
      listTags(),
      listSenders(),
      listCustomFields()
    ]);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) expired = true;
    failure = error instanceof CrmApiError
      ? `${error.code}: ${error.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }

  if (expired) redirect('/login?next=/contacts');

  // Campaigns already aimed at the tag being looked at, so the page can offer to reuse one instead of starting another.
  let tagCampaigns: Campaign[] = [];
  if (activeTag !== '') {
    try { tagCampaigns = await listCampaigns(activeTag); } catch { tagCampaigns = []; }
  }

  const bulkOpen = sp.bulkTag !== undefined || sp.bulkDone !== undefined || sp.bulkError !== undefined;
  const activeTagName = tags.find((t) => t.id === activeTag)?.name;

  return (
    <main className="page">
      <PageHeader
        title="Contacts"
        description={
          failure === null
            ? `${String(contacts.length)}${contacts.length >= 50 ? '+' : ''} ${contacts.length === 1 ? 'person' : 'people'}${query !== '' || activeTag !== '' ? ' match' : ''}.`
            : undefined
        }
        actions={
          <>
            <a href="/contacts/export?format=csv" className="btn btn-sm" title="Admins only">Export CSV</a>
            <a href="/contacts/export?format=vcf" className="btn btn-sm" title="Admins only">Export vCard</a>
            <Link href="/import" className="btn btn-primary">Import contacts</Link>
          </>
        }
      />

      <div className="card mb-4 p-3">
        <form className="flex flex-wrap gap-2">
          {activeTag !== '' && <input type="hidden" name="tag" value={activeTag} />}
          <input
            name="q" defaultValue={query} aria-label="Search contacts"
            placeholder="Search by name, phone or email…" className="field min-w-56 flex-1"
          />
          <button type="submit" className="btn">Search</button>
          {(query !== '' || activeTag !== '') && <Link href="/contacts" className="btn btn-ghost">Clear</Link>}
        </form>
        <TagFilterBar tags={tags} activeTag={activeTag} query={query} />
        {activeTagName !== undefined && (
          <p className="mt-2 text-sm text-muted">Showing people tagged <strong className="text-ink">{activeTagName}</strong>.</p>
        )}
      </div>

      {failure === null && activeTag !== '' && activeTagName !== undefined && contacts.length > 0 && (
        <CampaignSuggestion
          tagId={activeTag} tagName={activeTagName}
          count={tags.find((t) => t.id === activeTag)?.contactCount ?? contacts.length}
          existing={tagCampaigns}
        />
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <details className="card px-4 py-2.5" open={bulkOpen}>
          <summary className="cursor-pointer text-sm font-medium">Tag many at once</summary>
          <div className="mt-3">
            <BulkTagBar
              tags={tags} q={query} activeTag={activeTag}
              preview={sp.bulkTag !== undefined && sp.bulkCount !== undefined ? {
                tagId: sp.bulkTag, action: sp.bulkAction === 'remove' ? 'remove' : 'add',
                scope: sp.bulkScope === 'all' ? 'all' : 'matching', count: Number(sp.bulkCount)
              } : null}
              done={sp.bulkDone !== undefined ? { count: Number(sp.bulkDone), action: sp.bulkAction === 'remove' ? 'removed' : 'added' } : null}
              error={sp.bulkError ?? null}
            />
          </div>
        </details>
        <details className="card px-4 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">New tag</summary>
          <div className="mt-3"><NewTagForm /></div>
        </details>
        <FieldsAdmin fields={fields} />
      </div>

      {failure !== null && <p className="notice notice-danger">{failure}</p>}

      {failure === null && contacts.length === 0 && (
        <EmptyState
          title={query === '' && activeTag === '' ? 'No contacts yet' : 'No one matches'}
          body={query === '' && activeTag === ''
            ? 'Import a spreadsheet to bring people in, or add them over the API.'
            : 'Try a different search or clear the tag filter.'}
          action={query === '' && activeTag === ''
            ? <Link href="/import" className="btn btn-primary btn-sm">Import contacts</Link> : undefined}
        />
      )}

      {contacts.length > 0 && (
        <CampaignFromSelection senders={senders} error={campaignError} tags={tags} />
      )}

      {contacts.length > 0 && (
        <ul className="card list overflow-hidden">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} allTags={tags} fields={fields} />)}
        </ul>
      )}

      {contacts.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          Showing {contacts.length} contact{contacts.length === 1 ? '' : 's'}
          {contacts.length >= 50 ? ' (the first page)' : ''}. Tick people to build a campaign or tag them.
        </p>
      )}
      <datalist id="all-tags">
        {tags.map((t) => <option key={t.id} value={t.name} />)}
      </datalist>
    </main>
  );
}

/** Plain-language text for a bulk-tag error code. */
const BULK_ERROR: Record<string, string> = {
  pick_tag: 'Choose a tag first.',
  pick_people: 'Tick at least one contact, and choose a tag.',
  COUNT_CHANGED: 'The audience changed while you were looking. Preview again.',
  FORBIDDEN: 'Only an admin can tag everyone at once.',
  NOT_FOUND: 'That tag no longer exists.',
  no_tag: 'You chose “No tag”, so nothing was tagged. If you do not tag these people now, you will have to find and select them all again later.'
};

/**
 * Tag many people at once: everyone matching the current search/filter, or everyone (admin). It
 * previews the real count first and only then asks for confirmation. Ticked people are tagged from
 * the list below, with the same tag picker.
 */
function BulkTagBar(
  { tags, q, activeTag, preview, done, error }: {
    tags: Tag[]; q: string; activeTag: string;
    preview: { tagId: string; action: 'add' | 'remove'; scope: 'matching' | 'all'; count: number } | null;
    done: { count: number; action: string } | null;
    error: string | null;
  }
) {
  if (tags.length === 0) return null;
  const tagName = (id: string): string => tags.find((t) => t.id === id)?.name ?? 'this tag';
  return (
    <section aria-label="Tag many people at once" className="text-sm">
      {error !== null && <p role="alert" className="mt-1 text-danger">{BULK_ERROR[error] ?? 'Could not do that. Try again.'}</p>}
      {done !== null && (
        <p role="status" className="mt-1 text-success">
          Done — {done.count} {done.count === 1 ? 'person' : 'people'} {done.action}.
        </p>
      )}
      {preview !== null ? (
        <form action={bulkTagConfirmAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="tag" value={activeTag} />
          <input type="hidden" name="bulkTag" value={preview.tagId} />
          <input type="hidden" name="bulkAction" value={preview.action} />
          <input type="hidden" name="bulkScope" value={preview.scope} />
          <input type="hidden" name="bulkCount" value={String(preview.count)} />
          <span>
            {preview.action === 'add' ? 'Add' : 'Remove'} tag <strong>{tagName(preview.tagId)}</strong>{' '}
            {preview.action === 'add' ? 'to' : 'from'} <strong>{preview.count}</strong>{' '}
            {preview.count === 1 ? 'person' : 'people'}
            {preview.scope === 'all' ? ' (everyone)' : q !== '' || activeTag !== '' ? ' (matching the current filter)' : ' (everyone listed)'}?
          </span>
          <button type="submit" className="btn btn-sm btn-primary">
            Confirm
          </button>
          <a href="/contacts" className="text-xs text-muted underline">Cancel</a>
        </form>
      ) : (
        <form action={bulkTagPreviewAction} className="mt-2 flex flex-col items-stretch gap-2">
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="tag" value={activeTag} />
          <select name="bulkAction" aria-label="Add or remove" className="field field-sm w-full min-w-0">
            <option value="add">Add tag</option>
            <option value="remove">Remove tag</option>
          </select>
          <select name="bulkTag" aria-label="Tag to apply" defaultValue="" className="field field-sm w-full min-w-0">
            <option value="" disabled>choose a tag…</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">No tag</option>
          </select>
          <select name="bulkScope" aria-label="Who" className="field field-sm w-full min-w-0">
            <option value="matching">everyone matching the current search / tag filter</option>
            <option value="all">everyone in the book (admin)</option>
          </select>
          <button type="submit" className="btn btn-sm self-start">
            Preview
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * Offered when a tag filter is on: the natural next step is to message those people. Suggests, never forces.
 * If a campaign is already aimed at this tag it is named first, so the person can reuse it or still start a new one.
 */
function CampaignSuggestion(
  { tagId, tagName, count, existing }: { tagId: string; tagName: string; count: number; existing: Campaign[] }
) {
  return (
    <section aria-label="Next step" className="notice mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span>
        Ready to message the {count} {count === 1 ? 'person' : 'people'} tagged <strong>{tagName}</strong>?
        {existing.length > 0 && (
          <>
            {' '}A campaign already uses this tag:{' '}
            {existing.slice(0, 3).map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Link href={`/broadcast/${c.id}`} className="font-medium underline underline-offset-2">{c.name}</Link>
                {' '}({c.status})
              </span>
            ))}
            . Open it, or start a new one.
          </>
        )}
      </span>
      <Link href={`/broadcast/new?tag=${encodeURIComponent(tagId)}`} className="btn btn-sm btn-primary">
        Start a new campaign
      </Link>
    </section>
  );
}

/** The row of tags you can filter by. "All" clears the filter; the active tag is highlighted. */
function TagFilterBar({ tags, activeTag, query }: { tags: Tag[]; activeTag: string; query: string }) {
  if (tags.length === 0) return null;
  const href = (t: string): string => {
    const p = new URLSearchParams();
    if (query !== '') p.set('q', query);
    if (t !== '') p.set('tag', t);
    const qs = p.toString();
    return `/contacts${qs === '' ? '' : `?${qs}`}`;
  };
  const chip = (active: boolean): string =>
    `badge shrink-0 ${active ? 'badge-accent !border-accent/40 font-semibold' : 'text-muted hover:bg-accent-soft'}`;

  return (
    <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
      <span className="shrink-0 text-sm text-muted">Tag:</span>
      <TagChip href={href('')} active={activeTag === ''} className={chip(activeTag === '')}>All</TagChip>
      {tags.map((t) => (
        <TagChip key={t.id} href={href(t.id)} active={activeTag === t.id} className={chip(activeTag === t.id)}>
          {t.name}
          {t.contactCount !== undefined && <span className="ml-1 opacity-60">{t.contactCount}</span>}
        </TagChip>
      ))}
    </div>
  );
}

/** The little form to create a new tag. */
function NewTagForm() {
  return (
    <form action={createTagAction} className="mb-4 flex gap-2">
      <input
        name="name"
        placeholder="New tag name…"
        aria-label="New tag name"
        maxLength={60}
        className="w-48 field"
      />
      <button
        type="submit"
        className="btn"
      >
        Add tag
      </button>
    </form>
  );
}

/**
 * The hand-pick campaign panel: check contacts in the list, fill a name/message/number here, and
 * create a draft aimed at exactly those people. The row checkboxes belong to this form by their
 * `form="pick-campaign"` attribute, so they need not be nested inside it (the rows already carry
 * their own tag forms, and forms cannot nest). Tags are the better tool for a *reusable* audience;
 * this is for an ad-hoc "these specific people, right now".
 */
function CampaignFromSelection(
  { senders, error, tags }: { senders: Sender[]; error: string | undefined; tags: Tag[] }
) {
  const errMsg = error === 'missing'
    ? 'Check at least one contact, and fill in a name, a message and a number.'
    : error !== undefined ? 'Could not create the campaign. Try again.' : null;

  return (
    <details className="mb-4 rounded-xl border border-border bg-surface" open={error !== undefined}>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        Campaign from checked contacts
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted">
          Only ticked people, no tag yet? To reuse this group later, tag them first (“Tag ticked” below), then start a
          campaign from the tag.
        </p>
        {errMsg !== null && <p className="mb-2 text-sm text-danger">{errMsg}</p>}
        {senders.length === 0 ? (
          <p className="text-sm text-muted">Link a WhatsApp number first, on the Numbers tab.</p>
        ) : (
          <form
            id="pick-campaign" action={createCampaignFromSelectionAction}
            className="flex flex-col gap-3"
          >
            <input
              name="name" required maxLength={200} placeholder="Campaign name…"
              aria-label="Campaign name"
              className="field"
            />
            <textarea
              name="body" required maxLength={4096} rows={3} placeholder="Message to send…"
              aria-label="Campaign message"
              className="field"
            />
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
              <span className="text-muted">Or just tag the ticked people:</span>
              <select name="bulkAction" aria-label="Add or remove (ticked)" className="field field-sm">
                <option value="add">Add tag</option>
                <option value="remove">Remove tag</option>
              </select>
              <select name="bulkTag" aria-label="Tag for ticked people" defaultValue="" className="field field-sm">
                <option value="" disabled>choose a tag…</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="none">No tag</option>
              </select>
              <button type="submit" formAction={bulkTagCheckedAction} formNoValidate
                className="btn btn-sm">
                Tag ticked
              </button>
            </div>
            <span className="text-xs text-muted">
              <code>{'{{name}}'}</code> fills the contact&apos;s name; <code>{'{Hi|Hey}'}</code>{' '}
              varies the wording per recipient.
            </span>
            <select
              name="senderIdentityId" required defaultValue="" aria-label="Send from"
              className="field"
            >
              <option value="" disabled>Send from…</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label ?? 'number'}{s.phoneE164 !== null ? ` · ${s.phoneE164}` : ''}
                  {s.status !== 'active' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn btn-primary"
              >
                Create draft from checked
              </button>
              <span className="text-xs text-muted">
                Uses the contacts checked below; do-not-contact people can&apos;t be picked.
              </span>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

/** One row: the contact, their details, their tag chips (small rounded labels, each removable), and an add-tag picker. */
function ContactRow({ contact, allTags, fields }: { contact: Contact; allTags: Tag[]; fields: CustomField[] }) {
  const phone = contact.identities.find((i) => i.kind === 'phone')?.value;
  const email = contact.identities.find((i) => i.kind === 'email')?.value;
  const name = contact.displayName ?? phone ?? email ?? 'Unnamed contact';
  const attached = new Set(contact.tags.map((t) => t.id));
  // A do-not-contact person cannot be messaged, so they cannot be picked into a campaign.
  const pickable = !contact.doNotContact;

  return (
    <li className="px-4 py-3.5">
      <div className="grid items-start gap-x-4 gap-y-2 md:grid-cols-[minmax(0,18rem)_1fr_auto]">
        <div className="flex min-w-0 items-center gap-3">
          {/* Belongs to the campaign form by its `form` id, so no nested-form is needed. */}
          <input
            type="checkbox" name="contactId" value={contact.id} form="pick-campaign"
            disabled={!pickable} aria-label={`Select ${contact.displayName ?? 'contact'}`}
            className="size-4 shrink-0 accent-accent disabled:opacity-30"
          />
          <span className="avatar size-10 text-sm" aria-hidden>{initialsOf(name)}</span>
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-sm text-muted">
              {[phone, email].filter((v) => v !== undefined).join(' · ') || 'no contact details'}
            </p>
            {contact.source !== null && <p className="truncate text-xs text-muted">from {contact.source}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {contact.tags.slice(0, 5).map((t) => (
            <RemoveTag key={t.id} contactId={contact.id} tagId={t.id} tagName={t.name} action={detachTagAction} />
          ))}
          {contact.tags.length > 5 && (
            <details className="inline-flex flex-wrap items-center gap-1.5">
              <summary className="badge cursor-pointer text-muted">+{contact.tags.length - 5} more</summary>
              {contact.tags.slice(5).map((t) => (
            <RemoveTag key={t.id} contactId={contact.id} tagId={t.id} tagName={t.name} action={detachTagAction} />
              ))}
            </details>
          )}
          {/* One shared <datalist id="all-tags"> serves every row's input; per-row <select>s of
              every tag made the page grow as people x tags (5.7 MB at 50 people and 129 tags). */}
          {allTags.length > attached.size && (
            <form action={attachTagAction} className="inline-flex items-center gap-1">
              <input type="hidden" name="contactId" value={contact.id} />
              <input
                name="tagName" list="all-tags" aria-label="Add a tag" placeholder="+ tag…"
                autoComplete="off" className="field field-sm"
              />
              <button type="submit" className="btn btn-sm">Add</button>
            </form>
          )}
        </div>

        <div className="flex items-center gap-2 md:justify-end">
          {contact.doNotContact && <span className="badge badge-danger">do not contact</span>}
          <form action={setDncAction}>
            <input type="hidden" name="contactId" value={contact.id} />
            <input type="hidden" name="value" value={contact.doNotContact ? 'false' : 'true'} />
            <button
              type="submit"
              title={contact.doNotContact
                ? 'Allow messaging this person again'
                : 'Never message this person (an admin can still override)'}
              className="btn btn-sm"
            >
              {contact.doNotContact ? 'Allow contact' : 'Do not contact'}
            </button>
          </form>
        </div>
      </div>

      {fields.length > 0 && (
        <div className="mt-2 md:pl-[4.75rem]"><ContactFields contact={contact} fields={fields} /></div>
      )}
    </li>
  );
}

/** The org's custom fields on one contact: a one-line summary, and a form to edit them. */
function ContactFields({ contact, fields }: { contact: Contact; fields: CustomField[] }) {
  const values = contact.customFields ?? {};
  const set = fields.filter((f) => values[f.key] !== undefined);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">
        {set.length === 0 ? 'Fields' : set.map((f) => `${f.label}: ${String(values[f.key])}`).join(' · ')}
      </summary>
      <form action={saveContactFieldsAction} className="mt-2 grid grid-cols-2 gap-2">
        <input type="hidden" name="contactId" value={contact.id} />
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-muted">{f.label}</span>
            {f.type === 'select' ? (
              <select name={`f_${f.key}`} defaultValue={String(values[f.key] ?? '')}
                className="field field-sm">
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input name={`f_${f.key}`} defaultValue={String(values[f.key] ?? '')}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any"
                className="field field-sm" />
            )}
          </label>
        ))}
        <button type="submit" className="col-span-2 justify-self-start btn btn-sm">
          Save fields
        </button>
      </form>
    </details>
  );
}

/**
 * Defining the org's fields. Everyone sees what exists (and the `{{key}}` to use it in a campaign);
 * only an admin's create/remove goes through, since it changes every contact.
 */
function FieldsAdmin({ fields }: { fields: CustomField[] }) {
  return (
    <details className="card px-4 py-2.5 text-sm">
      <summary className="cursor-pointer font-medium">
        Custom fields ({fields.length})
      </summary>
      <p className="mt-2 text-muted">
        Extra details on each contact, usable as {'{{field}}'} in a campaign message.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {fields.map((f) => (
          <li key={f.key} className="flex items-center gap-2">
            <span className="font-medium">{f.label}</span>
            <code className="text-muted">{`{{${f.key}}}`}</code>
            <span className="text-muted">{f.type}{f.type === 'select' && `: ${f.options.join(', ')}`}</span>
            <form action={deleteFieldAction} className="ml-auto">
              <input type="hidden" name="key" value={f.key} />
              <button type="submit" className="text-muted hover:text-danger" title="Remove this field and its values (admin)">remove</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createFieldAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="label" required placeholder="Field name, e.g. City" aria-label="Field name"
          className="field field-sm" />
        <select name="type" aria-label="Field type" className="field field-sm">
          <option value="text">text</option><option value="number">number</option>
          <option value="date">date</option><option value="select">select</option>
        </select>
        <input name="options" placeholder="options, comma separated (select only)" aria-label="Options"
          className="min-w-48 flex-1 rounded-md border border-border bg-surface px-2 py-1" />
        <button type="submit" className="btn btn-sm">
          Add field (admin)
        </button>
      </form>
    </details>
  );
}
