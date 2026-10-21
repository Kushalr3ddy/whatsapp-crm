'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveAiSettings, allowAiReply, sendAiCommand, draftCampaignBody, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { AiCommandResult } from '@/lib/crm';

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

/** Tells the assistant to run campaigns; returns what it did, or why it could not. */
export async function aiCommandAction(instruction: string): Promise<AiResult & { result?: AiCommandResult }> {
  if (instruction.trim().length < 3) return { ok: false, error: 'Write what you want the assistant to do.' };
  try {
    const result = await sendAiCommand(instruction.trim());
    revalidatePath('/broadcast');
    return { ok: true, result };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/ai');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Writes campaign wording from a goal, for the new-campaign form. */
export async function draftBodyAction(goal: string): Promise<AiResult & { body?: string }> {
  if (goal.trim().length < 3) return { ok: false, error: 'Say what the message should do.' };
  try {
    return { ok: true, body: (await draftCampaignBody(goal.trim())).body };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login');
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    throw error;
  }
}
