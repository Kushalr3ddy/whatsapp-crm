'use server';

import { revalidatePath } from 'next/cache';
import {
  setRotationPaused, verifyEncryption, CrmApiError, type EncryptionVerify
} from '@/lib/crm';

/** What the wizard's buttons get back: ok, or a reason to show. */
export interface RotationResult {
  ok: boolean;
  error?: string;
  verify?: EncryptionVerify;
}

/** Turns an error into the sentence shown next to the button. */
function reason(error: unknown): string {
  return error instanceof CrmApiError ? error.message : 'Could not reach the API.';
}

/** Pauses or resumes the background re-encryption, then refreshes the page. */
export async function setPausedAction(paused: boolean): Promise<RotationResult> {
  try {
    await setRotationPaused(paused);
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
  revalidatePath('/security');
  return { ok: true };
}

/** Decrypts a random sample from this org's data and returns what was found. */
export async function verifyAction(): Promise<RotationResult> {
  try {
    return { ok: true, verify: await verifyEncryption() };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
