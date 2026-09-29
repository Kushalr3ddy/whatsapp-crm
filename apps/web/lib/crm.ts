import { cookies } from 'next/headers';

/**
 * The server-side client for the CRM HTTP API.
 *
 * Every function runs on the server only — in a server component or a server action.
 *
 * **It holds no credential of its own.** Each request forwards the signed-in person's session
 * cookie through to the API, so the API authenticates *them*, not "the web app". That is what
 * makes roles mean anything: an agent reaches exactly what an agent may reach, because the
 * same check runs whether the request came from a browser or from curl. A shared org-wide key
 * here would have given every signed-in user full access regardless of their role.
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
  /** Who owns this thread. Null when nobody has taken it — the "unassigned" queue. */
  assigneeUserId: string | null;
  /** The assignee's display name, resolved by the API so the list needn't join. */
  assigneeName: string | null;
}

/** One member of the org, as the assignee picker needs them. Mirrors `GET /api/v1/users`. */
export interface OrgUser {
  id: string;
  displayName: string;
  role: string;
}

/** The signed-in principal. Mirrors `GET /api/v1/auth/me`. */
export interface Me {
  kind: 'session' | 'api_key' | 'bootstrap';
  orgId: string;
  /** Null for an API key, which is not a person. Present for a signed-in user. */
  userId: string | null;
  role: string | null;
  scopes: string[];
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
  /**
   * The attachment, when one is stored. `url` is the API path; the browser downloads through
   * the web-side proxy at `/media/:id`, so the UI uses `id`, not this. Null for a text message
   * or a media message whose bytes were never fetched (see `mediaUnavailable`).
   */
  media: {
    id: string;
    url: string;
    contentType: string | null;
    sizeBytes: number | null;
    filename: string | null;
  } | null;
  /** True for a media message whose file could not be fetched — the attachment existed, the bytes did not. */
  mediaUnavailable: boolean;
}

