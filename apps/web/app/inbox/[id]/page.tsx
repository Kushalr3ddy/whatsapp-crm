import Link from 'next/link';
import {
  getConversation, getSenderStatus, listMessages, listUsers, listNotes, listCannedReplies, getMe, CrmApiError
} from '@/lib/crm';
import type { SenderStatus, Message, OrgUser, Note, CannedReply, Me, Conversation } from '@/lib/crm';
import { Composer } from './composer';
import { initialsOf } from '../../ui';
import { ThreadControls } from './thread-controls';
import { PresenceBeat } from './presence-beat';
import { ViewersLine } from './viewers-line';

/** Plain words for why a queued message has not gone out yet. */
function holdLabel(reason: string | null): string {
  if (reason === null) return 'queued, not sent yet';
  if (reason === 'sender_not_connected') return 'the number isn’t connected';
  if (reason === 'quarantined') return 'the number is quarantined';
  if (reason === 'recipient_hours') return 'it’s night where they are';
  if (reason.startsWith('recovery_pause')) return 'the number is cooling off after an incident';
  if (reason.startsWith('paced:')) return 'pacing — spacing sends to protect the number';
  return reason;
}

/** Formats a message timestamp. Full date, because a thread spans days. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

/** Human-readable file size, so a bubble can say "240 KB" rather than a raw byte count. */
function fileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An attachment inside a bubble: a download link, or a note that the file could not be fetched.
 *
 * The link points at the web-side proxy (`/media/:id`), never the API directly — the browser
 * has no way to authenticate to the API itself. The API serves every attachment as a download
 * (`Content-Disposition: attachment`), so this is a link, not an inline preview, by design.
 */
function Attachment({ message }: { message: Message }) {
  if (message.media !== null) {
    const { id, filename, contentType, sizeBytes } = message.media;
    const meta = [contentType, fileSize(sizeBytes)].filter((s) => s !== null && s !== '').join(' · ');
    return (
      <a
        href={`/media/${id}`}
        className="mb-1 flex items-center gap-2 rounded-lg border border-current/20 px-2.5 py-1.5 text-xs hover:opacity-80"
      >
        <span aria-hidden>↓</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{filename ?? 'attachment'}</span>
          {meta !== '' && <span className="block opacity-70">{meta}</span>}
        </span>
      </a>
    );
  }
  if (message.mediaUnavailable) {
    return (
      <div className="mb-1">
        <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">
          {message.contentType} · attachment could not be fetched
        </p>
        {(message.mediaError ?? '') !== '' && (
          <p className="text-xs opacity-70">Reason: {message.mediaError} It was tried three times. Ask them to send it again.</p>
        )}
      </div>
    );
  }
  return null;
}

/**
 * The delivery state of an outbound message, in words rather than ticks.
 *
 * Spelled out deliberately: this is the screen the send path is verified on, and "delivered"
 * is unambiguous in a way that two grey ticks is not.
 */
function DeliveryState({ message }: { message: Message }) {
  if (message.direction === 'inbound') return null;
  const failed = message.status === 'failed';
  // 'queued' is the one status people misread as done. It means the API accepted the message
  // and nothing has left yet — so it is spelled out rather than shown as a bare word.
  const queued = message.status === 'queued';
  // "sent" with no delivery after a while is the silent-restriction symptom, so say how long.
  const stuckHours = message.status === 'sent' && message.sentAt !== null
    ? (Date.now() - new Date(message.sentAt).getTime()) / 3_600_000 : 0;
  const stuck = stuckHours >= 0.5;
  return (
    <span className={failed || queued || stuck ? 'font-medium text-danger' : 'text-muted'}>
      {' · '}
      {queued ? `⚠ waiting: ${holdLabel(message.holdReason)}`
        : stuck ? `sent · no delivery for ${stuckHours >= 1 ? `${String(Math.floor(stuckHours))}h` : `${String(Math.round(stuckHours * 60))}m`}`
        : message.status}
      {message.errorCode !== null && ` (${message.errorCode})`}
    </span>
  );
}

/** One entry on the thread timeline: a message or an internal note, tagged with when it happened. */
type TimelineEntry =
  | { kind: 'message'; item: Message; at: string }
  | { kind: 'note'; item: Note; at: string };

