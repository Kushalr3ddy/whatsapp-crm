'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveAiSettings, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

/** What an AI settings action gives back: done, or a plain reason it was not. */
export interface AiResult { ok: boolean; error?: string }

/** Saves the AI assistant's settings, or says why not. */
export async function saveAiAction(
  change: { enabled?: boolean; instructions?: string; dailyMessageCap?: number; acceptConsent?: boolean }
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
