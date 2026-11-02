import { cookies } from 'next/headers';
import { clientIpHeaders } from './client-ip';

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
  /** True for the AI assistant's own user, which a chat can be handed to. */
  isBot: boolean;
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
  /** How many times the recipient's phone asked for this message again because it could not decrypt it ("Waiting for this message"). */
  retryRequests: number;
  lastRetryAt: string | null;
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
  /** Why the file could not be fetched, when the gateway recorded a reason (D-30). */
  mediaError?: string | null;
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
  /** The lifecycle: `linking` or `active`. Says nothing on its own about whether the socket is up — that is `connectionState`. */
  status: string;
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
  /** When an import last touched this person (created or updated them); null if none has. */
  lastImportedAt: string | null;
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
  /** The tag this campaign was aimed at, when it was built from a tag. */
  fromTagId?: string | null;
  /** The first part of the message, the number it sends from, and how many people it reaches. */
  bodySnippet?: string;
  senderLabel?: string | null;
  senderPhone?: string | null;
  audienceSize?: number;
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

/** One campaign in full, with its live progress. Mirrors `GET /api/v1/campaigns/:id`. */
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
  /** Recipient-experience gates an admin lifted for this campaign, and why. */
  gateOverrides: string[];
  gateOverrideReason: string | null;
  /** Set when the system, not a person, paused it (`ban_suspected` or `unlinked`). */
  pauseReason: string | null;
  /** The picture or GIF sent with every message (the body is its caption), or null for a text-only campaign. */
  mediaAssetId: string | null;
  mediaFilename: string | null;
  mediaContentType: string | null;
  mediaSizeBytes: number | null;
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
    /** Reachable people another campaign messaged in the last 14 days (they would be skipped). */
    recentlyMessaged?: number;
    /** The campaign that most of them were messaged by. */
    recentCampaign?: string | null;
  };
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
  /** Why a queued message is still waiting (`sender_not_connected`, …), or null. */
  holdReason?: string | null;
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
    'x-csrf-token': csrf,
    ...(await clientIpHeaders())
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

/** What the contacts list can be narrowed and ordered by. */
export interface ContactView {
  q?: string;
  tag?: string;
  /** First and last day (`YYYY-MM-DD`, both included) of a date range, on `dateBy`. */
  from?: string;
  to?: string;
  dateBy?: 'added' | 'imported';
  sort?: 'added_desc' | 'added_asc' | 'name_asc' | 'imported_desc';
}

/** The query string for a view; empty values are left out so the address stays short. */
function viewParams(opts: ContactView, withSort: boolean): string {
  const p = new URLSearchParams();
  if (opts.q !== undefined && opts.q.trim() !== '') p.set('q', opts.q.trim());
  if (opts.tag) p.set('tag', opts.tag);
  if (opts.from) p.set('from', opts.from);
  if (opts.to) p.set('to', opts.to);
  if ((opts.from || opts.to) && opts.dateBy) p.set('dateBy', opts.dateBy);
  if (withSort && opts.sort && opts.sort !== 'added_desc') p.set('sort', opts.sort);
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

/**
 * Lists / searches contacts. `q` is a case-insensitive substring matched against the display name, custom
 * fields and any identity (phone/email); `from` / `to` limit by the day added or last imported. Newest added
 * first unless `sort` says otherwise. Returns the first page; paging is a follow-up.
 */
export async function listContacts(opts: ContactView = {}): Promise<Contact[]> {
  return request<Contact[]>(`/contacts${viewParams(opts, true)}`);
}

/** How many contacts match a search / tag / date filter (all of them with no filter). */
export async function countContacts(opts: ContactView = {}): Promise<number> {
  return (await request<{ total: number }>(`/contacts/count${viewParams(opts, false)}`)).total;
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
  canSend: boolean;
  /** `not_connected`, or null when it can send. */
  reason: string | null;
  /** The encryption session is broken right now: `contacts` (their messages cannot be read), `own` (the owner's phone or Web messages cannot), or null. */
  sessionTrouble?: 'contacts' | 'own' | null;
}

/** The thread's sender status, polled by the composer. */
export async function getSenderStatus(conversationId: string): Promise<SenderStatus> {
  return request<SenderStatus>(`/conversations/${encodeURIComponent(conversationId)}/sender-status`);
}

/** Why the AI assistant is stuck on a conversation. Mirrors `GET /api/v1/ai/conversations/:id/notice`. */
export interface AiNotice {
  code: 'held' | 'do_not_contact' | 'daily_cap' | 'model_error' | 'no_answer';
  reason: string;
  canOverride: boolean;
}

/** Whether the AI assistant is switched on, so screens can offer its helpers. */
export async function getAiStatus(): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>('/ai/status');
}

