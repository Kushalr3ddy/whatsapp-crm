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
  /** Flagged do-not-contact: replies are blocked unless an admin overrides, with a reason. */
  doNotContact: boolean;
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
  /** The other people on the thread beside its owner, by name. Empty when it is just the owner. */
  participants: Array<{ userId: string; name: string }>;
  /** Other people with this thread open right now (seen in the last 30 s), never the caller. */
  viewers: Viewer[];
}

/** Someone with a thread open; `typing` is true while they are drafting a reply (D-54). */
export interface Viewer {
  userId: string;
  name: string;
  typing: boolean;
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
  /** For a still-queued outbound message: why the gateway is holding it (`sender_not_connected`…). */
  holdReason: string | null;
  /** Decrypted by the API for display. Null when there is no body, or it could not be read. */
  body: string | null;
  /** True when the ciphertext would not decrypt — usually a changed encryption key. */
  undecryptable: boolean;
  sentBy: string;
  /** The agent who sent it, when a signed-in person did. Null for an inbound, a campaign or an API key. */
  sentByName: string | null;
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

/** Why a link attempt failed, in plain words. Mirrors `link_error` as the API decodes it. */
export interface LinkError {
  code: string;
  title: string;
  summary: string;
  hint: string;
  statusCode?: number | null;
  at?: string;
}

/** A WhatsApp number, linked or not. Mirrors `GET /api/v1/senders`. */
export interface Sender {
  /** The most recent link failure, or null. Cleared when the number connects. */
  linkError?: LinkError | null;
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
  /** The silent-restriction verdict: `ok`, `suspected` (WhatsApp may be limiting it) or `likely`. */
  restrictionState: 'ok' | 'suspected' | 'likely';
  restrictionSince: string | null;
  /** `enforce` (the default) or `advisory` (D-29): the anti-ban holds are recorded, not obeyed. */
  enforcement: 'enforce' | 'advisory';
  advisoryReason: string | null;
  /** How many sends went out past a hold the engine would have enforced, and the latest one. */
  advisoryBypassCount: number;
  advisoryLastBypass: string | null;
  /**
   * Layer 6 recovery state, or null when the number is not recovering. `paused` = cooling off and
   * sending nothing until `resumesAt`; `ramping` = sending at `capFraction` of its cap, climbing
   * back weekly. Distinct from `status` — a number can be `active` yet paused by a recent incident.
   */
  recovery: {
    incident: 'timelock_463' | 'rate_429' | 'soft_ban';
    phase: 'paused' | 'ramping';
    capFraction: number;
    resumesAt: string | null;
  } | null;
}

/** One way to reach a contact — a phone or email. */
export interface ContactIdentity {
  kind: string;
  value: string;
}

/** A flat label on contacts. `contactCount` is present when listing tags, absent on a contact. */
export interface Tag {
  id: string;
  name: string;
  colour: string | null;
  contactCount?: number;
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
  /** The tags this contact carries. */
  tags: Tag[];
  /** Values for the org's defined custom fields, keyed by field key. */
  customFields: Record<string, string | number>;
}

/** A custom field an org has defined. Mirrors `GET /api/v1/custom-fields`. */
export interface CustomField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options: string[];
}

/** One campaign as the list needs it. Mirrors a row of `GET /api/v1/campaigns`. */
export interface Campaign {
  id: string;
  name: string;
  /** `draft` · `running` · `paused` · `completed` · `cancelled`. */
  status: string;
  startedAt: string | null;
  createdAt: string;
}

/** How many recipients sit in each state. Mirrors the `progress` on `GET /api/v1/campaigns/:id`. */
export interface CampaignProgress {
  total: number;
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** The engine's estimate of how long a campaign has left. Mirrors `forecast` on the detail route. */
export interface CampaignForecast {
  remaining: number;
  allowanceToday: number;
  /** Whole days before the last message goes out. 0 means it finishes today. */
  daysToFinish: number;
  /** True while the sender is still ramping up (warmup), which is why the daily allowance is low. */
  inWarmup: boolean;
}

/** One campaign in full, with its live progress and forecast. Mirrors `GET /api/v1/campaigns/:id`. */
export interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  body: string;
  senderIdentityId: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  progress: CampaignProgress;
  forecast: CampaignForecast;
  /** Recipient-experience gates an admin lifted for this campaign, and why. */
  gateOverrides: string[];
  gateOverrideReason: string | null;
  /** Set when the system, not a person, paused it (`restriction_likely` or `ban_suspected`). */
  pauseReason: string | null;
}

