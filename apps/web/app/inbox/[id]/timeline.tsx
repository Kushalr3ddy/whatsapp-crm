import type { Message, Note } from '@/lib/crm';
import { campaignStarts, dividerWhen } from '@/lib/inbox-format';
import { whatsappHtml } from '@/lib/new-campaign';
import { holdLabel } from '@/lib/hold-label';

/** The time of day inside a bubble, like WhatsApp ("12:44 pm"); the full date is the day heading above and the hover text. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
}

/** A full timestamp (date and time), for notes and for the hover text on a bubble. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${timeOf(iso)}`;
}

/** Human-readable file size, so a bubble can say "240 KB" rather than a raw byte count. */
function fileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A date heading each time the day changes, so a long chat reads in chapters. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}

/**
 * An attachment inside a bubble: a small picture that downloads the original, or a note that the file could not be fetched.
 *
 * The link points at the web-side proxy (`/media/:id`), never the API directly: the browser has no way to authenticate to the API itself.
 * The API serves every attachment as a download, so the original is a link, not shown inline, by design. Pictures also get a small
 * re-encoded preview from `/media/:id/thumb`, which is bytes the API wrote, not the sender's.
 */
function Attachment({ message }: { message: Message }) {
  if (message.media !== null) {
    const { id, filename, contentType, sizeBytes } = message.media;
    const meta = [contentType, fileSize(sizeBytes)].filter((s) => s !== null && s !== '').join(' · ');
    const hasPreview = contentType !== null && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType);
    return (
      <>
        {hasPreview && (
          <a href={`/media/${id}`} aria-label={`Download ${filename ?? 'picture'}`}>
            {/* A re-encoded preview made by the API; the original still only downloads. */}
            <img className="ib-mi" src={`/media/${id}/thumb`} alt={filename ?? 'Picture'} loading="lazy" />
          </a>
        )}
        {!hasPreview && (
          <a className="ib-file" href={`/media/${id}`}>
            <span aria-hidden>↓</span>
            <span><b style={{ fontWeight: 500 }}>{filename ?? 'attachment'}</b>{meta !== '' && <><br />{meta}</>}</span>
          </a>
        )}
      </>
    );
  }
  if (message.mediaUnavailable) {
    return (
      <p className="ib-small">
        {message.contentType} · the file could not be fetched.
        {(message.mediaError ?? '') !== '' && ` ${message.mediaError ?? ''} It was tried three times. Ask them to send it again.`}
      </p>
    );
  }
  return null;
}

/**
 * The delivery state of an outbound message, in words rather than ticks. Spelled out deliberately: this is the screen the send path is
 * verified on, and "delivered" is unambiguous in a way that two grey ticks is not.
 */
function DeliveryState({ message }: { message: Message }) {
  if (message.direction === 'inbound') return null;
  const failed = message.status === 'failed';
  // 'queued' is the one status people misread as done: the API accepted the message and nothing has left yet.
  const queued = message.status === 'queued';
  // "sent" with no delivery after a while means the message is stuck, so say how long. A message typed on the owner's phone may never
  // report delivery to the CRM, so it is never flagged as stuck.
  const stuckHours = message.status === 'sent' && message.sentAt !== null && message.sentBy !== 'phone'
    ? (Date.now() - new Date(message.sentAt).getTime()) / 3_600_000 : 0;
  const stuck = stuckHours >= 0.5;
  // "delivered" only means WhatsApp's servers handed it to their device. A phone that could not decrypt it still shows "Waiting for this
  // message" and asks us to send it again; say so until the message has been read.
  const unreadable = !failed && !queued && message.status !== 'read' && message.retryRequests > 0;
  const bad = failed || queued || stuck || unreadable;
  return (
    <span className={bad ? 'ib-bad' : undefined}>
      {queued ? `Waiting: ${holdLabel(message.holdReason)}`
        : unreadable ? `${message.status}, but their phone could not read it yet (it asked for it again ${String(message.retryRequests)} ${message.retryRequests === 1 ? 'time' : 'times'})`
        : stuck ? `Sent, no delivery for ${stuckHours >= 1 ? `${String(Math.floor(stuckHours))} h` : `${String(Math.round(stuckHours * 60))} min`}`
        : message.status.charAt(0).toUpperCase() + message.status.slice(1)}
      {message.errorCode !== null && ` (${message.errorCode})`}
    </span>
  );
}