/**
 * Who sent an outbound message, in words: the agent's name, "Campaign" for a bulk send, or "API"
 * for an integration. Null for an inbound message, whose author is the contact in the header.
 */
function authorLabel(message: Message): string | null {
  if (message.direction !== 'outbound') return null;
  if (message.sentByName !== null) return message.sentByName;
  return message.sentBy === 'system' ? 'Campaign' : 'API';
}

/** One message bubble: attachment, body (or a decryption note), and the delivery state line. */
function MessageBubble({ message }: { message: Message }) {
  const author = authorLabel(message);
  return (
    <div
      className={[
        'max-w-[min(34rem,80%)] rounded-2xl px-3.5 py-2',
        message.direction === 'outbound' ? 'border border-accent/25 bg-accent-soft text-ink' : 'border border-border bg-surface'
      ].join(' ')}
    >
      {author !== null && <p className="mb-0.5 text-[11px] font-medium text-on-accent/70">{author}</p>}
      <Attachment message={message} />
      {message.undecryptable ? (
        <p className="text-sm">[this message could not be decrypted]</p>
      ) : message.body !== null && message.body !== '' ? (
        <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
      ) : (
        // Nothing to say only when there is also no attachment — an image with no caption is
        // complete on its own and needs no "no text content" note.
        message.media === null && <p className="text-sm opacity-60">no text content</p>
      )}
      <p
        className={[
          'mt-1 text-[11px]',
          message.direction === 'outbound' ? 'text-on-accent/70' : 'text-muted'
        ].join(' ')}
      >
        {stamp(message.createdAt)}
        <DeliveryState message={message} />
      </p>
    </div>
  );
}

/**
 * An internal note in the timeline: visually distinct and centred, so it reads as team-only
 * rather than as something the contact was sent. The "internal, not sent" line says so outright.
 */
function NoteBubble({ note }: { note: Note }) {
  return (
    <div className="max-w-[min(34rem,90%)] rounded-lg border border-accent/30 bg-accent-soft px-3 py-2">
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">
        Note{note.authorName !== null ? ` · ${note.authorName}` : ''}
      </p>
      <p className="text-sm whitespace-pre-wrap break-words text-ink">{note.body}</p>
      <p className="mt-1 text-[11px] text-muted">{stamp(note.createdAt)} · internal, not sent</p>
    </div>
  );
}

