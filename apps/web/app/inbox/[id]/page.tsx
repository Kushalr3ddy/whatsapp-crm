import { listConversations, listMessages, CrmApiError } from '@/lib/crm';
import type { Message } from '@/lib/crm';
import { Composer } from './composer';

/** Formats a message timestamp. Full date, because a thread spans days. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
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
  return (
    <span className={failed || queued ? 'font-medium text-danger' : 'text-muted'}>
      {' · '}
      {queued ? '⚠ queued — not sent yet' : message.status}
      {message.errorCode !== null && ` (${message.errorCode})`}
    </span>
  );
}

/**
 * One thread: every message oldest first, with a composer underneath.
 *
 * The conversation's own details come from the list endpoint because there is no
 * `GET /conversations/:id` yet — which also means a thread outside the most recent 100
 * cannot be opened. Worth an endpoint of its own once that limit is reachable.
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let messages: Message[];
  let failure: string | null = null;
  try {
    messages = await listMessages(id);
  } catch (error) {
    messages = [];
    failure = error instanceof CrmApiError ? `${error.code}: ${error.message}` : 'Could not reach the API.';
  }

  const conversation = (await listConversations().catch(() => [])).find((c) => c.id === id);
  const title = conversation?.contactName ?? conversation?.contactPhone ?? 'Conversation';
  const senderLabel = conversation?.senderLabel ?? null;

  return (
    <>
      <header className="border-b border-border bg-surface px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {conversation?.contactPhone ?? 'No phone on file'}
          {senderLabel !== null && ` · via ${senderLabel}`}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {failure !== null && <p className="text-sm text-danger">{failure}</p>}

        {failure === null && messages.length === 0 && (
          <p className="text-sm text-muted">No messages in this conversation yet.</p>
        )}

        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={m.direction === 'outbound' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={[
                  'max-w-[min(34rem,80%)] rounded-2xl px-3.5 py-2',
                  m.direction === 'outbound'
                    ? 'bg-accent text-white'
                    : 'border border-border bg-surface'
                ].join(' ')}
              >
                <p className="text-sm whitespace-pre-wrap break-words">
                  {m.undecryptable
                    ? '[this message could not be decrypted]'
                    : m.body ?? `[${m.contentType}]`}
                </p>
                <p
                  className={[
                    'mt-1 text-[11px]',
                    m.direction === 'outbound' ? 'text-white/70' : 'text-muted'
                  ].join(' ')}
                >
                  {stamp(m.createdAt)}
                  <DeliveryState message={m} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Composer to={conversation?.contactPhone ?? null} />
    </>
  );
}