/** The prospective audience of a draft — a dry run's counts. Mirrors the `preview` route. */
export interface CampaignPreview {
  status: string;
  audience: {
    /** Everyone the audience rule matches right now. */
    total: number;
    /** Of those, how many have a number — the ones that would actually be messaged. */
    reachable: number;
    /** The rest: no number, so they would be recorded as skipped, never dropped. */
    unreachable: number;
  };
  forecast: CampaignForecast;
}

/** One recipient's outcome. Mirrors a row of `GET /api/v1/campaigns/:id/recipients`. */
export interface CampaignRecipient {
  id: string;
  /** `pending` · `queued` · `sent` · `failed` · `skipped`. */
  status: string;
  /** Why a `skipped`/`failed` recipient was not reached (`dnc`, `cancelled`, unreachable, …). */
  skipReason: string | null;
  attemptedAt: string | null;
  displayName: string | null;
  /** The underlying message's own delivery state (`sent`/`delivered`/`read`/`failed`), if any. */
  messageStatus: string | null;
  /** The contact's primary phone or email, for identifying them in the list. */
  identity: string | null;
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

/**
 * Like `request`, but for endpoints that answer `204 No Content` (attach/detach, delete). It
 * shares the auth and error handling but never tries to unwrap a `data` body there is none of.
 */
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const auth = await forwardedAuth();
  const response = await fetch(`${baseUrl()}/api/v1${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...auth, ...init?.headers }
  });
  if (response.status === 401) throw new NotAuthenticatedError();
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as Partial<ApiProblem> | null;
    throw new CrmApiError({
      code: problem?.code ?? 'UNKNOWN',
      detail: problem?.detail ?? `The API returned ${String(response.status)}.`,
      status: response.status
    });
  }
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
export async function listContacts(opts: { q?: string; tag?: string } = {}): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (opts.q !== undefined && opts.q.trim() !== '') params.set('q', opts.q.trim());
  if (opts.tag !== undefined && opts.tag !== '') params.set('tag', opts.tag);
  const qs = params.toString();
  return request<Contact[]>(`/contacts${qs === '' ? '' : `?${qs}`}`);
}

/** How many contacts match a search / tag filter (all of them with no filter). */
export async function countContacts(opts: { q?: string; tag?: string } = {}): Promise<number> {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.tag) p.set('tag', opts.tag);
  const qs = p.toString();
  return (await request<{ total: number }>(`/contacts/count${qs === '' ? '' : `?${qs}`}`)).total;
}

/** Lists the org's tags with contact counts — for the filter bar and the tag picker. */
export async function listTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags');
}

/** The allowlisted filter a dynamic segment stores (docs/21-deferred.md D-28). All fields optional. */
export interface SegmentDefinition {
  tagIds?: string[];
  replied?: 'ever' | 'never';
  lastContactedWithinDays?: number;
}

/** A saved criteria-based audience with its live match count. Mirrors a row of `GET /segments`. */
export interface Segment {
  id: string;
  name: string;
  definition: SegmentDefinition;
  createdAt: string;
  /** How many contacts the filter matches right now (dynamic — recomputed each read). */
  contactCount: number;
}

/** One committed import run, as a campaign audience option. Mirrors a row of `GET /imports`. */
export interface ImportRun {
  id: string;
  filename: string | null;
  status: string;
  createdAt: string;
  /** Distinct people the run created or updated — the size of the audience it would become. */
  contactCount: number;
}

/** Lists committed, non-superseded import runs — the ones a campaign can target. */
export async function listImportRuns(): Promise<ImportRun[]> {
  return request<ImportRun[]>('/imports');
}

/** Lists the org's dynamic segments, each with a live match count. */
export async function listSegments(): Promise<Segment[]> {
  return request<Segment[]>('/segments');
}

/** Counts how many contacts a filter matches right now — for the builder, before saving. */
export async function previewSegmentCount(definition: SegmentDefinition): Promise<number> {
  const r = await request<{ count: number }>('/segments/preview', {
    method: 'POST', body: JSON.stringify({ definition })
  });
  return r.count;
}

/** Creates a segment. Throws `CrmApiError` (`SEGMENT_EXISTS`) if the name is taken. */
export async function createSegment(
  name: string, definition: SegmentDefinition, saved = true
): Promise<{ id: string; name: string }> {
  return request<{ id: string; name: string }>('/segments', {
    method: 'POST', body: JSON.stringify({ name, definition, saved })
  });
}

/** Deletes a segment. A campaign that targeted it keeps its frozen recipients. */
export async function deleteSegment(id: string): Promise<void> {
  return requestVoid(`/segments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Creates a tag. Throws `CrmApiError` (code `TAG_EXISTS`) if the name is already taken. */
export async function createTag(name: string, colour?: string): Promise<Tag> {
  return request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, colour }) });
}

