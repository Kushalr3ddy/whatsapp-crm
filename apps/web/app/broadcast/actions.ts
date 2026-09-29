'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCampaign, startCampaign, pauseCampaign, cancelCampaign,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';

/**
 * Runs one campaign control (start/pause/cancel) on the server, then refreshes that campaign's
 * page so the new state shows. A lapsed session goes to /login; a benign failure is swallowed —
 * reloading shows the true state, which is all the operator needs.
 */
async function control(id: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect(`/login?next=/broadcast/${id}`);
  }
  revalidatePath(`/broadcast/${id}`);
}

/**
 * Creates a draft campaign from the new-campaign form and sends the operator to its page.
 *
 * On a bad input or a rejected sender/tag it redirects back to the form with an error code rather
 * than throwing an unstyled page. `redirect` is called outside the try because it works by
 * throwing, which a catch-all would otherwise swallow.
 */
export async function createCampaignAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const senderIdentityId = String(formData.get('senderIdentityId') ?? '');
  const fromTagId = String(formData.get('fromTagId') ?? '');

  if (name === '' || body === '' || senderIdentityId === '' || fromTagId === '') {
    redirect('/broadcast/new?error=missing');
  }

  let id: string;
  try {
    const created = await createCampaign({ name, body, senderIdentityId, fromTagId });
    id = created.id;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/broadcast/new?error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/broadcast');
  redirect(`/broadcast/${id}`);
}

/** Starts (or resumes) a campaign. */
export async function startCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await control(id, () => startCampaign(id));
}

/** Pauses a running campaign. */
export async function pauseCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await control(id, () => pauseCampaign(id));
}

/** Cancels a campaign for good. */
export async function cancelCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await control(id, () => cancelCampaign(id));
}
