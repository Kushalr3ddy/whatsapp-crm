'use server';

import { revalidatePath } from 'next/cache';
import { queueMessage, CrmApiError } from '@/lib/crm';

/** What the composer gets back: either accepted, or a reason to show the person. */
export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Queues a reply, then refreshes the thread so the new message appears immediately.
 *
 * Runs on the server, which is what keeps the API key out of the browser. Errors are
 * returned rather than thrown: a rejected send is an ordinary outcome the composer should
 * display — an unreachable number, or no linked sender — not a crashed page.
 */
export async function sendReply(to: string, body: string): Promise<SendResult> {
  const text = body.trim();
  if (text === '') return { ok: false, error: 'Nothing to send.' };

  try {
    await queueMessage(to, text);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }

  revalidatePath('/inbox');
  return { ok: true };
}
