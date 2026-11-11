'use server';

import {
  listPeople, getContactSources, getPersonDetail, bulkTagContacts, createTag, deleteTag, createSegment, deleteSegment,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { BulkTagResult, ContactSources, PersonDetail, PersonRow, SegmentDefinition, Tag } from '@/lib/crm';
import { cleanFilter, viewToRequest, type ViewState } from '@/lib/contacts-screen';

/**
 * What the Contacts screen asks of the server after it has loaded. Every call answers with a result the screen can
 * show: `expired` sends the person to sign in again, anything else carries a code the screen turns into words.
 */
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; expired: boolean };

/** Runs one call and turns a failure into a reply instead of a thrown error (a server action's throw reaches the page as a crash). */
async function reply<T>(fn: () => Promise<T>): Promise<Reply<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return { ok: false, error: 'EXPIRED', expired: true };
    return { ok: false, error: error instanceof CrmApiError ? error.code : 'ERROR', expired: false };
  }
}

/** One page of the people a view shows, and how many it shows in all. */
export async function loadPeopleAction(view: ViewState): Promise<Reply<{ rows: PersonRow[]; total: number }>> {
  return reply(() => listPeople(viewToRequest(view)));
}

/** The files, own tags and saved lists with their current counts. */
export async function loadSourcesAction(): Promise<Reply<ContactSources>> {
  return reply(() => getContactSources());
}

/** One person for the side panel. */
export async function loadDetailAction(id: string): Promise<Reply<PersonDetail>> {
  return reply(() => getPersonDetail(id));
}

/** Who a tag is added to: the ticked people, or everyone the view matches (resolved on the server, not sent as ids). */
export type TagWho = { kind: 'ids'; ids: string[] } | { kind: 'view'; view: ViewState; expected: number };

/** Adds a tag to the ticked people, or to everyone the current view matches. */
export async function addTagAction(tagId: string, who: TagWho): Promise<Reply<BulkTagResult>> {
  return reply(() => {
    if (who.kind === 'ids') {
      return bulkTagContacts(tagId, { action: 'add', dryRun: false, target: { kind: 'ids', ids: who.ids } });
    }
    const r = viewToRequest(who.view, false);
    return bulkTagContacts(tagId, {
      action: 'add', dryRun: false, expectedCount: who.expected,
      target: {
        kind: 'search',
        ...(r.q === undefined ? {} : { q: r.q }),
        ...(r.tag === undefined ? {} : { tagId: r.tag }),
        ...(r.file === undefined ? {} : { importRunId: r.file }),
        ...(r.filter === undefined ? {} : { criteria: r.filter })
      }
    });
  });
}

/** Takes a tag off exactly the people it was just added to. */
export async function undoTagAction(tagId: string, ids: string[]): Promise<Reply<BulkTagResult>> {
  return reply(() => bulkTagContacts(tagId, { action: 'remove', dryRun: false, target: { kind: 'ids', ids } }));
}

/** Makes a tag of the person's own. */
export async function createTagAction(name: string): Promise<Reply<Tag>> {
  return reply(() => createTag(name.trim()));
}

/** Deletes a tag of the person's own; the server refuses a file's tag. */
export async function deleteTagAction(id: string): Promise<Reply<null>> {
  return reply(async () => { await deleteTag(id); return null; });
}

/** Keeps the current filter as a saved list. */
export async function saveListAction(name: string, filter: SegmentDefinition): Promise<Reply<{ id: string; name: string }>> {
  return reply(() => createSegment(name.trim(), cleanFilter(filter)));
}

/** Deletes a saved list; the people in it stay. */
export async function deleteListAction(id: string): Promise<Reply<null>> {
  return reply(async () => { await deleteSegment(id); return null; });
}
