'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { setSenderEnforcement, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

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
