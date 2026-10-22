import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listContacts, listTags, listSenders, listCustomFields, listCampaigns, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Contact, Tag, Sender, CustomField, Campaign } from '@/lib/crm';
import {
  saveContactFieldsAction, setDncAction,
  bulkTagPreviewAction, bulkTagConfirmAction, bulkTagCheckedAction,
  createTagAction, attachTagAction, detachTagAction, createCampaignFromSelectionAction
} from './actions';
import { PageHeader, EmptyState, initialsOf } from '../ui';
import { TagChip } from './tag-chip';
import { RemoveTag } from './remove-tag';
import { FieldsPanel } from './fields-panel';
import { TagManager } from './tag-manager';

/** What the person is looking at: search, tag, date range and order. Every link and form on the page carries it. */
interface View {
  q: string; tag: string; from: string; to: string;
  dateBy: 'added' | 'imported';
  sort: 'added_desc' | 'added_asc' | 'name_asc' | 'imported_desc';
}

const SORTS: ReadonlyArray<{ value: View['sort']; label: string }> = [
  { value: 'added_desc', label: 'Newest added first' },
  { value: 'added_asc', label: 'Oldest added first' },
  { value: 'imported_desc', label: 'Most recently imported first' },
  { value: 'name_asc', label: 'Name A to Z' }
];

/** The `/contacts` address for a view, changing only what `over` names; empty parts are left out. */
function viewHref(v: View, over: Partial<View> = {}): string {
  const n = { ...v, ...over };
  const p = new URLSearchParams();
  if (n.q !== '') p.set('q', n.q);
  if (n.tag !== '') p.set('tag', n.tag);
  if (n.from !== '') p.set('from', n.from);
  if (n.to !== '') p.set('to', n.to);
  if ((n.from !== '' || n.to !== '') && n.dateBy === 'imported') p.set('dateBy', 'imported');
  if (n.sort !== 'added_desc') p.set('sort', n.sort);
  const qs = p.toString();
  return `/contacts${qs === '' ? '' : `?${qs}`}`;
}