/** The org's defined custom fields. */
export async function listCustomFields(): Promise<CustomField[]> {
  return request<CustomField[]>('/custom-fields');
}

/** Defines a custom field (admin only). */
export async function createCustomField(field: CustomField): Promise<CustomField> {
  return request<CustomField>('/custom-fields', { method: 'POST', body: JSON.stringify(field) });
}

/** Removes a field definition and its value on every contact (admin only). */
export async function deleteCustomField(key: string): Promise<void> {
  return requestVoid(`/custom-fields/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/** Sets (or, with an empty value, clears) custom field values on one contact. */
export async function setContactFields(contactId: string, values: Record<string, string>): Promise<void> {
  return requestVoid(`/contacts/${encodeURIComponent(contactId)}/custom-fields`, {
    method: 'PUT', body: JSON.stringify({ values })
  });
}

/** Deletes a tag, and its links to every contact. */
export async function deleteTag(id: string): Promise<void> {
  return requestVoid(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Attaches a tag to a contact. Idempotent. */
export async function attachTag(contactId: string, tagId: string): Promise<void> {
  return requestVoid(`/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'POST', body: JSON.stringify({ tagId })
  });
}

/** Removes a tag from a contact. */
export async function detachTag(contactId: string, tagId: string): Promise<void> {
  return requestVoid(
    `/contacts/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tagId)}`,
    { method: 'DELETE' }
  );
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

/** Tells the server this thread is open in my browser (`present`) or has been closed. */
export async function sendPresence(conversationId: string, present: boolean): Promise<void> {
  await requestVoid(`/conversations/${encodeURIComponent(conversationId)}/presence`,
    { method: present ? 'POST' : 'DELETE' });
}

/** Adds a participant to a thread (admin only). */
export async function addParticipant(conversationId: string, userId: string): Promise<void> {
  await request<{ conversationId: string; userId: string }>(
    `/conversations/${encodeURIComponent(conversationId)}/participants`,
    { method: 'POST', body: JSON.stringify({ userId }) }
  );
}

/** Removes a participant from a thread (admin only). */
export async function removeParticipant(conversationId: string, userId: string): Promise<void> {
  await requestVoid(
    `/conversations/${encodeURIComponent(conversationId)}/participants/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
}

/** Returns one thread, oldest message first. */
export async function listMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
}

/** Whether the number behind a thread can send right now. Mirrors `GET /conversations/:id/sender-status`. */
export interface SenderStatus {
  label: string;
  connectionState: string | null;
  status: string;
  /** Whether delivery from this number looks restricted (`ok` | `suspected` | `likely`). */
  restrictionState: 'ok' | 'suspected' | 'likely';
  canSend: boolean;
  /** `not_connected`, `quarantined`, or null when it can send. */
  reason: string | null;
}

/** The thread's sender status, polled by the composer. */
export async function getSenderStatus(conversationId: string): Promise<SenderStatus> {
  return request<SenderStatus>(`/conversations/${encodeURIComponent(conversationId)}/sender-status`);
}

/** One entry on a number's health timeline. Mirrors `GET /senders/:id/health-events`. */
export interface HealthEvent {
  id: string;
  at: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
}

/** The recent health timeline for one number, newest first. */
export async function listHealthEvents(senderId: string): Promise<HealthEvent[]> {
  return request<HealthEvent[]>(`/senders/${encodeURIComponent(senderId)}/health-events`);
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
  updated: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  /** People tagged by this run, when a tag was asked for on a commit. */
  tagged?: number;
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
  id: string, mapping: unknown, dryRun: boolean, tagName?: string
): Promise<ImportSummary> {
  return request<ImportSummary>(`/imports/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({ mapping, dryRun, ...(tagName ? { tag: { name: tagName } } : {}) })
  });
}

