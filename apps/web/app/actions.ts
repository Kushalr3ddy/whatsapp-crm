'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import {
  queueReply, startLink, getLinkState, unlinkSender, updateConversation, addParticipant, removeParticipant, addNote,
  uploadImport, runImportMapping, getSheetPage, getSheetCsv, getNumberExamples, queueAttachment, getSenderStatus, getImportProblems, CrmApiError, AlreadyImportedError, NotAuthenticatedError
} from '@/lib/crm';
import { tagProblem } from '@/lib/import';
import type { SenderStatus, LinkMode, ImportUpload, ImportSummary, ImportProblems, SheetFilter, SheetPage } from '@/lib/crm';

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

/** Said when the session ended while the person was importing. */
const SIGNED_OUT = 'You were signed out. Sign in again, then upload the file once more.';

/** What the import panel gets back from an upload: the parsed file, or a reason it was refused. */
export interface UploadResult {
  ok: boolean;
  error?: string;
  upload?: ImportUpload;
  /** True when the refusal was "these exact bytes were uploaded before", so the screen can offer to upload anyway. */
  duplicate?: boolean;
  /** For a refusal of the same file: the earlier import, so the screen can link to its people. */
  previousRunId?: string;
  /** True when the session has ended, so the screen can send the person to sign in instead of saying the API is down. */
  signedOut?: boolean;
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
      return {
        ok: false, error: error.message,
        ...(error.code === 'ALREADY_IMPORTED' ? { duplicate: true } : {}),
        ...(error instanceof AlreadyImportedError ? { previousRunId: error.previousRunId } : {})
      };
    }
    if (error instanceof NotAuthenticatedError) return { ok: false, error: SIGNED_OUT, signedOut: true };
    return { ok: false, error: 'Could not reach the API.' };
  }
}

/** The outcome of previewing or committing an import. */
export interface RunResult {
  ok: boolean;
  error?: string;
  /** True when the session has ended. */
  signedOut?: boolean;
  summary?: ImportSummary;
}

/**
 * Builds the mapping from the columns the file was read with and runs it: a dry run for the check, or a commit to write
 * the contacts. The mapping is assembled here rather than trusted from the client. Every column that is not the name, a
 * number or the email is kept on each person as it is (at most 200).
 */
export async function runSheet(
  id: string,
  cols: {
    /** Every column that holds a phone number, in the order to try them. At least one. */
    phones: string[];
    name: string | null;
    /** A first-name and a last-name column to join into the name, instead of one name column. */
    nameParts: { first: string; last: string } | null;
    /** Used to match people who are already in your contacts. */
    email: string | null;
    /** The country for numbers without a country code, as a two-letter code. */
    country: string;
    /** Every other column of the file. */
    keep: string[];
  },
  dryRun: boolean,
  tagName?: string
): Promise<RunResult> {
  if (cols.phones.length === 0) return { ok: false, error: 'This file has no column with mobile numbers.' };
  // The tag is how these people are found later, so the real import is refused without one, whatever called it.
  const missingTag = dryRun ? null : tagProblem(tagName ?? '');
  if (missingTag !== null) return { ok: false, error: missingTag };
  const identities: unknown[] = cols.phones.map((from) => ({ kind: 'phone', from, transform: ['trim'] }));
  if (cols.email !== null) identities.push({ kind: 'email', from: cols.email, transform: ['trim', 'lower'] });
  const mapping = {
    version: 1,
    displayName: cols.nameParts === null && cols.name !== null ? { from: cols.name, transform: ['trim'] } : undefined,
    nameParts: cols.nameParts ?? undefined,
    identities,
    defaultCountry: /^[A-Za-z]{2}$/.test(cols.country) ? cols.country.toUpperCase() : 'IN',
    unmapped: 'keep',
    fields: cols.keep.slice(0, 200).map((from) => ({ from }))
  };
  try {
    const summary = await runImportMapping(id, mapping, dryRun, tagName?.trim() || undefined);
    if (!dryRun) revalidatePath('/inbox');
    return { ok: true, summary };
  } catch (error) {
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    if (error instanceof NotAuthenticatedError) return { ok: false, error: SIGNED_OUT, signedOut: true };
    return { ok: false, error: 'Could not reach the API.' };
  }
}

/** What looking through the sheet answers: the data, or a plain reason it could not. */
export type SheetReply<T> = { ok: true; data: T } | { ok: false; error: string; signedOut?: boolean };

/** Runs a sheet read and turns a failure into a sentence. */
async function sheetRead<T>(read: () => Promise<T>): Promise<SheetReply<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return { ok: false, error: SIGNED_OUT, signedOut: true };
    if (error instanceof CrmApiError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the API.' };
  }
}

/** The first people's numbers as they will be saved, for the "how the file was read" card. */
export async function numberExamples(id: string, columns: string[], country: string): Promise<SheetReply<Awaited<ReturnType<typeof getNumberExamples>>>> {
  return sheetRead(() => getNumberExamples(id, columns, country));
}

/** One page of the sheet that was uploaded, for the table on the check screen. */
export async function sheetRows(id: string, filter: SheetFilter, offset: number, limit: number): Promise<SheetReply<SheetPage>> {
  return sheetRead(() => getSheetPage(id, filter, offset, limit));
}

/** Everyone the filter keeps, as a CSV to download. */
export async function sheetCsv(id: string, filter: SheetFilter): Promise<SheetReply<{ count: number; csv: string }>> {
  return sheetRead(() => getSheetCsv(id, filter));
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
