'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCampaign, startCampaign, pauseCampaign, cancelCampaign,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { CampaignTarget } from '@/lib/crm';

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
  const fromImportRunId = String(formData.get('fromImportRunId') ?? '');
  const fromSegmentId = String(formData.get('fromSegmentId') ?? '');

  // The audience is a tag, an import, or a segment — exactly one. The form offers all three selects
  // with a "none" default; picking neither or more than one is a mistake worth a clear message.
  const chosen: CampaignTarget[] = [];
  if (fromTagId !== '') chosen.push({ fromTagId });
  if (fromImportRunId !== '') chosen.push({ fromImportRunId });
  if (fromSegmentId !== '') chosen.push({ fromSegmentId });

  if (name === '' || body === '' || senderIdentityId === '' || chosen.length !== 1) {
    redirect('/broadcast/new?error=missing');
  }

  let id: string;
  try {
    const created = await createCampaign({ name, body, senderIdentityId, ...chosen[0]! });
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
  // An admin may lift recipient-experience gates for this campaign, with a reason (the API refuses
  // anyone else); a plain start sends no override at all.
  const overrideGates = formData.getAll('overrideGates').map(String);
  const reason = String(formData.get('reason') ?? '').trim();
  await control(id, () => startCampaign(
    id, overrideGates.length > 0 ? { overrideGates, reason } : undefined
  ));
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
