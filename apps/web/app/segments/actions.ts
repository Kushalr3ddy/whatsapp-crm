'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createSegment, deleteSegment, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { SegmentDefinition } from '@/lib/crm';

/**
 * Builds a segment definition from the builder form's fields, including only the criteria that were
 * actually set — an empty tag / "any" reply / blank days each drop out, so an untouched field never
 * becomes a filter.
 */
function definitionFromForm(formData: FormData): SegmentDefinition {
  const def: SegmentDefinition = {};
  const tagId = String(formData.get('tagId') ?? '');
  if (tagId !== '') def.tagIds = [tagId];
  const replied = String(formData.get('replied') ?? '');
  if (replied === 'ever' || replied === 'never') def.replied = replied;
  const days = Number(formData.get('days') ?? '');
  if (Number.isInteger(days) && days > 0) def.lastContactedWithinDays = days;
  return def;
}

/** Saves a segment from the builder. Redirects back with an error code on a bad input or clash. */
export async function createSegmentAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') redirect('/segments?error=missing');
  const definition = definitionFromForm(formData);

  try {
    await createSegment(name, definition);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/segments');
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/segments?error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/segments');
  redirect('/segments');
}

/** Deletes a segment. */
export async function deleteSegmentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  try {
    await deleteSegment(id);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/segments');
  }
  revalidatePath('/segments');
}
