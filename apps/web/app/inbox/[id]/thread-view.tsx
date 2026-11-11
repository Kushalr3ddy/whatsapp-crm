'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { setParticipant, updateThread } from '@/app/actions';
import { handChatToAiAction, takeChatBackAction } from '@/app/ai/actions';
import { initials } from '@/lib/inbox-format';
import type { AiNotice, CannedReply, OrgUser, SenderStatus, Viewer } from '@/lib/crm';
import type { ChatPerson } from '@/lib/inbox';
import { INBOX_CHANGED } from '../inbox-shell';
import { setOwnerAction } from '../actions';
import { AiNoticeBanner } from './ai-notice';
import { DetailsPanel } from './details-panel';
import { ReplyBox } from './reply-box';
import { ViewersLine } from './viewers-line';

/** How often an open chat looks for new messages. */
const REFRESH_MS = 5000;

/** What the chat needs from the server page. The messages themselves arrive already drawn, as `timeline`. */
export interface ThreadViewProps {
  conversationId: string;
  title: string;
  phone: string | null;
  senderLabel: string | null;
  status: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  myUserId: string | null;
  isAdmin: boolean;
  users: OrgUser[];
  person: ChatPerson | null;
  cannedReplies: CannedReply[];
  replyLocked: boolean;
  lockedBy: string | null;
  senderStatus: SenderStatus | null;
  doNotContact: boolean;
  aiNotice: AiNotice | null;
  /** The other people on the chat beside its owner, and who has it open now. */
  participants: Array<{ userId: string; name: string }>;
  viewers: Viewer[];
  /** Changes when a message or note is added, so the chat scrolls to it. */
  lastKey: string;
  timeline: ReactNode;
}

/**
 * One chat: the header (the name and who is answering), the messages, the reply box, and the Details slide-over. Taking the chat over or
 * handing it back to the AI is one click and takes effect at once; the AI checks who owns the chat before it writes and again before it
 * sends.
 */
