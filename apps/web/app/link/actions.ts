'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSender, removeSender, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

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
