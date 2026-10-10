import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listContacts, listTags, listSenders, listCustomFields, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Contact, Tag, Sender, CustomField } from '@/lib/crm';
import {
  createFieldAction, deleteFieldAction, saveContactFieldsAction, setDncAction,
  bulkTagPreviewAction, bulkTagConfirmAction, bulkTagCheckedAction,
  createTagAction, attachTagAction, detachTagAction, createCampaignFromSelectionAction
} from './actions';

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

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-muted">Search by name, phone or email; label people with tags.</p>
        <p className="mt-1 text-xs text-muted">
          Export (admins):{' '}
          <a href="/contacts/export?format=csv" className="text-accent underline">CSV for a spreadsheet</a>
          {' · '}
          <a href="/contacts/export?format=vcf" className="text-accent underline">vCard for a phone</a>
        </p>
      </header>

      <form className="mb-3 flex gap-2">
        {activeTag !== '' && <input type="hidden" name="tag" value={activeTag} />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search name, phone or email…"
          aria-label="Search contacts"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft"
        >
          Search
        </button>
      </form>

      <TagFilterBar tags={tags} activeTag={activeTag} query={query} />

      <NewTagForm />

      <FieldsAdmin fields={fields} />

      <BulkTagBar
        tags={tags} q={query} activeTag={activeTag}
        preview={sp.bulkTag !== undefined && sp.bulkCount !== undefined ? {
          tagId: sp.bulkTag, action: sp.bulkAction === 'remove' ? 'remove' : 'add',
          scope: sp.bulkScope === 'all' ? 'all' : 'matching', count: Number(sp.bulkCount)
        } : null}
        done={sp.bulkDone !== undefined ? { count: Number(sp.bulkDone), action: sp.bulkAction === 'remove' ? 'removed' : 'added' } : null}
        error={sp.bulkError ?? null}
      />

      {failure !== null && <p className="text-sm text-danger">{failure}</p>}

      {failure === null && contacts.length === 0 && (
        <p className="text-sm text-muted">
          {query === '' && activeTag === ''
            ? 'No contacts yet — import a spreadsheet from the Import tab, or add one over the API.'
            : 'No contacts match this filter.'}
        </p>
      )}

      {contacts.length > 0 && (
        <CampaignFromSelection senders={senders} error={campaignError} tags={tags} />
      )}

      {contacts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} allTags={tags} fields={fields} />)}
        </ul>
      )}

      {contacts.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Showing {contacts.length} contact{contacts.length === 1 ? '' : 's'}
          {contacts.length >= 50 ? ' (first page)' : ''}. Check people above to hand-pick a
          campaign audience.
        </p>
      )}
    </main>
  );
}

/** Plain-language text for a bulk-tag error code. */
const BULK_ERROR: Record<string, string> = {
  pick_tag: 'Choose a tag first.',
  pick_people: 'Tick at least one contact, and choose a tag.',
  COUNT_CHANGED: 'The audience changed while you were looking. Preview again.',
  FORBIDDEN: 'Only an admin can tag everyone at once.',
  NOT_FOUND: 'That tag no longer exists.'
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
    <section aria-label="Tag many people at once" className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      <p className="font-medium">Tag many at once</p>
      {error !== null && <p role="alert" className="mt-1 text-danger">{BULK_ERROR[error] ?? 'Could not do that. Try again.'}</p>}
      {done !== null && (
        <p role="status" className="mt-1 text-accent">
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
          <button type="submit" className="rounded-md border border-accent/50 bg-accent-soft px-2.5 py-1 text-xs">
            Confirm
          </button>
          <a href="/contacts" className="text-xs text-muted underline">Cancel</a>
        </form>
      ) : (
        <form action={bulkTagPreviewAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="tag" value={activeTag} />
          <select name="bulkAction" aria-label="Add or remove" className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="add">Add tag</option>
            <option value="remove">Remove tag</option>
          </select>
          <select name="bulkTag" aria-label="Tag to apply" defaultValue="" className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="" disabled>choose a tag…</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select name="bulkScope" aria-label="Who" className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="matching">everyone matching the current search / tag filter</option>
            <option value="all">everyone in the book (admin)</option>
          </select>
          <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-accent-soft">
            Preview
          </button>
        </form>
      )}
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
    `rounded-md border px-2 py-0.5 text-xs ${
      active ? 'border-accent/50 bg-accent-soft text-ink' : 'border-border text-muted hover:bg-accent-soft'
    }`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Filter:</span>
      <Link href={href('')} className={chip(activeTag === '')}>All</Link>
      {tags.map((t) => (
        <Link key={t.id} href={href(t.id)} className={chip(activeTag === t.id)}>
          {t.name}
          {t.contactCount !== undefined && <span className="ml-1 opacity-60">{t.contactCount}</span>}
        </Link>
      ))}
    </div>
  );
}

