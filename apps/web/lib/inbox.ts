import { request, requestWithMeta } from './crm';

/**
 * The server-side reads behind the Inbox screen (`GET /inbox`, `/inbox/filters`, `/conversations/:id/person`). Like `crm.ts` it runs on
 * the server only and forwards the signed-in person's own session.
 */

/** The five quick views under the search. */
export type InboxView = 'all' | 'needs' | 'unread' | 'ai' | 'you';
/** Which chats by state. */
export type InboxStatus = 'open' | 'closed' | 'any';
/** Which chats by owner (the screen offers these three). */
export type InboxOwner = 'all' | 'me' | 'unassigned';

/** What the list is narrowed by. */
export interface InboxQuery {
  q: string;
  view: InboxView;
  status: InboxStatus;
  owner: InboxOwner;
  campaigns: string[];
  files: string[];
  limit: number;
  offset: number;
}

/** One chat in the list. Mirrors a row of `GET /api/v1/inbox`. */
export interface InboxRow {
  id: string;
  status: string;
  unreadCount: number;
  lastAt: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  isAi: boolean;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  doNotContact: boolean;
  senderLabel: string | null;
  needsYou: boolean;
  lastMessage: { text: string | null; kind: string; direction: string; at: string } | null;
}

/** How many chats each quick view holds right now. */
export interface InboxCounts { all: number; needs: number; unread: number; ai: number; you: number }

/** A page of the list, with what the chips and the empty states need. */
export interface InboxPage {
  rows: InboxRow[];
  /** How many chats the chosen quick view holds (all pages). */
  total: number;
  counts: InboxCounts;
  /** How many chats the organisation has at all: zero means "no chats yet" rather than "nothing matches". */
  orgTotal: number;
}

/** The campaigns and files chats came from, for the Filters panel. */
export interface InboxFilterChoices {
  campaigns: Array<{ id: string; name: string; chats: number }>;
  files: Array<{ id: string; name: string; chats: number }>;
}

/** The person behind a chat. Mirrors `GET /api/v1/conversations/:id/person`. */
export interface ChatPerson {
  contactId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Everything a reply can fill in for this person: only what they have a value for. */
  fillIns: Array<{ key: string; label: string; value: string }>;
  /** Columns that exist but this person has no value for. */
  blankKeys: string[];
  files: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string; startedAt: string; replied: boolean }>;
}

/** Reads one page of the list. */
export async function getInbox(query: InboxQuery): Promise<InboxPage> {
  const params = new URLSearchParams({
    status: query.status, owner: query.owner, view: query.view,
    limit: String(query.limit), offset: String(query.offset)
  });
  if (query.q.trim() !== '') params.set('q', query.q.trim());
  if (query.campaigns.length > 0) params.set('campaigns', query.campaigns.join(','));
  if (query.files.length > 0) params.set('files', query.files.join(','));
  const { data, meta } = await requestWithMeta<InboxRow[], { total: number; counts: InboxCounts; orgTotal: number }>(`/inbox?${params.toString()}`);
  return { rows: data, total: meta.total, counts: meta.counts, orgTotal: meta.orgTotal };
}

/** The campaigns and imported files to choose from in Filters. */
export async function getInboxFilterChoices(): Promise<InboxFilterChoices> {
  return request<InboxFilterChoices>('/inbox/filters');
}

/** The person behind a chat: their details, fill-ins, files and campaigns. */
export async function getChatPerson(conversationId: string): Promise<ChatPerson> {
  return request<ChatPerson>(`/conversations/${encodeURIComponent(conversationId)}/person`);
}