/** One request in the AI queue. Mirrors `GET /api/v1/ai/jobs`. */
export interface AiJob {
  id: string;
  kind: 'command' | 'draft';
  input: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  mine: boolean;
  /** 1 = next to run; only while queued. */
  position: number | null;
}

/** The AI queue as the signed-in person may see it. */
export async function listAiJobs(): Promise<AiJob[]> {
  return request<AiJob[]>('/ai/jobs');
}

/** Puts a request in the AI queue; it runs when its turn comes. */
export async function enqueueAiJob(kind: 'command' | 'draft', input: string): Promise<{ id: string }> {
  return request<{ id: string }>('/ai/jobs', { method: 'POST', body: JSON.stringify({ kind, input }) });
}

/** Cancels a request that is still waiting. */
export async function cancelAiJob(id: string): Promise<void> {
  await request<unknown>(`/ai/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

/** A template the AI wrote from a description, before it is saved. Mirrors `POST /api/v1/ai/templates/generate`. */
export interface GeneratedAiTemplate {
  name: string;
  instructions: string;
  audience: string;
  firstMessage: string;
  /** Short questions for facts the description did not give. */
  missing: string[];
}

/** A saved template. Mirrors a row of `GET /api/v1/ai/templates`. */
export interface AiTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
  audience: string;
  firstMessage: string;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

/** A provider the AI settings tab offers. */
export interface LlmProvider {
  id: string; label: string; driver: string; baseUrl: string | null; needsKey: boolean; keyHelp: string; recommended: string | null;
}

/** Which model the install uses now. The key is never included, only its last four characters (admins only). */
export interface LlmSettings {
  driver: string; model: string | null; baseUrl: string | null; keyLast4: string | null; timeoutMs: number;
  source: 'file' | 'environment'; provider: string | null; providers: LlmProvider[]; ready: boolean;
}

/** One model in the picker. */
export interface LlmModel { id: string; name?: string; contextLength?: number }

/** What a test of a model found. */
export interface LlmProbe {
  usable: boolean; toolCalling: boolean; model: string; milliseconds: number; problem: string | null; problemKind: 'key' | 'model' | 'rate_limit' | 'timeout' | 'unreachable' | 'response' | 'settings' | null; notes: string[];
}

/** What the AI settings form sends: the provider, an address for "other", the key (blank keeps the saved one) and the model. */
export interface LlmChoice { provider: string; baseUrl?: string; apiKey?: string; model?: string }

/** Which provider, model and key ending are in use, and the providers on offer. */
export async function getLlmSettings(): Promise<LlmSettings> {
  return request<LlmSettings>('/ai/llm');
}

/** Lists the models a provider and key offer. */
export async function listLlmModels(choice: LlmChoice): Promise<LlmModel[]> {
  return request<LlmModel[]>('/ai/llm/models', { method: 'POST', body: JSON.stringify(choice) });
}

/** Tests a model with two tiny real calls. Saves nothing. */
export async function testLlm(choice: LlmChoice): Promise<LlmProbe> {
  return request<LlmProbe>('/ai/llm/test', { method: 'POST', body: JSON.stringify(choice) });
}

/** Makes this the model the install uses from now on (tested first unless `anyway`). */
export async function saveLlm(choice: LlmChoice, anyway: boolean): Promise<LlmSettings> {
  return request<LlmSettings>('/ai/llm', { method: 'PUT', body: JSON.stringify({ ...choice, ...(anyway ? { anyway: true } : {}) }) });
}

/** Turns the AI model off and removes the key from the settings file. */
export async function removeLlm(): Promise<void> {
  await requestVoid('/ai/llm', { method: 'DELETE' });
}

/** The fixed rules the server adds in front of every set of instructions. */
export async function getAiAlwaysOnRules(): Promise<string[]> {
  return request<string[]>('/ai/always-on-rules');
}

/** Asks the AI to write a template from a plain-words description. Saves nothing. */
export async function generateAiTemplate(description: string, answers: string[] = []): Promise<GeneratedAiTemplate> {
  return request<GeneratedAiTemplate>('/ai/templates/generate', { method: 'POST', body: JSON.stringify({ description, answers }) });
}

/** The organisation's saved templates, most recently used first. */
export async function listAiTemplates(): Promise<AiTemplate[]> {
  return request<AiTemplate[]>('/ai/templates');
}

/** One saved template. */
export async function getAiTemplate(id: string): Promise<AiTemplate> {
  return request<AiTemplate>(`/ai/templates/${encodeURIComponent(id)}`);
}

/** Saves a template: replaces the one with `id`, or creates a new one. */
export async function saveAiTemplate(
  input: { id?: string; name: string; description: string; instructions: string; audience: string; firstMessage: string }
): Promise<AiTemplate> {
  return request<AiTemplate>('/ai/templates', { method: 'POST', body: JSON.stringify(input) });
}

/** Notes a template as used; with `setAsDefault` its instructions become what every chat follows by default. */
export async function useAiTemplate(id: string, setAsDefault: boolean): Promise<AiTemplate> {
  return request<AiTemplate>(`/ai/templates/${encodeURIComponent(id)}/use`, { method: 'POST', body: JSON.stringify({ setAsDefault }) });
}

/** Removes a saved template. */
export async function deleteAiTemplate(id: string): Promise<void> {
  await requestVoid(`/ai/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** What the assistant did about an instruction. Mirrors `POST /api/v1/ai/commands`. */
export interface AiCommandResult {
  message: string;
  actions: Array<{ tool: string; ok: boolean; detail: string; campaignId?: string }>;
}

/** The warning for a conversation the assistant owns, or null when nothing is wrong. */
export async function getAiNotice(conversationId: string): Promise<AiNotice | null> {
  return request<AiNotice | null>(`/ai/conversations/${encodeURIComponent(conversationId)}/notice`);
}

/** Asks the assistant to answer the contact's latest message now (after a chat was handed to it). */
export async function aiAnswerNow(conversationId: string): Promise<{ answering: boolean }> {
  return request<{ answering: boolean }>(`/ai/conversations/${encodeURIComponent(conversationId)}/answer-now`, { method: 'POST' });
}

/** An admin lets the assistant answer a do-not-contact contact's latest message, with a reason. */
export async function allowAiReply(conversationId: string, reason: string): Promise<{ outcome: string; reason?: string }> {
  return request<{ outcome: string; reason?: string }>(
    `/ai/conversations/${encodeURIComponent(conversationId)}/allow-reply`, { method: 'POST', body: JSON.stringify({ reason }) }
  );
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

/** Admin only: hides an unlinked number from the Numbers page (its conversations stay in the inbox). */
export async function removeSender(senderId: string): Promise<void> {
  return requestVoid(`/senders/${encodeURIComponent(senderId)}/remove`, { method: 'POST' });
}


/** A freshly generated encryption key, shown once. The current key is never included. */
export interface NewEncryptionKey { version: number; previousVersion: number; key: string }

/** Asks the server for a new key for the next version. Admin only. */
export async function generateEncryptionKey(): Promise<NewEncryptionKey> {
  return request<NewEncryptionKey>('/encryption/new-key', { method: 'POST' });
}

/** Creates a number record. It exists but is not connected until it has been linked. */
export async function createSender(label: string, phoneE164?: string): Promise<{ id: string }> {
  return request<{ id: string }>('/senders', {
    method: 'POST',
    body: JSON.stringify({ label, provider: 'baileys', ...(phoneE164 !== undefined && phoneE164 !== '' ? { phoneE164 } : {}) })
  });
}

/** One person on the team, as the Team page shows them. Mirrors `GET /api/v1/admin/users`. */
export interface TeamMember {
  userId: string;
  email: string;
  displayName: string;
  role: 'admin' | 'agent';
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  /** True for the org's AI assistant; it has no password and is managed in its own settings. */
  isBot: boolean;
}

/** The AI assistant's settings. Mirrors `GET /api/v1/ai/settings`. */
export interface AiSettings {
  enabled: boolean;
  instructions: string;
  dailyMessageCap: number;
  mayStartCampaigns: boolean;
  consentAcceptedAt: string | null;
  botUserId: string | null;
}

/** Reads the AI assistant's settings. Admin only. */
export async function getAiSettings(): Promise<AiSettings> {
  return request<AiSettings>('/ai/settings');
}

/** Changes the AI assistant's settings; `acceptConsent` is needed the first time it is switched on. */
export async function saveAiSettings(
  change: { enabled?: boolean; instructions?: string; dailyMessageCap?: number; mayStartCampaigns?: boolean; acceptConsent?: boolean }
): Promise<AiSettings> {
  return request<AiSettings>('/ai/settings', { method: 'PUT', body: JSON.stringify(change) });
}

/** Lists everyone in the org. Admin only. */
export async function listTeam(): Promise<TeamMember[]> {
  return request<TeamMember[]>('/admin/users');
}

/** Adds a person to the org with a password the admin has chosen. */
export async function addTeamMember(
  input: { email: string; displayName: string; role: 'admin' | 'agent'; password: string }
): Promise<{ userId: string }> {
  return request<{ userId: string }>('/admin/users', { method: 'POST', body: JSON.stringify(input) });
}

/** Changes a person's role, or disables or re-enables their account. */
export async function updateTeamMember(
  userId: string, change: { role?: 'admin' | 'agent'; status?: 'active' | 'disabled' }
): Promise<TeamMember> {
  return request<TeamMember>(`/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(change) });
}

/** Sets a new password for a person and ends their sessions. */
export async function resetTeamPassword(userId: string, password: string): Promise<{ sessionsRevoked: number }> {
  return request<{ sessionsRevoked: number }>(
    `/admin/users/${encodeURIComponent(userId)}/password`, { method: 'POST', body: JSON.stringify({ password }) }
  );
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
  /** Columns the server judged to be phone / email / name from their values; null when unsure. */
  suggestions?: { phone: string | null; email: string | null; name: string | null };
  /** What each column's sampled values look like (shares are 0 to 1). */
  columns?: Array<{ header: string; sampled: number; phoneShare: number; emailShare: number }>;
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
  /** Rows that imported but left something out, e.g. a second phone number that was not valid. */
  warnings?: number;
  dryRun: boolean;
  /** People tagged by this run, when a tag was asked for on a commit. */
  tagged?: number;
  /** The tag those people got, so a screen can link to them. */
  tagId?: string;
}

/**
 * Uploads a CSV or .xlsx file for import. Sends the raw bytes (not JSON), forwarding the session,
 * with a content type the API's raw parser accepts — the handler tells CSV from Excel by the
 * bytes regardless.
 */
export async function uploadImport(
  bytes: ArrayBuffer, filename: string, contentType: string, force = false
): Promise<ImportUpload> {
  const auth = await forwardedAuth();
  const response = await fetch(
    `${baseUrl()}/api/v1/imports?filename=${encodeURIComponent(filename)}${force ? '&force=true' : ''}`,
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
  | { kind: 'search'; q?: string; tagId?: string; from?: string; to?: string; dateBy?: 'added' | 'imported' }
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
export async function listCampaigns(tagId?: string): Promise<Campaign[]> {
  return request<Campaign[]>(tagId === undefined ? '/campaigns' : `/campaigns?tagId=${encodeURIComponent(tagId)}`);
}

/** Fetches one campaign with its live progress. */
export async function getCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}`);
}

/**
 * A dry run: the audience a draft would freeze, computed without writing
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

/** A picture or GIF stored for campaigns. Mirrors `GET /api/v1/campaigns/media`. */
export interface CampaignPicture {
  id: string;
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  gif: boolean;
  createdAt: string;
  /** How many campaigns use it. */
  uses: number;
}

/** The organisation's campaign pictures, newest first. */
export async function listCampaignPictures(): Promise<CampaignPicture[]> {
  return request<CampaignPicture[]>('/campaigns/media');
}

/** Uploads one picture or GIF for campaigns (raw bytes). Throws `CrmApiError` with the reason when it is refused. */
export async function uploadCampaignPicture(bytes: ArrayBuffer, filename: string): Promise<CampaignPicture> {
  const auth = await forwardedAuth();
  const response = await fetch(`${baseUrl()}/api/v1/campaigns/media?${new URLSearchParams({ filename }).toString()}`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/octet-stream', ...auth }, body: new Uint8Array(bytes)
  });
  if (response.status === 401) throw new NotAuthenticatedError();
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = payload as Partial<ApiProblem> | null;
    throw new CrmApiError({ code: problem?.code ?? 'UNKNOWN', detail: problem?.detail ?? `The API returned ${String(response.status)}.`, status: response.status });
  }
  return (payload as { data: CampaignPicture }).data;
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
  input: { name: string; body: string; senderIdentityId: string; aiTemplateId?: string; mediaAssetId?: string } & CampaignTarget
): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>('/campaigns', {
    method: 'POST', body: JSON.stringify(input)
  });
}

/**
 * Starts (or resumes) a campaign: freezes the audience on the first start and lets the gateway
 * begin. Resuming a paused campaign does not re-snapshot.
 */
export async function startCampaign(
  id: string, override?: { overrideGates: string[]; reason: string }
): Promise<{ status: string }> {
  return request<{ status: string }>(`/campaigns/${encodeURIComponent(id)}/start`, {
    method: 'POST', ...(override ? { body: JSON.stringify(override) } : {})
  });
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

/** Rows of a run that could not be imported, and rows that imported with something left out. */
export interface ImportProblems {
  errors: Array<{ rowNumber: number; error: string; raw: Record<string, string> | null }>;
  warnings: Array<{ rowNumber: number; note: string; raw: Record<string, string> | null }>;
}

/** Fetches the problem rows of a run (after a preview or a commit) so the person can fix them. */
export async function getImportProblems(id: string): Promise<ImportProblems> {
  const run = await request<{
    errors?: ImportProblems['errors']; warnings?: ImportProblems['warnings'];
  }>(`/imports/${encodeURIComponent(id)}`);
  return { errors: run.errors ?? [], warnings: run.warnings ?? [] };
}