export function ThreadView(p: ThreadViewProps) {
  const router = useRouter();
  const [details, setDetails] = useState(false);
  const [busy, startBusy] = useTransition();
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const bot = p.users.find((u) => u.isBot) ?? null;
  const isAi = bot !== null && p.assigneeUserId === bot.id;
  const answering = isAi ? 'AI is answering'
    : p.assigneeUserId === null || p.assigneeUserId === p.myUserId ? 'You’re answering'
    : `${p.assigneeName ?? 'A colleague'} is answering`;
  const linked = p.senderStatus === null ? null : p.senderStatus.canSend;

  const say = useCallback((text: string, undo?: () => void): void => {
    clearTimeout(toastTimer.current);
    setToast(undo === undefined ? { text } : { text, undo });
    toastTimer.current = setTimeout(() => { setToast(null); }, 5000);
  }, []);

  // New messages arrive by looking again; the page underneath is read afresh, and what is typed in the box stays.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); };
  }, [router]);

  // A chat opens at its newest message; a new message scrolls into view only when the person was already at the bottom.
  const stuck = useRef(true);
  useEffect(() => { stuck.current = true; }, [p.conversationId]);
  useEffect(() => {
    const el = feed.current;
    const content = inner.current;
    if (el === null || content === null) return;
    const down = (): void => { if (stuck.current) el.scrollTop = el.scrollHeight; };
    down();
    // Pictures and the AI's card settle after the first paint and make the chat taller: keep following the bottom while the person is there.
    const watch = new ResizeObserver(down);
    watch.observe(content);
    return () => { watch.disconnect(); };
  }, [p.conversationId, p.lastKey]);

  useEffect(() => {
    if (!details) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setDetails(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [details]);
  useEffect(() => { setDetails(false); setProblem(null); }, [p.conversationId]);

  /** Runs one change to the chat, shows the reason when it was refused, and tells the list to look again. */
  function change(run: () => Promise<{ ok: boolean; error?: string }>, done: string, undo?: () => void): void {
    setProblem(null);
    startBusy(async () => {
      const r = await run();
      if (!r.ok) { setProblem(r.error ?? 'Could not do that.'); return; }
      say(done, undo);
      window.dispatchEvent(new Event(INBOX_CHANGED));
      router.refresh();
    });
  }

  /** Stops the AI at once and gives the chat to the signed-in person. */
  function takeOver(): void {
    if (p.myUserId === null) { setProblem('Sign in again to take this chat.'); return; }
    const me = p.myUserId;
    change(() => takeChatBackAction(p.conversationId, me), 'The AI has stopped. You’re answering this chat now.');
  }
  /** Gives the chat back to the AI assistant, which then answers the last message if it is still waiting. */
  function handBack(): void {
    if (bot === null) return;
    const id = bot.id;
    change(() => handChatToAiAction(p.conversationId, id), 'The AI is answering this chat again.');
  }
  /** Gives the chat to whoever the Details list picked: the AI, a person or nobody. */
  function chooseOwner(value: string): void {
    if (bot !== null && value === bot.id) { handBack(); return; }
    if (value === p.myUserId && isAi) { takeOver(); return; }
    const who = p.users.find((u) => u.id === value);
    change(() => setOwnerAction(p.conversationId, value === '' ? null : value),
      value === '' ? 'Nobody has this chat now.' : `${who?.displayName ?? 'They'} has this chat.`);
  }
  /** Resolve moves an open chat to Closed (and Undo moves it back); on a closed chat the button reopens it. */
  function toggleStatus(): void {
    const closing = p.status === 'open';
    change(() => updateThread(p.conversationId, { status: closing ? 'closed' : 'open' }),
      closing ? 'Resolved. Moved to Closed.' : 'Reopened.',
      closing ? () => { change(() => updateThread(p.conversationId, { status: 'open' }), 'Reopened.'); } : undefined);
    setDetails(false);
    if (closing && window.matchMedia('(max-width: 699px)').matches) router.push('/inbox');
  }

  return (
    <>
      <div className="ib-th-head">
        <Link className="ib-btn ib-g ib-sm ib-back" href="/inbox" aria-label="Back to the chat list"><ChevronLeft size={16} aria-hidden /> Inbox</Link>
        <span className="ib-av ib-lg" aria-hidden="true">{initials(p.title)}</span>
        <div className="ib-th-id">
          <b>{p.title}</b>
          <span className={`ib-st ${isAi ? 'ib-ok' : 'ib-rd'}`}><i />{answering}</span>
          <ViewersLine conversationId={p.conversationId} initial={p.viewers} />
        </div>
        <div className="ib-th-act">
          {!isAi && bot !== null && <button className="ib-btn ib-sm" type="button" disabled={busy} onClick={handBack}>Hand back to AI</button>}
          <button className="ib-btn ib-sm ib-g" type="button" aria-expanded={details} onClick={() => { setDetails(true); }}>Details</button>
        </div>
      </div>
      {problem !== null && <p role="alert" className="ib-hint ib-bad" style={{ margin: '8px 16px 0' }}>{problem}</p>}

      <div className="ib-msgs" ref={feed} tabIndex={0} aria-label="Messages"
        onScroll={(e) => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        <div className="ib-feed" ref={inner}>
          {p.timeline}
          {p.aiNotice !== null && (
            <AiNoticeBanner conversationId={p.conversationId} notice={p.aiNotice} isAdmin={p.isAdmin} aiOwned={isAi} onTakeOver={takeOver} takingOver={busy} />
          )}
        </div>
      </div>

      <ReplyBox
        key={p.conversationId}
        conversationId={p.conversationId} person={p.person} cannedReplies={p.cannedReplies}
        aiOwned={isAi} onTakeOver={takeOver} takingOver={busy}
        replyLocked={p.replyLocked} lockedBy={p.lockedBy} initialStatus={p.senderStatus}
        doNotContact={p.doNotContact} isAdmin={p.isAdmin} say={say} />

      <DetailsPanel
        open={details} onClose={() => { setDetails(false); }} title={p.title} phone={p.phone} senderLabel={p.senderLabel} linked={linked}
        person={p.person} users={p.users} assigneeUserId={p.assigneeUserId} isAi={isAi} status={p.status} busy={busy}
        participants={p.participants} isAdmin={p.isAdmin}
        onParticipant={(userId, present) => { change(() => setParticipant(p.conversationId, userId, present), present ? 'Added to this chat. They can read it, not reply.' : 'Taken off this chat.'); }}
        onOwner={chooseOwner} onStatus={toggleStatus} />

      {toast !== null && (
        <div className="ib-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo !== undefined && <button type="button" onClick={() => { const u = toast.undo; setToast(null); u?.(); }}>Undo</button>}
        </div>
      )}
    </>
  );
}
