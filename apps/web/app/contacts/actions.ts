'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTag, attachTag, detachTag, NotAuthenticatedError } from '@/lib/crm';

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