/** One internal note on a thread. Mirrors `GET /api/v1/conversations/:id/notes`. */
export interface Note {
  id: string;
  body: string;
  /** User ids @-referenced in the body. Stored for future notifications; not acted on yet. */
  mentions: string[];
  authorUserId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** One saved reply. Mirrors `GET /api/v1/canned-replies`. */
export interface CannedReply {
  id: string;
  shortcut: string;
  /** May contain `{{name}}` placeholders, substituted from the contact when inserted. */
  body: string;
  locale: string;
  updatedAt: string;
}

/**
 * The health scorer's evidence, stored on `sender_identity.health` (docs/08-antiban.md). Empty
 * (`{}`) until the number has been scored at least once, so every field is optional.
 */
export interface SenderHealth {
  score?: number;
  band?: 'low' | 'medium' | 'high' | 'critical';
  deliveryRatio?: number;
  sentRecent?: number;
  deliveredRecent?: number;
  failedRecent?: number;
  computedAt?: string;
}

/** A WhatsApp number, linked or not. Mirrors `GET /api/v1/senders`. */
export interface Sender {
  id: string;
  label: string | null;
  provider: string;
  /** The number itself. Null until a link completes — WhatsApp reports it, we do not set it. */
  phoneE164: string | null;
  /**
   * The *business* status the health scorer drives: `active` (healthy), `degraded` (elevated
   * risk, throttled), `quarantined` (sends held), or `linking`. Says nothing on its own about
   * whether the socket is up — that is `connectionState`.
   */
  status: string;
  /** 0–100 risk score from the health scorer; the band lives in `health`. */
  riskScore: number;
  /** The scorer's evidence behind `riskScore` and `status`. */
  health: SenderHealth;
  /** Contacts on this number who have replied — a real two-way relationship. */
  knownContacts: number;
  /** Contacts we have messaged who have never replied — the outbound-only, riskier shape. */
  contactedContacts: number;
  /**
   * The live socket state: `open`, `connecting`, `closed`, or null when the number has never
   * been linked at all. This — not `status` — decides whether a message can actually go out.
   */
  connectionState: 'open' | 'connecting' | 'closed' | null;
  disconnectReason: string | null;
  lastConnectedAt: string | null;
  /**
   * Whether credentials are stored — the truth of "is this number linked", independent of the
   * live socket. Drives the Unlink button (nothing to unlink when false) and sorts an unlinked
   * number that was connected before into the "previously linked" group.
   */
  linked: boolean;
}

/** One way to reach a contact — a phone or email. */
export interface ContactIdentity {
  kind: string;
  value: string;
}

/** A contact and its ways-to-reach. Mirrors `GET /api/v1/contacts`. */
export interface Contact {
  id: string;
  displayName: string | null;
  source: string | null;
  /** Un-messageable gate — shown so an operator does not try to include them in a send. */
  doNotContact: boolean;
  createdAt: string;
  identities: ContactIdentity[];
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
/** Raised when the API rejects the forwarded session. The UI turns this into a redirect. */
export class NotAuthenticatedError extends Error {
  /** No detail on purpose: the caller only needs to know to send the person to /login. */
  constructor() {
    super('not authenticated');
    this.name = 'NotAuthenticatedError';
  }
}

/** Where the API lives. */
function baseUrl(): string {
  return process.env.CRM_API_URL ?? 'http://localhost:3000';
}

/**
 * Builds the headers that carry the caller's identity to the API.
 *
 * Forwards both cookies verbatim. The CSRF cookie has to travel as a header too, because the
 * API requires cookie-authenticated writes to echo it — the double-submit check. Reading it
 * here is legitimate: this code runs on the server, inside the person's own request.
 */
async function forwardedAuth(): Promise<Record<string, string>> {
  const jar = await cookies();
  const session = jar.get('crm_session')?.value ?? '';
  const csrf = jar.get('crm_csrf')?.value ?? '';

  if (session === '') throw new NotAuthenticatedError();

  return {
    Cookie: `crm_session=${session}; crm_csrf=${csrf}`,
    'x-csrf-token': csrf
  };
}

/**
 * Performs one authenticated request against the API and unwraps its `data` envelope.
 *
 * `cache: 'no-store'` because an inbox is live data — Next would otherwise cache the fetch
 * for the lifetime of the build and show a thread frozen at deploy time.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await forwardedAuth();
  const response = await fetch(`${baseUrl()}/api/v1${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...init?.headers
    }
  });

  // A rejected session is not an ordinary API error — the person has to sign in again, and
  // every caller wants the same response to it.
  if (response.status === 401) throw new NotAuthenticatedError();

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

/** Fetches one conversation by id — how a thread opens regardless of how far down the list it is. */
export async function getConversation(id: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${encodeURIComponent(id)}`);
}

/** Lists the org's members, so the inbox can offer an assignee. */
export async function listUsers(): Promise<OrgUser[]> {
  return request<OrgUser[]>('/users');
}

/** Reads the signed-in principal, so the UI can tell which threads are "mine". */
export async function getMe(): Promise<Me> {
  return request<Me>('/auth/me');
}

/**
 * Lists / searches contacts, newest first. `q` is a case-insensitive substring matched against
 * the display name and any identity (phone/email). Returns the first page; paging is a follow-up.
 */
export async function listContacts(q?: string): Promise<Contact[]> {
  const query = q !== undefined && q.trim() !== '' ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<Contact[]>(`/contacts${query}`);
}

/**
 * Changes a conversation's status or assignee.
 *
 * `assigneeUserId: null` unassigns; omitting a field leaves it untouched. Returns the updated
 * row so a caller can reflect the change without a second fetch.
 */
export async function updateConversation(
  id: string, patch: { status?: 'open' | 'closed'; assigneeUserId?: string | null }
): Promise<{ id: string; status: string; assigneeUserId: string | null }> {
  return request<{ id: string; status: string; assigneeUserId: string | null }>(
    `/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
}

/** Returns one thread, oldest message first. */
export async function listMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
}

/** Lists the org's WhatsApp numbers, so the UI can explain when none is linked. */
export async function listSenders(): Promise<Sender[]> {
  return request<Sender[]>('/senders');
}

/** Lists a thread's internal notes, oldest first. */
export async function listNotes(conversationId: string): Promise<Note[]> {
  return request<Note[]>(`/conversations/${encodeURIComponent(conversationId)}/notes`);
}

/** Adds an internal note to a thread. Never sent to the contact. */
export async function addNote(conversationId: string, body: string): Promise<Note> {
  return request<Note>(`/conversations/${encodeURIComponent(conversationId)}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}

/** Lists the org's saved replies for the composer's picker. */
export async function listCannedReplies(): Promise<CannedReply[]> {
  return request<CannedReply[]>('/canned-replies');
}

/** What an upload reports back: the headers and a sample, so a mapping is built from fact. */
export interface ImportUpload {
  id: string;
  sha256: string;
  rowCount: number;
  headers: string[];
  sample: Array<Record<string, string>>;
  /** The run this deliberately re-imported (via ?force), or null. */
  reimportOf: string | null;
}

/** The outcome of a dry run or a commit. */
export interface ImportSummary {
  read: number;
  created: number;
  errors: number;
  dryRun: boolean;
}

/**
 * Uploads a CSV or .xlsx file for import. Sends the raw bytes (not JSON), forwarding the session,
 * with a content type the API's raw parser accepts — the handler tells CSV from Excel by the
 * bytes regardless.
 */
export async function uploadImport(
  bytes: ArrayBuffer, filename: string, contentType: string
): Promise<ImportUpload> {
  const auth = await forwardedAuth();
  const response = await fetch(
    `${baseUrl()}/api/v1/imports?filename=${encodeURIComponent(filename)}`,
    { method: 'POST', cache: 'no-store', headers: { 'Content-Type': contentType, ...auth },
      body: new Uint8Array(bytes) }
  );
  if (response.status === 401) throw new NotAuthenticatedError();
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = payload as Partial<ApiProblem> | null;
    throw new CrmApiError({
      code: problem?.code ?? 'UNKNOWN',
      detail: problem?.detail ?? `The API returned ${String(response.status)}.`,
      status: response.status
    });
  }
  return (payload as { data: ImportUpload }).data;
}

/** Runs a mapping over an uploaded file — a dry run to preview, or a commit to write contacts. */
export async function runImportMapping(
  id: string, mapping: unknown, dryRun: boolean
): Promise<ImportSummary> {
  return request<ImportSummary>(`/imports/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({ mapping, dryRun })
  });
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

/**
 * Queues a reply into an existing thread.
 *
 * Addressed by conversation rather than by number, because not every contact has one: a
 * message from a WhatsApp privacy address arrives as a `wa_lid` identity with no phone at all.
 * The conversation already knows how to reach them.
 */
export async function queueReply(
  conversationId: string, body: string
): Promise<{ id: string; conversationId: string }> {
  return request<{ id: string; conversationId: string }>('/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId, body })
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

/**
 * Unlinks a number: the gateway logs it out and clears the stored credentials, so a fresh link
 * can issue a new QR. Returns once the request is recorded, not once the gateway has acted.
 */
export async function unlinkSender(senderId: string): Promise<{ senderId: string; status: string }> {
  return request<{ senderId: string; status: string }>(
    `/senders/${encodeURIComponent(senderId)}/unlink`, { method: 'POST' }
  );
}
