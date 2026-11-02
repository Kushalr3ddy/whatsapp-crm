'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCampaign, editCampaignDraft, startCampaign, pauseCampaign, cancelCampaign, uploadCampaignPicture,
  previewCampaign, getFillIns, reviewCampaign, listBlankFillIns, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { CampaignPicture, CampaignPreview, CampaignReview, FillInReport, ReviewTarget } from '@/lib/crm';

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

/** What the New campaign form posts, read the same way for making a draft and for saving changes to one. */
function readCampaignForm(formData: FormData) {
  const days = Number(formData.get('recentDays') ?? '');
  let targets: ReviewTarget[] = [];
  try { targets = JSON.parse(String(formData.get('targets') ?? '[]')) as ReviewTarget[]; } catch { targets = []; }
  const blank = String(formData.get('blankFillInChoice') ?? '');
  return {
    name: String(formData.get('name') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
    senderIdentityId: String(formData.get('senderIdentityId') ?? ''),
    mediaAssetId: String(formData.get('mediaAssetId') ?? ''),
    aiTemplateId: String(formData.get('aiTemplateId') ?? ''),
    // A checkbox sends nothing when it is off; off is a choice, so it is sent as false.
    mediaAfterReply: formData.get('mediaAfterReply') === 'on',
    // The answer to "N people have no <field>" (CW-7.7): leave them out, or fill the gap with a word. Anything else = send anyway.
    blankChoice: blank === 'skip' ? 'skip' as const : blank === 'fallback' ? 'fallback' as const : null,
    fillInFallback: String(formData.get('fillInFallback') ?? '').trim(),
    recentDays: Number.isInteger(days) && days >= 1 && days <= 60 ? days : undefined,
    leaveOutRecent: formData.get('leaveOutRecent') === 'on',
    targets: Array.isArray(targets) ? targets : []
  };
}

/**
 * Creates a draft campaign from the new-campaign form and sends the operator to its page.
 *
 * The audience arrives as `targets`, a JSON list of picks (files, tags, everyone); more than one is stored as the one list of people they
 * come to. On a bad input or a rejected sender/tag it redirects back to the form with an error code rather than throwing an unstyled page.
 * `redirect` is called outside the try because it works by throwing, which a catch-all would otherwise swallow.
 */
export async function createCampaignAction(formData: FormData): Promise<void> {
  const f = readCampaignForm(formData);
  if (f.name === '' || f.body === '' || f.senderIdentityId === '' || f.targets.length === 0) {
    redirect('/broadcast/new?error=missing');
  }

  let id: string;
  try {
    const created = await createCampaign({
      name: f.name, body: f.body, senderIdentityId: f.senderIdentityId, mediaAfterReply: f.mediaAfterReply, targets: f.targets,
      ...(f.mediaAssetId !== '' ? { mediaAssetId: f.mediaAssetId } : {}),
      ...(f.aiTemplateId !== '' ? { aiTemplateId: f.aiTemplateId } : {}),
      ...(f.blankChoice === 'skip' ? { blankFillInChoice: 'skip' as const } : {}),
      ...(f.blankChoice === 'fallback' && f.fillInFallback !== '' ? { blankFillInChoice: 'fallback' as const, fillInFallback: f.fillInFallback } : {}),
      ...(f.recentDays !== undefined ? { recentDays: f.recentDays } : {}),
      leaveOutRecent: f.leaveOutRecent
    });
    id = created.id;
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/broadcast/new?error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/broadcast');
  redirect(`/broadcast/${id}?created=1`);
}

/**
 * Saves the New campaign form onto an existing draft (the Edit button on a draft opens the form with its values) and goes back to
 * the draft's page. Only a draft can be saved this way: once it has started, the API refuses and the form says so.
 */
export async function saveCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('campaignId') ?? '');
  const f = readCampaignForm(formData);
  if (id === '') redirect('/broadcast');
  if (f.name === '' || f.body === '' || f.senderIdentityId === '' || f.targets.length === 0) {
    redirect(`/broadcast/new?edit=${id}&error=missing`);
  }

  try {
    await editCampaignDraft(id, {
      name: f.name, body: f.body, senderIdentityId: f.senderIdentityId, targets: f.targets,
      aiTemplateId: f.aiTemplateId === '' ? null : f.aiTemplateId,
      mediaAssetId: f.mediaAssetId === '' ? null : f.mediaAssetId,
      mediaAfterReply: f.mediaAfterReply,
      blankFillInChoice: f.blankChoice === 'fallback' && f.fillInFallback === '' ? null : f.blankChoice,
      fillInFallback: f.blankChoice === 'fallback' && f.fillInFallback !== '' ? f.fillInFallback : null,
      recentDays: f.recentDays ?? 14,
      leaveOutRecent: f.leaveOutRecent
    });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect(`/login?next=/broadcast/new?edit=${id}`);
    const code = error instanceof CrmApiError ? error.code : 'ERROR';
    redirect(`/broadcast/new?edit=${id}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/broadcast');
  revalidatePath(`/broadcast/${id}`);
  redirect(`/broadcast/${id}?saved=1`);
}

/**
 * What the picks would reach from this number, for the review panel and the fill-in table. Called from the browser as the person
 * chooses; null when it could not be read, so the panel shows nothing rather than a wrong number.
 */
export async function reviewAction(targets: ReviewTarget[], senderIdentityId: string, days?: number): Promise<CampaignReview | null> {
  if (targets.length === 0 || senderIdentityId === '') return null;
  try {
    return await reviewCampaign(targets, senderIdentityId, days);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    return null;
  }
}

/** The people with no value for a fill-in as a spreadsheet file (CSV), for "Download the list to fix". */
export async function blankListAction(targets: ReviewTarget[], key: string): Promise<{ ok: boolean; csv?: string }> {
  try {
    const rows = await listBlankFillIns(targets, key);
    const cell = (v: string | null): string => `"${(v ?? '').replace(/"/g, '""')}"`;
    return { ok: true, csv: ['name,phone', ...rows.map((r) => `${cell(r.name)},${cell(r.phone)}`)].join('\r\n') };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/broadcast/new');
    return { ok: false };
  }
}

/** Starts (or resumes) a campaign. */
export async function startCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  // An admin may lift recipient-experience gates for this campaign, with a reason (the API refuses
  // anyone else); a plain start sends no override at all.
  const overrideGates = formData.getAll('overrideGates').map(String);
  const reason = String(formData.get('reason') ?? '').trim();
  // The yes to launching with a `{{key}}` that is not a column (CW-7.7 AC4).
  const confirmUnknownFillIns = formData.get('confirmUnknownFillIns') === 'yes';
  await control(id, () => startCampaign(id, {
    ...(overrideGates.length > 0 ? { overrideGates, reason } : {}),
    ...(confirmUnknownFillIns ? { confirmUnknownFillIns } : {})
  }));
}

/**
 * What the start button needs to know before it sends: who is still in a live campaign on the same number, who got a campaign from
 * this number lately, and which `{{keys}}` are not columns. Null when it cannot be read, so Start just goes ahead and the server decides.
 */
export async function startCheckAction(id: string): Promise<CampaignPreview | null> {
  try {
    return await previewCampaign(id);
  } catch {
    return null;
  }
}

/** The fill-ins the chosen audience offers, for the Insert list; null when there is no audience to read yet or it cannot be read. */
export async function fillInsAction(audience: { fromTagId?: string; fromImportRunId?: string; fromSegmentId?: string }): Promise<FillInReport | null> {
  if (Object.values(audience).every((v) => v === undefined || v === '')) return null;
  try {
    return await getFillIns(audience);
  } catch {
    return null;
  }
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