/**
 * One thread: messages and internal notes on a shared timeline, with a composer underneath.
 *
 * The conversation's own details come from `GET /conversations/:id`, so any thread opens
 * regardless of how far down the list it is — opening the thread also clears its unread badge,
 * which the messages fetch does server-side.
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let messages: Message[] = [];
  let notes: Note[] = [];
  let failure: string | null = null;
  try {
    [messages, notes] = await Promise.all([listMessages(id), listNotes(id)]);
  } catch (error) {
    failure = error instanceof CrmApiError ? `${error.code}: ${error.message}` : 'Could not reach the API.';
  }

  const [conversation, users, cannedReplies, me, senderStatus] = await Promise.all([
    getConversation(id).catch((): Conversation | null => null),
    listUsers().catch((): OrgUser[] => []),
    listCannedReplies().catch((): CannedReply[] => []),
    getMe().catch((): Me | null => null),
    getSenderStatus(id).catch((): SenderStatus | null => null)
  ]);

  // The thread lock, mirrored from the server guard in POST /messages: a thread owned by
  // another agent is read-only to me unless I am an admin or a participant on it. Kept identical
  // to the API so the composer never offers a send the server would refuse.
  const lockedByOther = conversation !== null
    && conversation.assigneeUserId !== null
    && conversation.assigneeUserId !== me?.userId
    && !conversation.participants.some((p) => p.userId === me?.userId)
    && me?.role !== 'admin';

  // Messages and notes share one timeline, sorted by when they happened, so a note sits in the
  // thread at the moment it was written rather than in a separate list divorced from context.
  const timeline: TimelineEntry[] = [
    ...messages.map((m): TimelineEntry => ({ kind: 'message', item: m, at: m.createdAt })),
    ...notes.map((n): TimelineEntry => ({ kind: 'note', item: n, at: n.createdAt }))
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const title = conversation?.contactName ?? conversation?.contactPhone ?? 'Conversation';
  const senderLabel = conversation?.senderLabel ?? null;

  // A date heading each time the day changes, so a long thread reads in chapters.
  const dayOf = (iso: string): string => new Date(iso).toLocaleDateString([], {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const connected = senderStatus?.canSend === true;
  const statusLabel = senderStatus === null ? null
    : connected ? 'Connected'
    : senderStatus.reason === 'quarantined' ? 'Quarantined' : 'Not connected';

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PresenceBeat conversationId={id} />
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="avatar size-10 text-sm" aria-hidden>{initialsOf(title)}</span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{title}</h2>
              <p className="truncate text-sm text-muted">
                {conversation?.contactPhone ?? 'Privacy address — no phone shared'}
                {senderLabel !== null && ` · via ${senderLabel}`}
                {statusLabel !== null && (
                  <span className={connected ? 'text-success' : 'font-medium text-danger'}>
                    {' · '}● {statusLabel.toLowerCase()}
                  </span>
                )}
              </p>
              {/* Others with this thread open now, and who is typing. Informational: the reply
                  lock, not this, decides who may send. */}
              {conversation !== null && (
                <ViewersLine conversationId={id} initial={conversation.viewers} />
              )}
            </div>
          </div>
          {/* Absent only if the fetch failed or the id is not in this org; otherwise every thread
              has its controls, however far down the list it is. */}
          {conversation !== null && (
            <ThreadControls
              conversationId={id}
              users={users}
              assigneeUserId={conversation.assigneeUserId}
              status={conversation.status}
              participants={conversation.participants}
              isAdmin={me?.role === 'admin'}
            />
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {failure !== null && <p className="notice notice-danger">{failure}</p>}

          {failure === null && timeline.length === 0 && (
            <p className="mt-10 text-center text-sm text-muted">No messages in this conversation yet.</p>
          )}

          <ol className="flex flex-col gap-3">
            {timeline.map((entry, i) => {
              const day = dayOf(entry.at);
              const showDay = i === 0 || dayOf(timeline[i - 1]!.at) !== day;
              return (
                <li key={`${entry.kind}-${entry.item.id}`} className="contents">
                  {showDay && (
                    <div className="my-1 flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-border" />
                      <span>{day}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  {entry.kind === 'note' ? (
                    <div className="flex justify-center"><NoteBubble note={entry.item} /></div>
                  ) : (
                    <div className={entry.item.direction === 'outbound' ? 'flex justify-end' : 'flex justify-start'}>
                      <MessageBubble message={entry.item} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <Composer
          conversationId={id}
          to={conversation?.contactPhone ?? null}
          cannedReplies={cannedReplies}
          contactName={conversation?.contactName ?? null}
          replyLocked={lockedByOther}
          lockedBy={lockedByOther ? conversation?.assigneeName ?? 'another agent' : null}
          initialStatus={senderStatus}
          doNotContact={conversation?.doNotContact ?? false}
          isAdmin={me?.role === 'admin'}
        />
      </div>

      {conversation !== null && (
        <aside className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-5 xl:flex">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="avatar size-16 text-xl" aria-hidden>{initialsOf(title)}</span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted">{conversation.contactPhone ?? 'No phone shared'}</p>
            </div>
            {conversation.doNotContact && <span className="badge badge-danger">do not contact</span>}
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Number</dt>
              <dd className="text-right font-medium">{senderLabel ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Assigned to</dt>
              <dd className="text-right font-medium">{conversation.assigneeName ?? 'Unassigned'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Status</dt>
              <dd className="text-right font-medium capitalize">{conversation.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Messages</dt>
              <dd className="text-right font-medium tabular-nums">{conversation.messageCount}</dd>
            </div>
            {conversation.lastInboundAt !== null && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Last reply</dt>
                <dd className="text-right font-medium">{stamp(conversation.lastInboundAt)}</dd>
              </div>
            )}
          </dl>

          {conversation.queuedCount > 0 && (
            <p className="notice notice-warning">
              {conversation.queuedCount} message{conversation.queuedCount === 1 ? ' is' : 's are'} waiting to be sent.
            </p>
          )}

          <Link
            href={`/contacts?q=${encodeURIComponent(conversation.contactPhone ?? title)}`}
            className="btn btn-sm w-full"
          >
            Open in Contacts
          </Link>
        </aside>
      )}
    </div>
  );
}
