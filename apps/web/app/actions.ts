'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import {
  queueReply, startLink, getLinkState, unlinkSender, updateConversation, addParticipant, removeParticipant, addNote,
  uploadImport, runImportMapping, queueAttachment, getSenderStatus, getImportProblems, CrmApiError
} from '@/lib/crm';
import type { SenderStatus, LinkMode, ImportUpload, ImportSummary, ImportProblems } from '@/lib/crm';

/** What the composer gets back: either accepted, or a reason to show the person. */
export interface SendResult {
  ok: boolean;
  error?: string;
  /** True when the send was held because someone else just replied or is typing (D-54). */
  collision?: boolean;
}

/**
 * Queues a reply into a thread, then refreshes it so the new message appears immediately.
 *
 * Runs on the server, which is what keeps the API key out of the browser. Errors are
 * returned rather than thrown: a rejected send is an ordinary outcome the composer should
 * display — an unreachable number, or no linked sender — not a crashed page.
 */
export async function sendReply(
  conversationId: string, body: string, override?: { reason: string }, acknowledgeCollision?: boolean
): Promise<SendResult> {
  const text = body.trim();
  if (text === '') return { ok: false, error: 'Nothing to send.' };

  try {
    await queueReply(conversationId, text, override, acknowledgeCollision);
  } catch (error) {
    // A collision is not a failure: someone else just replied or is typing, and the composer asks
    // "send anyway?". It is flagged so the box can offer that instead of just showing an error.
    if (error instanceof CrmApiError) {
      return { ok: false, error: error.message, ...(error.code === 'COLLISION' ? { collision: true } : {}) };
    }
    return { ok: false, error: 'Could not reach the API.' };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * The status line's own action: whether the number behind a thread can send right now. The composer
 * calls it on a timer so the warning appears (and clears) without a page reload. A failure to ask
 * returns null — the composer then stays as it was rather than guessing the number is down.
 */
export async function senderStatusAction(conversationId: string): Promise<SenderStatus | null> {
  try {
    return await getSenderStatus(conversationId);
  } catch {
    return null;
  }
}

/**
 * Sends a file into a thread, with the composer's text as its caption. The bytes go straight to the
 * API; a refusal (wrong file type, too large, thread locked) comes back as a message to show.
 */
export async function sendAttachment(
  conversationId: string, formData: FormData
): Promise<SendResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file first.' };
  const caption = typeof formData.get('caption') === 'string' ? (formData.get('caption') as string).trim() : '';
  try {
    await queueAttachment(conversationId, await file.arrayBuffer(), file.name === '' ? 'file' : file.name, caption);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * Adds an internal note to a thread, then refreshes so it appears in place. A note is never
 * sent to the contact — it lives in a different table the send path never reads.
 */
export async function saveNote(conversationId: string, body: string): Promise<SendResult> {
  const text = body.trim();
  if (text === '') return { ok: false, error: 'Nothing to add.' };

  try {
    await addNote(conversationId, text);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * Changes a thread's status or assignee, then refreshes the inbox so the list and the thread
 * both reflect it. Errors come back rather than thrown — reassigning is an ordinary action a
 * colleague might race on, not a crash — so the caller can show the reason and move on.
 */
export async function updateThread(
  conversationId: string,
  patch: { status?: 'open' | 'closed'; assigneeUserId?: string | null }
): Promise<SendResult> {
  try {
    await updateConversation(conversationId, patch);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * Adds or removes a participant on a thread, then refreshes the inbox. Admin only on the server;
 * a refusal comes back as a message rather than a throw, like the other thread actions.
 */
export async function setParticipant(
  conversationId: string, userId: string, present: boolean
): Promise<SendResult> {
  try {
    if (present) await addParticipant(conversationId, userId);
    else await removeParticipant(conversationId, userId);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

/** What the link panel needs on each poll: a rendered QR, or a reason there is not one. */
export interface LinkStatus {
  state: 'pending' | 'challenge_ready' | 'connected' | 'error';
  /** For `error`: the classified failure (title, one-line summary, what to do next). */
  error?: { code: string; title: string; summary: string; hint: string; statusCode?: number | null } | null;
  /** The QR as an inline SVG data URL, ready for an `img` src. Null unless a QR is current. */
  qrDataUrl: string | null;
  pairingCode: string | null;
  expiresAt: string | null;
  detail: string | null;
}

/** What the import panel gets back from an upload: the parsed file, or a reason it was refused. */
export interface UploadResult {
  ok: boolean;
  error?: string;
  upload?: ImportUpload;
  /** True when the refusal was "these exact bytes were uploaded before", so the screen can offer to upload anyway. */
  duplicate?: boolean;
}

/**
 * Uploads a CSV or .xlsx sheet. The bytes go straight to the API (not through a JSON body), and
 * a refusal — a duplicate file, a malformed sheet — comes back as a message rather than a throw,
 * because those are ordinary things a person doing an import needs to see and act on.
 */
export async function uploadSheet(formData: FormData): Promise<UploadResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file first.' };
  const name = file.name === '' ? 'upload' : file.name;
  const contentType = name.toLowerCase().endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
  try {
    // `force` is only ever set by the "Upload anyway" button, after the person has seen why it was refused.
    const upload = await uploadImport(await file.arrayBuffer(), name, contentType, formData.get('force') === '1');
    return { ok: true, upload };
  } catch (error) {
    if (error instanceof CrmApiError) {
      return { ok: false, error: error.message, ...(error.code === 'ALREADY_IMPORTED' ? { duplicate: true } : {}) };
    }
    return { ok: false, error: 'Could not reach the API.' };
  }
}

/** The outcome of previewing or committing an import. */
export interface RunResult {
  ok: boolean;
  error?: string;
  summary?: ImportSummary;
}

/**
 * Builds the mapping from the columns the person picked and runs it — a dry run to preview, or a
 * commit to write the contacts. The mapping is assembled here rather than trusted from the
 * client: the phone column is required, the name and email are optional.
 */
export async function runSheet(
  id: string,
  cols: {
    /** Every column that holds a phone number, in the order to try them. At least one. */
    phones: string[];
    name: string | null;
    /** A first-name and a last-name column to join into the name, instead of one name column. */
    nameParts: { first: string; last: string } | null;
    email: string | null;
  },
  dryRun: boolean,
  tagName?: string,
  keep: string[] = []
): Promise<RunResult> {
  const identities: unknown[] = cols.phones.map((from) => ({ kind: 'phone', from, transform: ['trim'] }));
  if (cols.email !== null) identities.push({ kind: 'email', from: cols.email, transform: ['trim', 'lower'] });
  const mapping = {
    version: 1,
    displayName: cols.nameParts === null && cols.name !== null ? { from: cols.name, transform: ['trim'] } : undefined,
    nameParts: cols.nameParts ?? undefined,
    identities,
    defaultCountry: 'IN',
    unmapped: 'keep',
    // Columns the person ticked to keep on each contact. Never the three already used above.
    fields: keep.filter((h) => !cols.phones.includes(h) && h !== cols.name && h !== cols.nameParts?.first && h !== cols.nameParts?.last && h !== cols.email)
      .slice(0, 200).map((from) => ({ from }))
  };
  try {
    const summary = await runImportMapping(id, mapping, dryRun, tagName?.trim() || undefined);
    if (!dryRun) revalidatePath('/inbox');
    return { ok: true, summary };
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
}

/** The rows of an import that failed or lost something, for the problem box on the import screen. */
export async function importProblems(id: string): Promise<ImportProblems> {
  try {
    return await getImportProblems(id);
  } catch {
    return { errors: [], warnings: [] };
  }
}

/** Unlinks a number, so a corrupt or logged-out session can be linked again from scratch. */
export async function unlinkNumber(senderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await unlinkSender(senderId);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
  return { ok: true };
}

/** Asks the gateway to start linking. The challenge arrives on a later poll, not from this call. */
export async function beginLink(
  senderId: string, mode: LinkMode = 'qr', phoneE164?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await startLink(senderId, mode, phoneE164);
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
  return { ok: true };
}

/**
 * Polls one linking attempt and renders the QR server-side.
 *
 * The QR is turned into an SVG here rather than in the browser so the challenge string — which
 * is a credential for as long as it lives — is never handed to client JavaScript.
 */
export async function pollLink(senderId: string): Promise<LinkStatus> {
  const empty = { qrDataUrl: null, pairingCode: null, expiresAt: null };

  let state;
  try {
    state = await getLinkState(senderId);
  } catch (error) {
    const detail = error instanceof CrmApiError ? error.message : 'Could not reach the API.';
    return { state: 'error', ...empty, detail };
  }

  if (state.connectionState === 'open') {
    return { state: 'connected', ...empty, detail: 'Linked. This number can send now.' };
  }
  if (state.state === 'error' && state.error) {
    return { state: 'error', ...empty, detail: state.error.summary, error: state.error };
  }
  if (state.challenge === null) {
    return {
      state: 'pending', ...empty,
      detail: 'Waiting for the gateway to produce a QR. Is `npm run gateway` running?'
    };
  }
  if (state.challenge.mode === 'pairing_code') {
    return {
      state: 'challenge_ready', qrDataUrl: null, pairingCode: state.challenge.code,
      expiresAt: state.challenge.expiresAt, detail: null
    };
  }

  const svg = await QRCode.toString(state.challenge.qr, {
    type: 'svg', margin: 1, errorCorrectionLevel: 'L'
  });
  return {
    state: 'challenge_ready',
    qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    pairingCode: null,
    expiresAt: state.challenge.expiresAt,
    detail: null
  };
}
