import { redirect } from 'next/navigation';
import { getMe, getContactSources, listPeople, NotAuthenticatedError } from '@/lib/crm';
import type { ContactSources, Me, PersonRow } from '@/lib/crm';
import { campaignZone } from '@/lib/campaign-time';
import { emptyView, viewFromSearch, viewToRequest } from '@/lib/contacts-screen';
import { ContactsScreen } from '../contacts-screen';

/** Rendered per request: the people, their counts and the files reflect live data. */
export const dynamic = 'force-dynamic';

/**
 * Contacts: everyone you can message, with the imported files, your tags and saved lists to look at them by. The address holds
 * what is picked (a file, a tag or list, the search, the filters, the page), so a refresh or a shared link comes back to it. This
 * page only reads the first screenful; after that the screen asks the server for each change.
 */
export default async function ContactsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const sp = await searchParams;
  let sources: ContactSources | null = null;
  let people: { rows: PersonRow[]; total: number } | null = null;
  let me: Me | null = null;
  let expired = false;
  try {
    [sources, me] = await Promise.all([getContactSources(), getMe().catch((): null => null)]);
  } catch (error) {
    // Anything but a lapsed session (the API refusing, or not answering at all) shows the screen's own "Couldn't load" state.
    if (error instanceof NotAuthenticatedError) expired = true;
  }
  if (expired) redirect('/login?next=/contacts');

  // A saved list is its filter, so opening one reads its definition from the sources.
  const view = sources === null ? emptyView() : viewFromSearch(sp, sources);
  if (sources !== null) {
    try {
      people = await listPeople(viewToRequest(view));
    } catch (error) {
      if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
    }
  }

  return (
    <main className="page page-full">
      <ContactsScreen sources={sources} view={view} people={people} timeZone={campaignZone()} isAdmin={me?.role === 'admin'} />
    </main>
  );
}
