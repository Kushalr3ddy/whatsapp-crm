'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCampaign, startCampaign, pauseCampaign, cancelCampaign, createSegment, previewSegmentCount, uploadCampaignPicture,
  CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { CampaignPicture, CampaignTarget, SegmentDefinition } from '@/lib/crm';

/** Builds a segment filter from the inline audience builder, including only criteria that were set. */
function filterFromForm(get: (name: string) => string): SegmentDefinition {
  const def: SegmentDefinition = {};
  const tagId = get('filterTagId');
  if (tagId !== '') def.tagIds = [tagId];
  const replied = get('filterReplied');
  if (replied === 'ever' || replied === 'never') def.replied = replied;
  const days = Number(get('filterDays'));
  if (Number.isInteger(days) && days > 0) def.lastContactedWithinDays = days;
  return def;
}

/**
 * Uploads the picture or GIF chosen on the new-campaign form. The server decides everything (type from the bytes, 5 MB, GIF
 * conversion) and the answer is either the stored picture or the reason in words; the form shows it as it is.
 */
export async function uploadPictureAction(formData: FormData): Promise<{ ok: boolean; picture?: CampaignPicture; error?: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file first.' };
  try {
    return { ok: true, picture: await uploadCampaignPicture(await file.arrayBuffer(), file.name) };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Counts who an inline filter would reach, for the audience builder's live number. Called from the
 * browser as the person changes a field; returns null when the count could not be read, so the
 * builder shows nothing rather than a wrong number.
 */
export async function previewAudienceAction(
  filter: { tagId: string; replied: string; days: string }
): Promise<number | null> {
  const def = filterFromForm((n) => ({
    filterTagId: filter.tagId, filterReplied: filter.replied, filterDays: filter.days
  } as Record<string, string>)[n] ?? '');
  if (Object.keys(def).length === 0) return null;
  try {
    return await previewSegmentCount(def);
  } catch {
    return null;
  }
}

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
  const mediaAssetId = String(formData.get('mediaAssetId') ?? '');

  // Inline audience: a filter built right in the form. It becomes a segment (so it is resolved and
  // frozen at launch like any other audience); `keepAudience` decides whether it is listed for reuse.
  let inlineSegmentId = '';
  if (String(formData.get('audienceMode') ?? '') === 'filter') {
    const def = filterFromForm((n) => String(formData.get(n) ?? ''));
    const keep = formData.get('keepAudience') === 'on';
    const keptName = String(formData.get('audienceName') ?? '').trim();
    // Never "everyone" by accident: an empty filter is not an audience.
    if (Object.keys(def).length === 0 || (keep && keptName === '') || name === '') {
      redirect('/broadcast/new?error=missing');
    }
    try {
      const made = await createSegment(
        keep ? keptName : `${name} · audience ${Date.now().toString(36)}`, def, keep
      );
      inlineSegmentId = made.id;
    } catch (error) {
      if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
      const code = error instanceof CrmApiError ? error.code : 'ERROR';
      redirect(`/broadcast/new?error=${encodeURIComponent(code)}`);
    }
  }

  // The audience is a tag, an import, or a segment — exactly one. The form offers all three selects
  // with a "none" default; picking neither or more than one is a mistake worth a clear message.
  const chosen: CampaignTarget[] = [];
  if (inlineSegmentId !== '') chosen.push({ fromSegmentId: inlineSegmentId });
  if (fromTagId !== '') chosen.push({ fromTagId });
  if (fromImportRunId !== '') chosen.push({ fromImportRunId });
  if (fromSegmentId !== '' && inlineSegmentId === '') chosen.push({ fromSegmentId });

  if (name === '' || body === '' || senderIdentityId === '' || chosen.length !== 1) {
    redirect('/broadcast/new?error=missing');
  }

  let id: string;
  try {
    const created = await createCampaign({ name, body, senderIdentityId, ...(mediaAssetId !== '' ? { mediaAssetId } : {}), ...chosen[0]! });
    id = created.id;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/broadcast/new?error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/broadcast');
  redirect(`/broadcast/${id}?created=1`);
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
