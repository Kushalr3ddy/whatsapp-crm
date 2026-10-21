'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  saveAiSettings, allowAiReply, listAiJobs, enqueueAiJob, cancelAiJob, generateAiTemplate, saveAiTemplate, useAiTemplate, deleteAiTemplate,
  createTag, bulkTagContacts, createCampaign, countContacts, CrmApiError, NotAuthenticatedError
} from '@/lib/crm';
import type { AiJob, AiTemplate, GeneratedAiTemplate } from '@/lib/crm';

/** What an AI settings action gives back: done, or a plain reason it was not. */
export interface AiResult { ok: boolean; error?: string }

/** Saves the AI assistant's settings, or says why not. */
export async function saveAiAction(
  change: { enabled?: boolean; instructions?: string; dailyMessageCap?: number; mayStartCampaigns?: boolean; acceptConsent?: boolean }
): Promise<AiResult> {
  try {
    await saveAiSettings(change);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath('/ai');
  revalidatePath('/team');
  return { ok: true };
}

/** An admin lets the assistant answer one do-not-contact chat, with the reason that goes in the audit log. */
export async function allowAiReplyAction(conversationId: string, reason: string): Promise<AiResult> {
  if (reason.trim().length < 10) return { ok: false, error: 'Give a reason of at least 10 characters.' };
  try {
    await allowAiReply(conversationId, reason.trim());
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

/** Puts a request in the AI queue. */
export async function enqueueJobAction(kind: 'command' | 'draft', input: string): Promise<AiResult & { id?: string }> {
  if (input.trim().length < 3) return { ok: false, error: 'Write what you want the assistant to do.' };
  try {
    return { ok: true, id: (await enqueueAiJob(kind, input.trim())).id };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** The queue as it is right now; polled by the page. A failed poll is not an error to show: the next one tries again. */
export async function listJobsAction(): Promise<{ ok: boolean; jobs: AiJob[] }> {
  try {
    return { ok: true, jobs: await listAiJobs() };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    return { ok: false, jobs: [] };
  }
}

/** Cancels a waiting request. */
export async function cancelJobAction(id: string): Promise<AiResult> {
  try {
    await cancelAiJob(id);
    return { ok: true };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Asks the AI to write a template from a description. Nothing is saved. */
export async function generateTemplateAction(description: string, answers: string[]): Promise<{ ok: boolean; error?: string; template?: GeneratedAiTemplate }> {
  try {
    return { ok: true, template: await generateAiTemplate(description, answers) };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Saves a template (new, or replacing the one with `id`). */
export async function saveTemplateAction(
  input: { id?: string; name: string; description: string; instructions: string; audience: string; firstMessage: string }
): Promise<{ ok: boolean; error?: string; template?: AiTemplate }> {
  try {
    const template = await saveAiTemplate(input);
    revalidatePath('/ai');
    return { ok: true, template };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Notes a template as used, and optionally makes it what every chat follows by default. */
export async function useTemplateAction(id: string, setAsDefault: boolean): Promise<{ ok: boolean; error?: string; template?: AiTemplate }> {
  try {
    const template = await useAiTemplate(id, setAsDefault);
    revalidatePath('/ai');
    return { ok: true, template };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Removes a saved template. */
export async function deleteTemplateAction(id: string): Promise<AiResult> {
  try {
    await deleteAiTemplate(id);
    revalidatePath('/ai');
    return { ok: true };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** How the people for a group message are found: a search over the contact book, the same rule the Contacts page uses. */
export interface GroupFilter { q: string; tagId: string; from: string; to: string; dateBy: 'added' | 'imported' }

/** Turns the form's filter into the contact list's parameters; empty parts are left out. */
function filterParams(f: GroupFilter): { q?: string; tag?: string; from?: string; to?: string; dateBy?: 'added' | 'imported' } {
  return {
    ...(f.q.trim() !== '' ? { q: f.q.trim() } : {}), ...(f.tagId !== '' ? { tag: f.tagId } : {}),
    ...(f.from !== '' ? { from: f.from } : {}), ...(f.to !== '' ? { to: f.to } : {}),
    ...((f.from !== '' || f.to !== '') && f.dateBy === 'imported' ? { dateBy: 'imported' as const } : {})
  };
}

/** How many people a search finds, so the number is seen before anyone is tagged. */
export async function countGroupAction(filter: GroupFilter): Promise<{ ok: boolean; count?: number; error?: string }> {
  const params = filterParams(filter);
  if (Object.keys(params).length === 0) return { ok: false, error: 'Search for something first, so a group is never everyone by accident.' };
  try {
    return { ok: true, count: await countContacts(params) };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Makes a draft campaign from a template. The audience is always a tag: an existing one, or a new one (named by the person, by
 * default `<template>-N (date, time)`) that the people found by the search are tagged with first. An admin presses Start later.
 */
export async function createGroupCampaignAction(input: {
  templateId: string; name: string; body: string; senderIdentityId: string;
  audience: { mode: 'tag'; tagId: string } | { mode: 'search'; filter: GroupFilter; tagName: string; expectedCount: number };
}): Promise<{ ok: boolean; error?: string; campaignId?: string }> {
  if (input.name.trim() === '' || input.body.trim() === '' || input.senderIdentityId === '') {
    return { ok: false, error: 'Fill in the name, the message and the number to send from.' };
  }
  try {
    let tagId: string;
    if (input.audience.mode === 'tag') {
      if (input.audience.tagId === '') return { ok: false, error: 'Choose a tag.' };
      tagId = input.audience.tagId;
    } else {
      const tagName = input.audience.tagName.trim();
      if (tagName === '' || tagName.length > 60) return { ok: false, error: 'Give the tag a name of up to 60 characters.' };
      const params = filterParams(input.audience.filter);
      if (Object.keys(params).length === 0) return { ok: false, error: 'Search for something first.' };
      tagId = (await createTag(tagName)).id;
      await bulkTagContacts(tagId, {
        action: 'add', dryRun: false, expectedCount: input.audience.expectedCount,
        target: {
          kind: 'search', ...(params.q !== undefined ? { q: params.q } : {}), ...(params.tag !== undefined ? { tagId: params.tag } : {}),
          ...(params.from !== undefined ? { from: params.from } : {}), ...(params.to !== undefined ? { to: params.to } : {}),
          ...(params.dateBy !== undefined ? { dateBy: params.dateBy } : {})
        }
      });
    }
    const made = await createCampaign({
      name: input.name.trim(), body: input.body.trim(), senderIdentityId: input.senderIdentityId, fromTagId: tagId, aiTemplateId: input.templateId
    });
    revalidatePath('/broadcast');
    return { ok: true, campaignId: made.id };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) {
      return { ok: false, error: error.code === 'CONFLICT' ? 'A tag with that name already exists. Change the tag name.' : error.message };
    }
    throw error;
  }
}
