import {
  getConversation, getSenderStatus, getAiNotice, listMessages, listUsers, listNotes, listCannedReplies, getMe, CrmApiError
} from '@/lib/crm';
import type { AiNotice, SenderStatus, Message, OrgUser, Note, CannedReply, Me, Conversation } from '@/lib/crm';
import { getChatPerson } from '@/lib/inbox';
import type { ChatPerson } from '@/lib/inbox';
import { PresenceBeat } from './presence-beat';
import { Timeline } from './timeline';
import { ThreadView } from './thread-view';

/**
 * One chat: its messages and internal notes on a shared timeline, with the reply box under them and the person in Details.
 *
 * The chat's own details come from `GET /conversations/:id`, so any chat opens regardless of how far down the list it is. Opening it also
 * clears its unread count, which the messages read does on the server.
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

  const [conversation, users, cannedReplies, me, senderStatus, aiNotice, person] = await Promise.all([
    getConversation(id).catch((): Conversation | null => null),
    listUsers().catch((): OrgUser[] => []),
    listCannedReplies().catch((): CannedReply[] => []),
    getMe().catch((): Me | null => null),
    getSenderStatus(id).catch((): SenderStatus | null => null),
    getAiNotice(id).catch((): AiNotice | null => null),
    getChatPerson(id).catch((): ChatPerson | null => null)
  ]);

  if (conversation === null) {
    return (
      <div className="ib-empty">
        <h2>Couldn&apos;t open this chat</h2>
        <p>{failure ?? 'It may have been removed, or you may not have access to it.'}</p>
      </div>
    );
  }

  // The reply lock, mirrored from the server guard in POST /messages: only the owner or an admin may send. A person on the chat can read it
  // but not reply. Kept identical to the API so the box never offers a send the server would refuse.
  const lockedByOther = conversation.assigneeUserId !== null
    && conversation.assigneeUserId !== me?.userId
    && me?.role !== 'admin';

  // Names the newest message or note, so the chat scrolls down when one arrives.
  const newest = [...messages.map((m) => ({ k: `m${m.id}`, at: m.createdAt })), ...notes.map((n) => ({ k: `n${n.id}`, at: n.createdAt }))]
    .sort((a, b) => (a.at < b.at ? -1 : 1)).at(-1)?.k ?? 'none';

  return (
    <>
      <PresenceBeat conversationId={id} />
      <ThreadView
        conversationId={id}
        title={conversation.contactName ?? conversation.contactPhone ?? 'Conversation'}
        phone={conversation.contactPhone}
        senderLabel={conversation.senderLabel}
        status={conversation.status}
        assigneeUserId={conversation.assigneeUserId}
        assigneeName={conversation.assigneeName}
        myUserId={me?.userId ?? null}
        isAdmin={me?.role === 'admin'}
        users={users}
        person={person}
        cannedReplies={cannedReplies}
        replyLocked={lockedByOther}
        lockedBy={lockedByOther ? conversation.assigneeName ?? 'another colleague' : null}
        senderStatus={senderStatus}
        doNotContact={conversation.doNotContact}
        aiNotice={aiNotice}
        participants={conversation.participants}
        viewers={conversation.viewers}
        lastKey={newest}
        timeline={failure !== null ? <p role="alert" className="ib-hint ib-bad">{failure}</p> : <Timeline messages={messages} notes={notes} senderLabel={conversation.senderLabel} />}
      />
    </>
  );
}
