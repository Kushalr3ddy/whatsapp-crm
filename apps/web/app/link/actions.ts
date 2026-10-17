'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { setSenderEnforcement, createSender, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

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
export interface AddNumberResult { ok: boolean; error?: string }

/**
 * Creates a number so it can be linked from the Numbers page. The name is what people see in the
 * list; the phone number is optional because WhatsApp reports the real one once the number is linked.
 */
export async function addNumberAction(label: string, phone: string): Promise<AddNumberResult> {
  const name = label.trim();
  if (name === '') return { ok: false, error: 'Give the number a name, for example "Sales line".' };
  const cleaned = phone.replace(/[\s()-]/g, '');
  if (cleaned !== '' && !/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return { ok: false, error: 'Write the number with its country code, like +919876543210, or leave it empty.' };
  }
  try {
    await createSender(name, cleaned);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/link');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath('/link');
  return { ok: true };
}