/** Who sent an outbound message, in words: the person's name, "Campaign" for a bulk send, "API" for an integration. */
function authorLabel(message: Message): string | null {
  if (message.direction !== 'outbound') return null;
  if (message.sentBy === 'phone') return 'You, from your phone';
  if (message.sentByName !== null) return message.sentByName;
  return message.sentBy === 'system' ? 'Campaign' : 'API';
}

/** A message that would not read as text: an attachment with no words, or one that could not be decrypted. */
function Body({ message }: { message: Message }) {
  if (message.undecryptable) return <p>This message could not be read.</p>;
  if (message.body !== null && message.body !== '') return <div dangerouslySetInnerHTML={{ __html: whatsappHtml(message.body) }} />;
  return message.media === null ? <p className="ib-small">No text.</p> : null;
}

/** What the timeline is made of. */
type Entry =
  | { kind: 'message'; item: Message; at: string }
  | { kind: 'note'; item: Note; at: string };

/**
 * One chat's messages and internal notes on a shared timeline, oldest first: a day heading when the day changes, and a divider where a
 * campaign started in this chat (its first message to them).
 */
export function Timeline({ messages, notes, senderLabel }: { messages: Message[]; notes: Note[]; senderLabel: string | null }) {
  const entries: Entry[] = [
    ...messages.map((m): Entry => ({ kind: 'message', item: m, at: m.createdAt })),
    ...notes.map((n): Entry => ({ kind: 'note', item: n, at: n.createdAt }))
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const starts = campaignStarts(messages.map((m) => ({ id: m.id, direction: m.direction, campaignId: m.campaignId ?? null, createdAt: m.createdAt })));

  if (entries.length === 0) return <p className="ib-empty-note">No messages in this chat yet.</p>;

  return (
    <>
      {entries.map((entry, i) => {
        const showDay = i === 0 || dayOf(entries[i - 1]!.at) !== dayOf(entry.at);
        const day = showDay ? <span className="ib-day">{dayOf(entry.at)}</span> : null;
        if (entry.kind === 'note') {
          const n = entry.item;
          return (
            <div key={`n-${n.id}`} style={{ display: 'contents' }}>
              {day}
              <div className="ib-note">
                <small>Internal note{n.authorName !== null ? ` · ${n.authorName}` : ''} · {stamp(n.createdAt)} · only your team sees this</small>
                <div dangerouslySetInnerHTML={{ __html: whatsappHtml(n.body) }} />
              </div>
            </div>
          );
        }
        const m = entry.item;
        const out = m.direction === 'outbound';
        const author = authorLabel(m);
        return (
          <div key={`m-${m.id}`} style={{ display: 'contents' }}>
            {day}
            {starts.has(m.id) && m.campaignName !== undefined && m.campaignName !== null && (
              <div className="ib-divc"><span><b>{m.campaignName}</b> started · {dividerWhen(m.createdAt)}{senderLabel !== null ? ` · from ${senderLabel}` : ''}</span></div>
            )}
            <div className={`ib-m ${out ? 'ib-out' : 'ib-in2'}`}>
              <Attachment message={m} />
              <Body message={m} />
              <small>
                {author !== null && <span className="ib-by">{author}</span>}
                <span title={stamp(m.createdAt)}>{timeOf(m.createdAt)}</span>
                {out && <DeliveryState message={m} />}
              </small>
            </div>
          </div>
        );
      })}
    </>
  );
}
