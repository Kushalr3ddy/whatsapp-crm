import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listContacts, listTags, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Contact, Tag } from '@/lib/crm';
import { createTagAction, attachTagAction, detachTagAction } from './actions';

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
  { searchParams }: { searchParams: Promise<{ q?: string; tag?: string }> }
) {
  const { q, tag } = await searchParams;
  const query = typeof q === 'string' ? q : '';
  const activeTag = typeof tag === 'string' ? tag : '';

  let contacts: Contact[] = [];
  let tags: Tag[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    [contacts, tags] = await Promise.all([
      listContacts({ q: query, tag: activeTag }),
      listTags()
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

      {failure !== null && <p className="text-sm text-danger">{failure}</p>}

      {failure === null && contacts.length === 0 && (
        <p className="text-sm text-muted">
          {query === '' && activeTag === ''
            ? 'No contacts yet — import a spreadsheet from the Import tab, or add one over the API.'
            : 'No contacts match this filter.'}
        </p>
      )}

      {contacts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} allTags={tags} />)}
        </ul>
      )}

      {contacts.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Showing {contacts.length} contact{contacts.length === 1 ? '' : 's'}
          {contacts.length >= 50 ? ' (first page)' : ''}.
        </p>
      )}
    </main>
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

/** One row: the contact, their details, their tag chips (each removable), and an add-tag picker. */
function ContactRow({ contact, allTags }: { contact: Contact; allTags: Tag[] }) {
  const phone = contact.identities.find((i) => i.kind === 'phone')?.value;
  const email = contact.identities.find((i) => i.kind === 'email')?.value;
  const detail = [phone, email].filter((v) => v !== undefined).join(' · ');
  const attached = new Set(contact.tags.map((t) => t.id));
  const available = allTags.filter((t) => !attached.has(t.id));

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {contact.displayName ?? phone ?? email ?? 'Unnamed contact'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {detail === '' ? 'no contact details' : detail}
            {contact.source !== null && <> · from {contact.source}</>}
          </p>
        </div>
        {contact.doNotContact && (
          <span className="shrink-0 rounded-md border border-danger/50 px-2 py-0.5 text-[11px] text-danger">
            do not contact
          </span>
        )}
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
    </li>
  );
}
