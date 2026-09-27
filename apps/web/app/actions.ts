'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import {
  queueReply, startLink, getLinkState, unlinkSender, updateConversation, addNote, CrmApiError
} from '@/lib/crm';
import type { LinkMode } from '@/lib/crm';

/** What the composer gets back: either accepted, or a reason to show the person. */
export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Queues a reply into a thread, then refreshes it so the new message appears immediately.
 *
 * Runs on the server, which is what keeps the API key out of the browser. Errors are
 * returned rather than thrown: a rejected send is an ordinary outcome the composer should
 * display — an unreachable number, or no linked sender — not a crashed page.
 */
export async function sendReply(conversationId: string, body: string): Promise<SendResult> {
  const text = body.trim();
  if (text === '') return { ok: false, error: 'Nothing to send.' };

  try {
    await queueReply(conversationId, text);
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

/** What the link panel needs on each poll: a rendered QR, or a reason there is not one. */
export interface LinkStatus {
  state: 'pending' | 'challenge_ready' | 'connected' | 'error';
  /** The QR as an inline SVG data URL, ready for an `img` src. Null unless a QR is current. */
  qrDataUrl: string | null;
  pairingCode: string | null;
  expiresAt: string | null;
  detail: string | null;
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
