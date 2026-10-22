'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { setSenderEnforcement, createSender, removeSender, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

/**
 * Switches a number between enforcing the anti-ban engine and advisory mode (D-29). Admin-only on
 * the API; a refusal (not an admin, no reason) just reloads the page, which shows the true state.
 */
export async function setEnforcementAction(formData: FormData): Promise<void> {
  const senderId = String(formData.get('senderId') ?? '');
  const mode = formData.get('mode') === 'advisory' ? 'advisory' : 'enforce';
  const reason = String(formData.get('reason') ?? '').trim();
  if (senderId === '') return;
  try {
    await setSenderEnforcement(senderId, mode, mode === 'advisory' ? reason : undefined);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/link');
    if (!(error instanceof CrmApiError)) throw error;
  }
  revalidatePath('/link');
}

/** What the Add-a-number form gets back: done, or a plain reason it was not. */
export interface AddNumberResult { ok: boolean; error?: string; id?: string }

/**
 * Creates a number so it can be linked from the Numbers page. The name is what people see in the list. No phone
 * number is asked for: WhatsApp reports the real one once the number is linked, and the gateway saves it then.
 */
export async function addNumberAction(label: string): Promise<AddNumberResult> {
  const name = label.trim();
  if (name === '') return { ok: false, error: 'Give the number a name, for example "Sales line".' };
  let id: string;
  try {
    id = (await createSender(name)).id;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/link');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath('/link');
  return { ok: true, id };
}

/** Hides an unlinked number from this page (admin). A refusal (still linked, not an admin) just reloads. */
export async function removeSenderAction(formData: FormData): Promise<void> {
  const senderId = String(formData.get('senderId') ?? '');
  if (senderId === '') return;
  try {
    await removeSender(senderId);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/link');
    if (!(error instanceof CrmApiError)) throw error;
  }
  revalidatePath('/link');
}