/** A day like "21 Oct 2026", or a dash when there is none. */
function day(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

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
      q?: string; tag?: string; from?: string; to?: string; dateBy?: string; sort?: string; campaignError?: string;
      bulkTag?: string; bulkAction?: string; bulkScope?: string; bulkCount?: string;
      bulkDone?: string; bulkError?: string;
    }>;
  }
) {
  const sp = await searchParams;
  const { q, tag, campaignError } = sp;
  const query = typeof q === 'string' ? q : '';
  const activeTag = typeof tag === 'string' ? tag : '';
  const view: View = {
    q: query, tag: activeTag,
    from: isDay(sp.from) ? sp.from : '', to: isDay(sp.to) ? sp.to : '',
    dateBy: sp.dateBy === 'imported' ? 'imported' : 'added',
    sort: SORTS.find((o) => o.value === sp.sort)?.value ?? 'added_desc'
  };
  const hasDates = view.from !== '' || view.to !== '';
  const filtered = query !== '' || activeTag !== '' || hasDates;

  let contacts: Contact[] = [];
  let tags: Tag[] = [];
  let senders: Sender[] = [];
  let fields: CustomField[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [contacts, tags, senders, fields] = await Promise.all([
      listContacts({ ...view }),
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
            ? `${String(contacts.length)}${contacts.length >= 50 ? '+' : ''} ${contacts.length === 1 ? 'person' : 'people'}${filtered ? ' match' : ''}.`
            : undefined
        }
        actions={
          <>
            <a href={viewHref(view)} className="btn btn-sm" title="Load the list again">Refresh</a>
            <a href="/contacts/export?format=csv" className="btn btn-sm" title="Admins only">Export CSV</a>
            <a href="/contacts/export?format=vcf" className="btn btn-sm" title="Admins only">Export vCard</a>
            <Link href="/import" className="btn btn-primary">Import contacts</Link>
          </>
        }
      />

      <div className="card mb-4 p-3">
        <form className="flex flex-wrap items-end gap-2">
          {activeTag !== '' && <input type="hidden" name="tag" value={activeTag} />}
          <input
            name="q" defaultValue={query} aria-label="Search contacts"
            placeholder="Search by name, phone or email…" className="field min-w-56 flex-1"
          />
          <button type="submit" className="btn">Search</button>
          <details className="w-full text-sm" open={hasDates || view.sort !== 'added_desc'}>
            <summary className="cursor-pointer text-muted hover:text-ink">Dates and order</summary>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-0.5 text-xs text-muted">Date
                <select name="dateBy" defaultValue={view.dateBy} aria-label="Which date" className="field field-sm">
                  <option value="added">Added</option>
                  <option value="imported">Last imported</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">From
                <input type="date" name="from" defaultValue={view.from} aria-label="From date" className="field field-sm" />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">To
                <input type="date" name="to" defaultValue={view.to} aria-label="To date" className="field field-sm" />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">Order
                <select name="sort" defaultValue={view.sort} aria-label="Order" className="field field-sm">
                  {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <button type="submit" className="btn btn-sm">Apply</button>
            </div>
          </details>
          {(filtered || view.sort !== 'added_desc') && <Link href="/contacts" className="btn btn-ghost">Clear</Link>}
        </form>
        <TagFilterBar tags={tags} view={view} />
        {activeTagName !== undefined && (
          <p className="mt-2 text-sm text-muted">Showing people tagged <strong className="text-ink">{activeTagName}</strong>.</p>
        )}
        {hasDates && (
          <p className="mt-2 text-sm text-muted">
            Showing people {view.dateBy === 'imported' ? 'last imported' : 'added'}
            {view.from !== '' && <> from <strong className="text-ink">{day(view.from)}</strong></>}
            {view.to !== '' && <> to <strong className="text-ink">{day(view.to)}</strong></>}.
          </p>
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
              tags={tags} view={view}
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
        <FieldsPanel fields={fields} />
        <TagManager tags={tags} />
      </div>

      {failure !== null && <p className="notice notice-danger">{failure}</p>}

      {failure === null && contacts.length === 0 && (
        <EmptyState
          title={!filtered ? 'No contacts yet' : 'No one matches'}
          body={!filtered
            ? 'Import a spreadsheet to bring people in, or add them over the API.'
            : 'Try a different search or clear the filters.'}
          action={!filtered
            ? <Link href="/import" className="btn btn-primary btn-sm">Import contacts</Link> : undefined}
        />
      )}

      {contacts.length > 0 && (
        <CampaignFromSelection senders={senders} error={campaignError} tags={tags} />
      )}

      {contacts.length > 0 && (
        <ul className="card list overflow-hidden">
          <li className="hidden gap-x-4 px-4 py-2 text-xs font-medium text-muted md:grid md:grid-cols-[1.25rem_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_6.5rem_1rem]" aria-hidden>
            <span /><span>Name</span><span>Phone / email</span><span>Tags</span><span>Added</span><span />
          </li>
          {contacts.map((c) => <ContactRow key={c.id} contact={c} allTags={tags} fields={fields} />)}
        </ul>
      )}

      {contacts.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          Showing {contacts.length} contact{contacts.length === 1 ? '' : 's'}
          {contacts.length >= 50 ? ' (the first page)' : ''}. Open a row for its details. Tick people to build a campaign or tag them.
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
  { tags, view, preview, done, error }: {
    tags: Tag[]; view: View;
    preview: { tagId: string; action: 'add' | 'remove'; scope: 'matching' | 'all'; count: number } | null;
    done: { count: number; action: string } | null;
    error: string | null;
  }
) {
  if (tags.length === 0) return null;
  const { q, tag: activeTag } = view;
  const narrowed = q !== '' || activeTag !== '' || view.from !== '' || view.to !== '';
  const carry = (
    <>
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="tag" value={activeTag} />
      <input type="hidden" name="from" value={view.from} />
      <input type="hidden" name="to" value={view.to} />
      <input type="hidden" name="dateBy" value={view.dateBy} />
    </>
  );
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
 {carry}
          <input type="hidden" name="bulkTag" value={preview.tagId} />
          <input type="hidden" name="bulkAction" value={preview.action} />
          <input type="hidden" name="bulkScope" value={preview.scope} />
          <input type="hidden" name="bulkCount" value={String(preview.count)} />
          <span>
            {preview.action === 'add' ? 'Add' : 'Remove'} tag <strong>{tagName(preview.tagId)}</strong>{' '}
            {preview.action === 'add' ? 'to' : 'from'} <strong>{preview.count}</strong>{' '}
            {preview.count === 1 ? 'person' : 'people'}
            {preview.scope === 'all' ? ' (everyone)' : narrowed ? ' (matching the current filter)' : ' (everyone listed)'}?
          </span>
          <button type="submit" className="btn btn-sm btn-primary">
            Confirm
          </button>
          <a href="/contacts" className="text-xs text-muted underline">Cancel</a>
        </form>
      ) : (
        <form action={bulkTagPreviewAction} className="mt-2 flex flex-col items-stretch gap-2">
          {carry}
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
function TagFilterBar({ tags, view }: { tags: Tag[]; view: View }) {
  if (tags.length === 0) return null;
  const activeTag = view.tag;
  const href = (t: string): string => viewHref(view, { tag: t });
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

/**
 * One row, as a line of columns that opens to show the rest. The line holds what is looked at most: who, how to
 * reach them, their tags (small rounded labels, each removable) and when they were added. Opening it shows the
 * less-used controls: adding a tag, do-not-contact, when they were last imported and the custom fields.
 */
function ContactRow({ contact, allTags, fields }: { contact: Contact; allTags: Tag[]; fields: CustomField[] }) {
  const phone = contact.identities.find((i) => i.kind === 'phone')?.value;
  const email = contact.identities.find((i) => i.kind === 'email')?.value;
  const name = contact.displayName ?? phone ?? email ?? 'Unnamed contact';
  const attached = new Set(contact.tags.map((t) => t.id));
  // A do-not-contact person cannot be messaged, so they cannot be picked into a campaign.
  const pickable = !contact.doNotContact;

  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent-soft md:grid-cols-[1.25rem_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_6.5rem_1rem]">
          {/* Belongs to the campaign form by its `form` id, so no nested-form is needed. */}
          <input
            type="checkbox" name="contactId" value={contact.id} form="pick-campaign"
            disabled={!pickable} aria-label={`Select ${contact.displayName ?? 'contact'}`}
            className="size-4 shrink-0 accent-accent disabled:opacity-30"
          />
          <div className="flex min-w-0 items-center gap-3">
            <span className="avatar size-9 text-sm" aria-hidden>{initialsOf(name)}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              {contact.doNotContact && <span className="badge badge-danger">do not contact</span>}
            </div>
          </div>
          <p className="truncate text-sm text-muted">
            {[phone, email].filter((v) => v !== undefined).join(' · ') || 'no contact details'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {contact.tags.slice(0, 3).map((t) => (
              <RemoveTag key={t.id} contactId={contact.id} tagId={t.id} tagName={t.name} action={detachTagAction} />
            ))}
            {contact.tags.length > 3 && <span className="badge text-muted">+{contact.tags.length - 3} more</span>}
          </div>
          <p className="text-sm text-muted">{day(contact.createdAt)}</p>
          <span aria-hidden className="hidden text-muted transition-transform group-open:rotate-90 md:inline">›</span>
        </summary>

        <div className="grid gap-4 border-t border-border px-4 py-3 md:pl-[3.75rem]">
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div><dt className="inline text-muted">Added </dt><dd className="inline">{day(contact.createdAt)}</dd></div>
            <div><dt className="inline text-muted">Last imported </dt><dd className="inline">{day(contact.lastImportedAt)}</dd></div>
            {contact.source !== null && <div><dt className="inline text-muted">From </dt><dd className="inline">{contact.source}</dd></div>}
          </dl>

          {contact.tags.length > 3 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">All tags:</span>
              {contact.tags.slice(3).map((t) => (
                <RemoveTag key={t.id} contactId={contact.id} tagId={t.id} tagName={t.name} action={detachTagAction} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
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

          {fields.length > 0 && <ContactFields contact={contact} fields={fields} />}
        </div>
      </details>
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
