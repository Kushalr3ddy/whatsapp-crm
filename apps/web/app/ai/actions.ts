'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  saveAiSettings, allowAiReply, listAiJobs, enqueueAiJob, cancelAiJob, generateAiTemplate, saveAiTemplate, useAiTemplate, deleteAiTemplate,
  CrmApiError, NotAuthenticatedError
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
