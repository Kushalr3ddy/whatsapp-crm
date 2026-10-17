'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addTeamMember, updateTeamMember, resetTeamPassword, CrmApiError, NotAuthenticatedError } from '@/lib/crm';

/** What a Team action gives back: done, or a plain reason it was not. */
export interface TeamResult { ok: boolean; error?: string }

/** Turns a failed call into a result the page can show, or sends the person to sign in again. */
function failure(error: unknown): TeamResult {
  if (error instanceof NotAuthenticatedError) redirect('/login?next=/team');
  if (error instanceof CrmApiError) return { ok: false, error: error.message };
  throw error;
}

/** Adds a person with the password the admin chose. They can sign in straight away. */
export async function addMemberAction(
  input: { email: string; displayName: string; role: 'admin' | 'agent'; password: string }
): Promise<TeamResult> {
  if (input.displayName.trim() === '') return { ok: false, error: 'Give them a name.' };
  if (input.password.length < 12) return { ok: false, error: 'The password needs at least 12 characters.' };
  try {
    await addTeamMember({ ...input, email: input.email.trim(), displayName: input.displayName.trim() });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/team');
  return { ok: true };
}

/** Changes someone's role, or disables or re-enables them. */
export async function changeMemberAction(
  userId: string, change: { role?: 'admin' | 'agent'; status?: 'active' | 'disabled' }
): Promise<TeamResult> {
  try {
    await updateTeamMember(userId, change);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/team');
  return { ok: true };
}

/** Sets a new password for someone and signs them out everywhere. */
export async function resetPasswordAction(userId: string, password: string): Promise<TeamResult> {
  if (password.length < 12) return { ok: false, error: 'The password needs at least 12 characters.' };
  try {
    await resetTeamPassword(userId, password);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/team');
  return { ok: true };
}
