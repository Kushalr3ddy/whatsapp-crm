'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { aiAnswerNow, queueAttachment, queueReply, updateConversation, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import { getInbox, getInboxFilterChoices } from '@/lib/inbox';
import type { InboxFilterChoices, InboxPage, InboxQuery } from '@/lib/inbox';
import type { SendResult } from '../actions';

/** The most pictures one reply carries. */
const MAX_IMAGES = 5;

/** The list as it is right now, or a plain "could not load" the screen shows with Try again. A lapsed session goes to sign-in. */
export async function loadInboxAction(query: InboxQuery): Promise<{ ok: true; page: InboxPage } | { ok: false }> {
  try {
    return { ok: true, page: await getInbox(query) };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/inbox');
    return { ok: false };
  }
}

/** The campaigns and files to choose from in Filters. A failed read leaves the panel with no choices, not broken. */
export async function loadFilterChoicesAction(): Promise<InboxFilterChoices> {
  try {
    return await getInboxFilterChoices();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/inbox');
    return { campaigns: [], files: [] };
  }
}

/**
 * Sends one reply. With no pictures it is the ordinary text reply (with the do-not-contact override and the "send anyway" after a
 * collision). With pictures, each goes as its own message in the order pasted and the text rides along as the caption of the first.
 * The text arrives already filled in for this person.
 */
export async function sendInboxReply(conversationId: string, form: FormData): Promise<SendResult> {
  const text = typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '';
  const files = form.getAll('image').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGES) return { ok: false, error: `You can send up to ${String(MAX_IMAGES)} pictures at once.` };
  if (text === '' && files.length === 0) return { ok: false, error: 'Nothing to send.' };

  try {
    if (files.length === 0) {
      const reason = typeof form.get('overrideReason') === 'string' ? (form.get('overrideReason') as string).trim() : '';
      await queueReply(conversationId, text, reason === '' ? undefined : { reason }, form.get('acknowledge') === '1');
    } else {
      let first = true;
      for (const file of files) {
        await queueAttachment(conversationId, await file.arrayBuffer(), file.name === '' ? 'picture' : file.name, first ? text.slice(0, 1024) : '');
        first = false;
      }
    }
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/inbox');
    if (error instanceof CrmApiError) return { ok: false, error: error.message, ...(error.code === 'COLLISION' ? { collision: true } : {}) };
    return { ok: false, error: 'Could not reach the API.' };
  }
  revalidatePath('/inbox');
  return { ok: true };
}

/** Lets the AI have another go at the customer's last message. */
export async function retryAiAction(conversationId: string): Promise<SendResult> {
  try {
    await aiAnswerNow(conversationId);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/inbox');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

/** Gives a chat to a person, or to nobody (the AI has its own actions, which also ask it to answer). */
export async function setOwnerAction(conversationId: string, userId: string | null): Promise<SendResult> {
  try {
    await updateConversation(conversationId, { assigneeUserId: userId });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/inbox');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}
