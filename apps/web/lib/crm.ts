/**
 * The server-side client for the CRM HTTP API.
 *
 * Every function here runs on the server only — in a server component or a server action —
 * because each one sends the API key. Importing this from a `'use client'` component would
 * put the key in the browser bundle, so it is never re-exported through one.
 */

/** One conversation as the inbox list needs it. Mirrors `GET /api/v1/conversations`. */
export interface Conversation {
  id: string;
  status: string;
  unreadCount: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  contactId: string;
  contactName: string | null;
  /** The contact's primary phone in E.164. Null when they have no phone identity. */
  contactPhone: string | null;
  senderLabel: string | null;
  messageCount: number;
  /** Outbound messages accepted but not yet sent — nothing has left for these yet. */
  queuedCount: number;
}

/** One message in a thread. Mirrors `GET /api/v1/conversations/:id/messages`. */
export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  contentType: string;
  status: string;
  errorCode: string | null;
  /** Decrypted by the API for display. Null when there is no body, or it could not be read. */
  body: string | null;
  /** True when the ciphertext would not decrypt — usually a changed encryption key. */
  undecryptable: boolean;
  sentBy: string;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

/** A WhatsApp number, linked or not. Mirrors `GET /api/v1/senders`. */
export interface Sender {
  id: string;
  label: string | null;
  provider: string;
  /** The number itself. Null until a link completes — WhatsApp reports it, we do not set it. */
  phoneE164: string | null;
  /** The *business* status (`active`, `disabled`). Says nothing about whether it can send. */
  status: string;
  riskScore: number;
  /**
   * The live socket state: `open`, `connecting`, `closed`, or null when the number has never
   * been linked at all. This — not `status` — decides whether a message can actually go out.
   */
  connectionState: 'open' | 'connecting' | 'closed' | null;
  disconnectReason: string | null;
  lastConnectedAt: string | null;
}

/** What the API returns when a request fails: RFC 7807, plus our stable `code`. */
export interface ApiProblem {
  code: string;
  detail: string;
  status: number;
}

/** Thrown when the API answers with a non-2xx status, carrying the machine-readable code. */
export class CrmApiError extends Error {
  readonly code: string;
  readonly status: number;

  /** Keeps `code` and `status` alongside the message so callers can branch without parsing. */
  constructor(problem: ApiProblem) {
    super(problem.detail);
    this.name = 'CrmApiError';
    this.code = problem.code;
    this.status = problem.status;
  }
}

/**
 * Reads the API location and key from the environment on every call.
 *
 * Deliberately not hoisted to module scope: a missing key would then throw at import time,
 * which in Next surfaces as an unrelated build error rather than a readable message.
 */
function apiConfig(): { baseUrl: string; key: string } {
  const key = process.env.API_KEY;
  if (key === undefined || key === '') {
    throw new Error('API_KEY is not set. The UI reads the same .env as the API — see .env.example.');
  }
  return { baseUrl: process.env.CRM_API_URL ?? 'http://localhost:3000', key };
}

/**
 * Performs one authenticated request against the API and unwraps its `data` envelope.
 *
 * `cache: 'no-store'` because an inbox is live data — Next would otherwise cache the fetch
 * for the lifetime of the build and show a thread frozen at deploy time.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, key } = apiConfig();
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init?.headers
    }
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem = payload as Partial<ApiProblem> | null;
    throw new CrmApiError({
      code: problem?.code ?? 'UNKNOWN',
      detail: problem?.detail ?? `The API returned ${String(response.status)}.`,
      status: response.status
    });
  }

  return (payload as { data: T }).data;
}

/** Lists conversations, most recently active first. */
export async function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>('/conversations');
}

/** Returns one thread, oldest message first. */
export async function listMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
}

/** Lists the org's WhatsApp numbers, so the UI can explain when none is linked. */
export async function listSenders(): Promise<Sender[]> {
  return request<Sender[]>('/senders');
}

/**
 * Queues an outbound message. Returns once the API has accepted it, not once it is sent —
 * the gateway owns actual delivery, so the thread has to be polled for status.
 */
export async function queueMessage(to: string, body: string): Promise<{ id: string; conversationId: string }> {
  return request<{ id: string; conversationId: string }>('/messages', {
    method: 'POST',
    body: JSON.stringify({ to, body })
  });
}

/** The challenge a person acts on to link a number: a QR to scan, or a code to type. */
export type LinkChallenge =
  | { mode: 'qr'; qr: string; expiresAt: string }
  | { mode: 'pairing_code'; code: string; expiresAt: string };

/** The state of a linking attempt. Mirrors `GET /api/v1/senders/:id/link`. */
export interface LinkState {
  /** `pending` means the gateway has not produced a challenge yet — usually it is not running. */
  state: 'pending' | 'challenge_ready';
  challenge: LinkChallenge | null;
  expiresAt: string | null;
  connectionState: 'open' | 'connecting' | 'closed' | null;
  senderStatus: string;
}

/** How the person links: scan a QR, or type a code into the phone. */
export type LinkMode = 'qr' | 'pairing_code';

/**
 * Asks the gateway to begin linking a number.
 *
 * Returns as soon as the request is recorded, not when a challenge exists — the socket lives in
 * the gateway process, so the QR or code arrives asynchronously and has to be polled for.
 *
 * `pairing_code` needs the number being linked, because WhatsApp sends the code to that phone.
 * It is the mode that matters for numbers nobody here is holding — a recruiter's, say.
 */
export async function startLink(
  senderId: string, mode: LinkMode = 'qr', phoneE164?: string
): Promise<{ sessionId: string }> {
  return request<{ sessionId: string }>(`/senders/${encodeURIComponent(senderId)}/link`, {
    method: 'POST',
    body: JSON.stringify(phoneE164 === undefined ? { mode } : { mode, phoneE164 })
  });
}

/** Reads the current state of a linking attempt. */
export async function getLinkState(senderId: string): Promise<LinkState> {
  return request<LinkState>(`/senders/${encodeURIComponent(senderId)}/link`);
}
