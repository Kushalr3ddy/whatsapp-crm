import { redirect } from 'next/navigation';
import { listContacts, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { Contact } from '@/lib/crm';

/** Rendered per request — the search term comes from the query string and the list is live data. */
export const dynamic = 'force-dynamic';

/**
 * The contacts screen: search the org's contacts by name, phone or email, and see who they are.
 *
 * The search box is a plain GET form that reloads the page with `?q=…`, so it works with no
 * client-side JavaScript — the server does the search and renders the results. This is the piece
 * that lets an operator find specific people out of an imported book (to hand-pick a campaign
 * audience later).
 */
export default async function ContactsPage(
  { searchParams }: { searchParams: Promise<{ q?: string }> }
) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';

  let contacts: Contact[] = [];
  let failure: string | null = null;
  let expired = false;
  try {
    contacts = await listContacts(query);
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
        <p className="mt-1 text-sm text-muted">Search your contacts by name, phone or email.</p>
      </header>

      <form className="mb-5 flex gap-2">
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

      {failure !== null && <p className="text-sm text-danger">{failure}</p>}

      {failure === null && contacts.length === 0 && (
        <p className="text-sm text-muted">
          {query === ''
            ? 'No contacts yet — import a spreadsheet from the Import tab, or add one over the API.'
            : `No contacts match “${query}”.`}
        </p>
      )}

      {contacts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} />)}
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

/** One row: the contact's name, their phone/email, where they came from, and a do-not-contact flag. */
function ContactRow({ contact }: { contact: Contact }) {
  const phone = contact.identities.find((i) => i.kind === 'phone')?.value;
  const email = contact.identities.find((i) => i.kind === 'email')?.value;
  const detail = [phone, email].filter((v) => v !== undefined).join(' · ');

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
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
    </li>
  );
}