/** The little form to create a new tag. */
function NewTagForm() {
  return (
    <form action={createTagAction} className="mb-5 flex gap-2">
      <input
        name="name"
        placeholder="New tag name…"
        aria-label="New tag name"
        maxLength={60}
        className="w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft"
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
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <textarea
              name="body" required maxLength={4096} rows={3} placeholder="Message to send…"
              aria-label="Campaign message"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
              <span className="text-muted">Or just tag the ticked people:</span>
              <select name="bulkAction" aria-label="Add or remove (ticked)" className="rounded-md border border-border bg-surface px-1.5 py-0.5">
                <option value="add">Add tag</option>
                <option value="remove">Remove tag</option>
              </select>
              <select name="bulkTag" aria-label="Tag for ticked people" defaultValue="" className="rounded-md border border-border bg-surface px-1.5 py-0.5">
                <option value="" disabled>choose a tag…</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="submit" formAction={bulkTagCheckedAction} formNoValidate
                className="rounded-md border border-border px-2 py-0.5 text-muted hover:bg-accent-soft">
                Tag ticked
              </button>
            </div>
            <span className="text-xs text-muted">
              <code>{'{{name}}'}</code> fills the contact&apos;s name; <code>{'{Hi|Hey}'}</code>{' '}
              varies the wording per recipient.
            </span>
            <select
              name="senderIdentityId" required defaultValue="" aria-label="Send from"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
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
                className="rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-sm text-ink hover:bg-accent-soft/70"
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

/** One row: the contact, their details, their tag chips (each removable), and an add-tag picker. */
function ContactRow({ contact, allTags, fields }: { contact: Contact; allTags: Tag[]; fields: CustomField[] }) {
  const phone = contact.identities.find((i) => i.kind === 'phone')?.value;
  const email = contact.identities.find((i) => i.kind === 'email')?.value;
  const detail = [phone, email].filter((v) => v !== undefined).join(' · ');
  const attached = new Set(contact.tags.map((t) => t.id));
  const available = allTags.filter((t) => !attached.has(t.id));
  // A do-not-contact person cannot be messaged, so they cannot be picked into a campaign.
  const pickable = !contact.doNotContact;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Belongs to the campaign form by its `form` id, so no nested-form is needed. */}
          <input
            type="checkbox" name="contactId" value={contact.id} form="pick-campaign"
            disabled={!pickable} aria-label={`Select ${contact.displayName ?? 'contact'}`}
            className="size-4 shrink-0 accent-accent disabled:opacity-30"
          />
          <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {contact.displayName ?? phone ?? email ?? 'Unnamed contact'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {detail === '' ? 'no contact details' : detail}
            {contact.source !== null && <> · from {contact.source}</>}
          </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {contact.doNotContact && (
            <span className="rounded-md border border-danger/50 px-2 py-0.5 text-[11px] text-danger">
              do not contact
            </span>
          )}
          <form action={setDncAction}>
            <input type="hidden" name="contactId" value={contact.id} />
            <input type="hidden" name="value" value={contact.doNotContact ? 'false' : 'true'} />
            <button type="submit" title={contact.doNotContact
              ? 'Allow messaging this person again' : 'Never message this person (an admin can still override)'}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-accent-soft">
              {contact.doNotContact ? 'Allow contact' : 'Do not contact'}
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {contact.tags.map((t) => (
          <form key={t.id} action={detachTagAction} className="inline-flex">
            <input type="hidden" name="contactId" value={contact.id} />
            <input type="hidden" name="tagId" value={t.id} />
            <button
              type="submit"
              title="Remove tag"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-ink hover:border-danger/50 hover:text-danger"
            >
              {t.name} <span aria-hidden className="opacity-60">×</span>
            </button>
          </form>
        ))}

        {available.length > 0 && (
          <form action={attachTagAction} className="inline-flex items-center gap-1">
            <input type="hidden" name="contactId" value={contact.id} />
            <select
              name="tagId"
              aria-label="Add a tag"
              defaultValue=""
              className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-muted"
            >
              <option value="" disabled>+ tag…</option>
              {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:bg-accent-soft"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {fields.length > 0 && <ContactFields contact={contact} fields={fields} />}
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
                className="rounded-md border border-border bg-surface px-1.5 py-1">
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input name={`f_${f.key}`} defaultValue={String(values[f.key] ?? '')}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any"
                className="rounded-md border border-border bg-surface px-1.5 py-1" />
            )}
          </label>
        ))}
        <button type="submit" className="col-span-2 justify-self-start rounded-md border border-border px-2.5 py-1 text-muted hover:bg-accent-soft">
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
    <details className="mb-4 text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">
        Custom fields ({fields.length}) — extra details on each contact, usable as {'{{field}}'} in a campaign
      </summary>
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
          className="rounded-md border border-border bg-surface px-2 py-1" />
        <select name="type" aria-label="Field type" className="rounded-md border border-border bg-surface px-1.5 py-1">
          <option value="text">text</option><option value="number">number</option>
          <option value="date">date</option><option value="select">select</option>
        </select>
        <input name="options" placeholder="options, comma separated (select only)" aria-label="Options"
          className="min-w-48 flex-1 rounded-md border border-border bg-surface px-2 py-1" />
        <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-muted hover:bg-accent-soft">
          Add field (admin)
        </button>
      </form>
    </details>
  );
}