/** What a bulk tag action would do or did. Mirrors `POST /tags/:id/bulk`. */
export interface BulkTagResult {
  action: 'add' | 'remove';
  dryRun: boolean;
  matched: number;
  changed: number;
}

/** Who a bulk tag action applies to. */
export type BulkTarget =
  | { kind: 'all' }
  | { kind: 'search'; q?: string; tagId?: string }
  | { kind: 'ids'; ids: string[] };

/** Previews (default) or applies adding/removing one tag across many contacts. */
export async function bulkTagContacts(
  tagId: string,
  body: { action: 'add' | 'remove'; target: BulkTarget; dryRun: boolean; expectedCount?: number }
): Promise<BulkTagResult> {
  return request<BulkTagResult>(`/tags/${encodeURIComponent(tagId)}/bulk`, {
    method: 'POST', body: JSON.stringify(body)
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
  conversationId: string, body: string, override?: { reason: string }, acknowledgeCollision?: boolean
): Promise<{ id: string; conversationId: string }> {
  return request<{ id: string; conversationId: string }>('/messages', {
    method: 'POST',
    body: JSON.stringify({
      conversationId, body,
      ...(override ? { overrideDnc: true, overrideReason: override.reason } : {}),
      ...(acknowledgeCollision === true ? { acknowledgeCollision: true } : {})
    })
  });
}

/** Tells the server I am typing a reply in this thread right now. */
export async function sendTyping(conversationId: string): Promise<void> {
  await requestVoid(`/conversations/${encodeURIComponent(conversationId)}/typing`, { method: 'POST' });
}

/** Who else has this thread open, and who is typing. Polled by the thread header. */
export async function getViewers(conversationId: string): Promise<Viewer[]> {
  return request<Viewer[]>(`/conversations/${encodeURIComponent(conversationId)}/presence`);
}

/** Where a key rotation stands. Mirrors `GET /api/v1/encryption`. */
export interface EncryptionStatus {
  /** `idle` | `key_missing` | `reencrypting` | `paused` | `ready_to_retire`. */
  stage: 'idle' | 'key_missing' | 'reencrypting' | 'paused' | 'ready_to_retire';
  currentVersion: number;
  /** Older key versions this install still holds, to read data not yet moved. */
  retiredVersions: number[];
  /** Versions present in the data that the key ring cannot read: a dropped key. */
  missingVersions: number[];
  counts: { message: Record<string, number>; authState: Record<string, number> };
  total: number;
  onCurrent: number;
  onOld: number;
  paused: boolean;
  lastRunAt: string | null;
  reencryptedTotal: number;
  lastUnreadable: number;
}

/** The result of decrypting a random sample. Mirrors `POST /api/v1/encryption/verify`. */
export interface EncryptionVerify {
  checked: number;
  failed: number;
  onOldKey: number;
}

/** The key rotation wizard's status. Admin only. */
export async function getEncryptionStatus(): Promise<EncryptionStatus> {
  return request<EncryptionStatus>('/encryption');
}

/** Pauses or resumes the background re-encryption. Admin only. */
export async function setRotationPaused(paused: boolean): Promise<void> {
  await requestVoid(`/encryption/${paused ? 'pause' : 'resume'}`, { method: 'POST' });
}

/** Decrypts a random sample and reports what it found. Admin only. */
export async function verifyEncryption(): Promise<EncryptionVerify> {
  return request<EncryptionVerify>('/encryption/verify', { method: 'POST' });
}

/** Flags or clears do-not-contact on a contact. */
export async function setDoNotContact(contactId: string, value: boolean, reason?: string): Promise<void> {
  return requestVoid(`/contacts/${encodeURIComponent(contactId)}/do-not-contact`, {
    method: 'PUT', body: JSON.stringify({ value, ...(reason ? { reason } : {}) })
  });
}

/**
 * Sends a file into a thread. The raw bytes are the request body (not JSON or multipart), with the
 * filename and optional caption on the query string — the API decides what the file is from its
 * contents. Returns once the API has queued it, not once it is sent.
 */
export async function queueAttachment(
  conversationId: string, bytes: ArrayBuffer, filename: string, caption: string
): Promise<{ id: string }> {
  const auth = await forwardedAuth();
  const query = new URLSearchParams({ filename, ...(caption === '' ? {} : { caption }) });
  const response = await fetch(
    `${baseUrl()}/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments?${query.toString()}`,
    { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', ...auth }, body: new Uint8Array(bytes) }
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
  return (payload as { data: { id: string } }).data;
}

/** The challenge a person acts on to link a number: a QR to scan, or a code to type. */
export type LinkChallenge =
  | { mode: 'qr'; qr: string; expiresAt: string }
  | { mode: 'pairing_code'; code: string; expiresAt: string };

/** The state of a linking attempt. Mirrors `GET /api/v1/senders/:id/link`. */
export interface LinkState {
  /** `pending` means the gateway has not produced a challenge yet — usually it is not running. */
  state: 'pending' | 'challenge_ready' | 'error';
  /** Set when `state` is `error`: what failed and what to do about it. */
  error?: LinkError | null;
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

/** Lists the org's campaigns, newest first. */
export async function listCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>('/campaigns');
}

/** Fetches one campaign with its live progress and forecast. */
export async function getCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}`);
}

/**
 * A dry run: the audience a draft would freeze, and the forecast — computed without writing
 * anything, so an operator sees who and how long before pressing start.
 */
export async function previewCampaign(id: string): Promise<CampaignPreview> {
  return request<CampaignPreview>(`/campaigns/${encodeURIComponent(id)}/preview`);
}

/**
 * Lists a campaign's recipients — the per-recipient results. `status` narrows to one state and
 * `q` searches the contact's name or number. Returns the first page; keyset paging is a follow-up.
 */
export async function listCampaignRecipients(
  id: string, opts: { status?: string; q?: string } = {}
): Promise<CampaignRecipient[]> {
  const params = new URLSearchParams();
  if (opts.status !== undefined && opts.status !== '') params.set('status', opts.status);
  if (opts.q !== undefined && opts.q.trim() !== '') params.set('q', opts.q.trim());
  const qs = params.toString();
  return request<CampaignRecipient[]>(
    `/campaigns/${encodeURIComponent(id)}/recipients${qs === '' ? '' : `?${qs}`}`
  );
}

/** How a campaign's audience is chosen. Exactly one field is set — never "everyone" implicitly. */
export type CampaignTarget =
  | { fromTagId: string }
  | { fromImportRunId: string }
  | { explicitContactIds: string[] }
  | { fromSegmentId: string };

/**
 * Creates a draft campaign. Sends nothing and freezes no audience — a draft until started.
 * Throws `CrmApiError` (`NOT_FOUND`) if the sender or the tag does not belong to the org.
 */
export async function createCampaign(
  input: { name: string; body: string; senderIdentityId: string } & CampaignTarget
): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>('/campaigns', {
    method: 'POST', body: JSON.stringify(input)
  });
}

/**
 * Starts (or resumes) a campaign: freezes the audience on the first start and lets the gateway
 * begin. Resuming a paused campaign does not re-snapshot. The response carries the forecast.
 */
export async function startCampaign(
  id: string, override?: { overrideGates: string[]; reason: string }
): Promise<{ status: string }> {
  return request<{ status: string }>(`/campaigns/${encodeURIComponent(id)}/start`, {
    method: 'POST', ...(override ? { body: JSON.stringify(override) } : {})
  });
}

/** Admin only: switches a number between `enforce` and `advisory` (D-29). Advisory needs a reason. */
export async function setSenderEnforcement(
  senderId: string, mode: 'enforce' | 'advisory', reason?: string
): Promise<{ senderId: string; enforcement: string }> {
  return request<{ senderId: string; enforcement: string }>(
    `/senders/${encodeURIComponent(senderId)}/enforcement`,
    { method: 'POST', body: JSON.stringify({ mode, ...(reason ? { reason } : {}) }) }
  );
}

/** Pauses a running campaign. Instant — pending recipients are simply not dispatched. */
export async function pauseCampaign(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(
    `/campaigns/${encodeURIComponent(id)}/pause`, { method: 'POST' }
  );
}

/** Cancels a campaign for good. Pending recipients become `skipped`, never dropped. */
export async function cancelCampaign(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(
    `/campaigns/${encodeURIComponent(id)}/cancel`, { method: 'POST' }
  );
}
