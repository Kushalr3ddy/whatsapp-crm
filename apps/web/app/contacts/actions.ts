'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createTag, attachTag, detachTag, createCampaign, createCustomField, deleteCustomField,
  setContactFields, setDoNotContact, bulkTagContacts, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';

/**
 * Runs one tag mutation on the server, then refreshes the contacts page so the change shows.
 *
 * A lapsed session sends the person to /login. Benign failures (a tag name already taken, a link
 * already removed) are swallowed rather than blowing up the page — reloading shows the true state
 * either way, which is all the operator needs here.
 */
async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
  }
  revalidatePath('/contacts');
}

/** Creates a tag from the "new tag" form. */
export async function createTagAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return;
  await run(() => createTag(name));
}

/** Attaches the chosen tag to a contact. */
export async function attachTagAction(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '');
  const tagId = String(formData.get('tagId') ?? '');
  if (contactId === '' || tagId === '') return;
  await run(() => attachTag(contactId, tagId));
}

/** Removes a tag from a contact. */
export async function detachTagAction(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '');
  const tagId = String(formData.get('tagId') ?? '');
  if (contactId === '' || tagId === '') return;
  await run(() => detachTag(contactId, tagId));
}

/**
 * Creates a campaign from the contacts checked on this page — the hand-picked audience.
 *
 * The checkboxes belong to this form by their `form=` attribute, so `getAll('contactId')` is
 * exactly what the operator ticked. On success it goes to the new draft; on a bad input or a
 * rejected sender it returns to /contacts with an error the page shows. `redirect` is outside the
 * try because it works by throwing.
 */
export async function createCampaignFromSelectionAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const senderIdentityId = String(formData.get('senderIdentityId') ?? '');
  const ids = formData.getAll('contactId').map((v) => String(v)).filter((v) => v !== '');

  if (name === '' || body === '' || senderIdentityId === '' || ids.length === 0) {
    redirect('/contacts?campaignError=missing');
  }

  let id: string;
  try {
    const created = await createCampaign({ name, body, senderIdentityId, explicitContactIds: ids });
    id = created.id;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/contacts?campaignError=${encodeURIComponent(code)}`);
  }
  redirect(`/broadcast/${id}`);
}

/** Defines a custom field. Admin-only on the API; anyone else's attempt is a quiet no-op. */
export async function createFieldAction(formData: FormData): Promise<void> {
  const label = String(formData.get('label') ?? '').trim();
  const type = String(formData.get('type') ?? 'text') as 'text' | 'number' | 'date' | 'select';
  const options = String(formData.get('options') ?? '').split(',').map((o) => o.trim()).filter((o) => o !== '');
  // The key is the label as a slug: "Years of experience" → years_of_experience.
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
  if (key === '') return;
  await run(() => createCustomField({ key, label, type, options }));
}

/** Removes a custom field definition (and its values everywhere). */
export async function deleteFieldAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '');
  if (key === '') return;
  await run(() => deleteCustomField(key));
}

/** Saves the field values typed into one contact's form. An empty box clears that field. */
export async function saveContactFieldsAction(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '');
  if (contactId === '') return;
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith('f_') && typeof value === 'string') values[name.slice(2)] = value;
  }
  await run(() => setContactFields(contactId, values));
}

/** Flags (with an optional reason) or clears do-not-contact on one contact. */
export async function setDncAction(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '');
  if (contactId === '') return;
  const value = formData.get('value') === 'true';
  const reason = String(formData.get('reason') ?? '').trim();
  await run(() => setDoNotContact(contactId, value, reason === '' ? undefined : reason));
}

/** Builds the `/contacts` URL to return to, keeping the current search and tag filter. */
function backTo(q: string, tag: string, extra: Record<string, string>): string {
  const p = new URLSearchParams();
  if (q !== '') p.set('q', q);
  if (tag !== '') p.set('tag', tag);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `/contacts?${p.toString()}`;
}

/**
 * Previews a bulk tag over everyone matching the current search/tag filter (or everyone). Nothing is
 * written: it redirects back with the count so the person confirms the real number before it happens.
 */
export async function bulkTagPreviewAction(formData: FormData): Promise<void> {
  const q = String(formData.get('q') ?? '');
  const tag = String(formData.get('tag') ?? '');
  const bulkTag = String(formData.get('bulkTag') ?? '');
  const bulkAction = formData.get('bulkAction') === 'remove' ? 'remove' : 'add';
  const bulkScope = formData.get('bulkScope') === 'all' ? 'all' : 'matching';
  if (bulkTag === '') redirect(backTo(q, tag, { bulkError: 'pick_tag' }));

  let matched: number;
  try {
    const target = bulkScope === 'all'
      ? { kind: 'all' as const }
      : { kind: 'search' as const, ...(q !== '' ? { q } : {}), ...(tag !== '' ? { tagId: tag } : {}) };
    matched = (await bulkTagContacts(bulkTag, { action: bulkAction, target, dryRun: true })).matched;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
    redirect(backTo(q, tag, { bulkError: error instanceof CrmApiError ? error.code : 'ERROR' }));
  }
  redirect(backTo(q, tag, { bulkTag, bulkAction, bulkScope, bulkCount: String(matched) }));
}

/** Applies the previewed bulk tag, refusing if the audience changed since the preview. */
export async function bulkTagConfirmAction(formData: FormData): Promise<void> {
  const q = String(formData.get('q') ?? '');
  const tag = String(formData.get('tag') ?? '');
  const bulkTag = String(formData.get('bulkTag') ?? '');
  const bulkAction = formData.get('bulkAction') === 'remove' ? 'remove' : 'add';
  const bulkScope = formData.get('bulkScope') === 'all' ? 'all' : 'matching';
  const expected = Number(formData.get('bulkCount') ?? '0');

  let changed: number;
  try {
    const target = bulkScope === 'all'
      ? { kind: 'all' as const }
      : { kind: 'search' as const, ...(q !== '' ? { q } : {}), ...(tag !== '' ? { tagId: tag } : {}) };
    changed = (await bulkTagContacts(bulkTag, {
      action: bulkAction, target, dryRun: false, expectedCount: expected
    })).changed;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
    redirect(backTo(q, tag, { bulkError: error instanceof CrmApiError ? error.code : 'ERROR' }));
  }
  revalidatePath('/contacts');
  redirect(backTo(q, tag, { bulkDone: String(changed), bulkAction }));
}

/** Tags (or untags) exactly the people ticked on the page, at once. */
export async function bulkTagCheckedAction(formData: FormData): Promise<void> {
  const ids = formData.getAll('contactId').map(String).filter((v) => v !== '');
  const bulkTag = String(formData.get('bulkTag') ?? '');
  const bulkAction = formData.get('bulkAction') === 'remove' ? 'remove' : 'add';
  if (ids.length === 0 || bulkTag === '') redirect('/contacts?bulkError=pick_people');
  let changed: number;
  try {
    changed = (await bulkTagContacts(bulkTag, {
      action: bulkAction, target: { kind: 'ids', ids }, dryRun: false
    })).changed;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/contacts');
    redirect(`/contacts?bulkError=${error instanceof CrmApiError ? error.code : 'ERROR'}`);
  }
  revalidatePath('/contacts');
  redirect(`/contacts?bulkDone=${String(changed)}&bulkAction=${bulkAction}`);
}
