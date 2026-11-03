'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { saveNote, senderStatusAction } from '@/app/actions';
import { FormatButtons, picturesFromPaste, useMessageBox } from '@/components/message-box';
import { checkFillIns, fillInText, previewHtml } from '@/lib/new-campaign';
import type { Column, PreviewPerson } from '@/lib/new-campaign';
import type { CannedReply, SenderStatus } from '@/lib/crm';
import type { ChatPerson } from '@/lib/inbox';
import { INBOX_CHANGED } from '../inbox-shell';
import { sendInboxReply } from '../actions';

/** How often the box re-checks that the number can send. */
const STATUS_POLL_MS = 8000;
/** At most one "I am typing" ping per this long while keys are being pressed. */
const TYPING_PING_MS = 3000;
/** The most pictures one reply carries, and the kinds the box takes. */
const MAX_IMAGES = 5;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** A pasted picture, with the address its thumbnail is shown from. */
interface Pasted { file: File; url: string }

/** What the box needs to know about the chat it replies in. */
export interface ReplyBoxProps {
  conversationId: string;
  /** Their details, for the Fill-in list and the preview. */
  person: ChatPerson | null;
  cannedReplies: CannedReply[];
  /** The AI has this chat: the box is blurred until someone takes over. */
  aiOwned: boolean;
  onTakeOver: () => void;
  takingOver: boolean;
  /** Another colleague has the chat and I may not reply (admins and people on the chat may). */
  replyLocked: boolean;
  lockedBy: string | null;
  initialStatus: SenderStatus | null;
  doNotContact: boolean;
  isAdmin: boolean;
  /** Said once a reply or note is saved, so the screen can confirm it. */
  say: (message: string) => void;
}

/**
 * The reply box: ONE box with its options inside it. Reply and Note share it, a note never leaves the team, and a reply is sent to the
 * person. B / I / S / mono, Fill-in (their own details) and Saved replies sit in the bottom edge with Send on the right. A picture can be
 * pasted into a reply (up to five), and a reply shows a preview line of what they will receive.
 *
 * The formatting, the fill-in menu and the preview are the New campaign message box's own helpers (`lib/new-campaign.ts`), so a message
 * reads the same in both places. Nothing is drawn into the chat until the API accepts it.
 */
export function ReplyBox(props: ReplyBoxProps) {
  const { conversationId, person, cannedReplies, aiOwned, replyLocked, lockedBy, doNotContact, isAdmin } = props;
  const [senderStatus, setSenderStatus] = useState<SenderStatus | null>(props.initialStatus);
  const numberDown = senderStatus !== null && !senderStatus.canSend;
  const dncBlocked = doNotContact && !isAdmin;
  const replyOff = replyLocked || numberDown || dncBlocked;

  const [tab, setTab] = useState<'reply' | 'note'>(replyOff ? 'note' : 'reply');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [pasted, setPasted] = useState<Pasted[]>([]);
  // The same list, readable before React has drawn again: two pastes in a row must both count toward the limit.
  const pastedNow = useRef<Pasted[]>([]);
  const [menu, setMenu] = useState<'fill' | 'saved' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collision, setCollision] = useState<string | null>(null);
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [pending, start] = useTransition();
  const lastPing = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => { void senderStatusAction(conversationId).then((next) => { if (next !== null) setSenderStatus(next); }); }, STATUS_POLL_MS);
    return () => { clearInterval(timer); };
  }, [conversationId]);
  // The number dropped while the box was open: move to a note so nothing typed is taken for a reply.
  useEffect(() => { if (replyOff) setTab('note'); }, [replyOff]);
  // Thumbnails hold memory until released: when the box goes away, and (in `setImages`) when one is taken out.
  useEffect(() => () => { pastedNow.current.forEach((p) => { URL.revokeObjectURL(p.url); }); }, []);

  const isNote = tab === 'note';
  const text = isNote ? note : reply;
  // The toolbar, Ctrl+B / Ctrl+I, the fill-in list and the cursor handling are the shared message box (`components/message-box.tsx`).
  const mb = useMessageBox(text, isNote ? setNote : setReply, (open) => { setMenu((m) => (open ? 'fill' : m === 'fill' ? null : m)); }, grow);

  // The person the reply is for: what each fill-in reads as, and which columns exist but are blank for them.
  const { columns, who } = useMemo(() => {
    const values: Record<string, string> = {};
    const named = person !== null && person.name !== null;
    const cols: Column[] = [
      { key: 'name', label: 'Name', type: 'text', have: named ? 1 : 0 },
      { key: 'first_name', label: 'First name', type: 'text', have: named ? 1 : 0 }
    ];
    for (const f of person?.fillIns ?? []) {
      values[f.key] = f.value;
      if (!cols.some((c) => c.key === f.key)) cols.push({ key: f.key, label: f.label, type: 'text', have: 1 });
    }
    for (const key of person?.blankKeys ?? []) if (!cols.some((c) => c.key === key)) cols.push({ key, label: key, type: 'text', have: 0 });
    const preview: PreviewPerson = { name: person?.name ?? null, values };
    return { columns: cols, who: preview };
  }, [person]);

  const check = useMemo(() => (isNote ? null : checkFillIns(reply, columns, 1)), [isNote, reply, columns]);
  const bad = check?.unknown[0];
  const first = (person?.name ?? 'this person').split(/\s+/)[0] ?? 'this person';
  const problem = bad === undefined ? null
    : bad.everyoneLacks ? `${first} has no value for {{${bad.key}}}. Take it out, or the reply can’t be sent.`
    : `There is no column called {{${bad.key}}}.${bad.suggestion !== null ? ` Did you mean {{${bad.suggestion}}}?` : ''}`;
  const previewBody = !isNote && reply.trim() !== '' ? previewHtml(reply, who, columns, 0, 'any', false) : '';

  /** Pings "typing" while a reply is drafted, at most once per interval. A plain fetch: server actions run one at a time. */
  function noteTyping(next: string): void {
    if (isNote || next.trim() === '') return;
    const now = Date.now();
    if (now - lastPing.current < TYPING_PING_MS) return;
    lastPing.current = now;
    void fetch(`/inbox/${encodeURIComponent(conversationId)}/live`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'typing' })
    }).catch(() => { /* best effort */ });
  }

  /** Lets the box grow with its text, up to its limit. */
  function grow(): void {
    const t = mb.ref.current;
    if (t === null) return;
    t.style.height = 'auto';
    t.style.height = `${String(Math.min(t.scrollHeight, 120))}px`;
  }
  /** Puts a saved reply at the cursor, to be edited if they like. */
  function addSaved(body: string): void {
    const t = mb.ref.current;
    const at = t?.selectionStart ?? text.length;
    const end = t?.selectionEnd ?? text.length;
    setMenu(null);
    mb.put(text.slice(0, at) + body + text.slice(end), at + body.length, at + body.length);
  }
  /** Reads typing in the box; for a reply a brace opens the Fill-in list (a note has no fill-ins). */
  function onChange(value: string, cursor: number): void {
    if (isNote) setNote(value); else { mb.onChange(value, cursor); noteTyping(value); }
    setCollision(null);
    grow();
  }

  /** Takes pictures pasted into the box. Text pastes are left alone. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    if (isNote) return;
    const got = picturesFromPaste(e, pastedNow.current.length, MAX_IMAGES, IMAGE_TYPES);
    if (!got.found) return;
    e.preventDefault();
    if (doNotContact) { setError('Pictures can’t be sent to someone marked do not contact.'); return; }
    setError(got.problem);
    setImages([...pastedNow.current, ...got.take.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  /** Replaces the list of pictures in the box. */
  function setImages(next: Pasted[]): void {
    pastedNow.current.filter((p) => !next.includes(p)).forEach((p) => { URL.revokeObjectURL(p.url); });
    pastedNow.current = next;
    setPasted(next);
  }

  const dncNeedsOverride = doNotContact && isAdmin && !(overrideOn && overrideReason.trim().length >= 10);
  const empty = text.trim() === '' && (isNote || pasted.length === 0);
  const blocked = !isNote && (replyOff || dncNeedsOverride || problem !== null);

  /** Sends the reply or adds the note. A refusal keeps what was typed. `anyway` is the second press after a collision warning. */
  function submit(anyway = false): void {
    if (empty || pending || blocked) return;
    setError(null); setCollision(null);
    start(async () => {
      if (isNote) {
        const r = await saveNote(conversationId, note);
        if (!r.ok) { setError(r.error ?? 'Could not add the note.'); return; }
        setNote(''); grow(); props.say('Note added. Only your team sees it.');
        window.dispatchEvent(new Event(INBOX_CHANGED));
        return;
      }
      const form = new FormData();
      form.set('text', fillInText(reply, who));
      for (const p of pasted) form.append('image', p.file);
      if (doNotContact) form.set('overrideReason', overrideReason.trim());
      if (anyway) form.set('acknowledge', '1');
      const r = await sendInboxReply(conversationId, form);
      if (r.ok) {
        setReply(''); setImages([]); grow();
        props.say(senderStatus !== null ? `Sent from ${senderStatus.label}.` : 'Sent.');
        window.dispatchEvent(new Event(INBOX_CHANGED));
      } else if (r.collision === true) setCollision(r.error ?? 'Someone else is on this chat. Send anyway?');
      else setError(r.error ?? 'Could not send it.');
    });
  }

  /** Enter sends a reply, Shift+Enter adds a line, Escape closes a list; Ctrl+B and Ctrl+I are the shared box's. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape') { setMenu(null); return; }
    if (e.key === 'Enter' && !e.shiftKey && !isNote) { e.preventDefault(); submit(); return; }
    mb.onKeyDown(e);
  }

  const placeholder = isNote ? 'Write a note for your team… Only they see it.' : `Message ${first}… You can paste a picture here too.`;
  const gated = aiOwned && !isNote;

  const editor = (
    <div className={`ib-cbox${isNote ? ' ib-isnote' : ''}`}>
      {menu === 'fill' && !isNote && (
        <div className="ib-menu ib-cmenu" role="menu">
          <div className="ib-mh">This person’s details</div>
          {(person?.fillIns ?? []).length === 0 && <div className="ib-mh">Nothing saved for them yet.</div>}
          {(person?.fillIns ?? []).map((f) => (
            <button key={f.key} type="button" role="menuitem" onClick={() => { mb.insert(f.key, mb.braceTyped); }}><b>{`{{${f.key}}}`}</b><span>{f.value}</span></button>
          ))}
        </div>
      )}
      {menu === 'saved' && !isNote && (
        <div className="ib-menu ib-cmenu" role="menu">
          <div className="ib-mh">Saved replies: ready-made messages your team wrote once. Click one to put it in the box, then edit it if you like.</div>
          {cannedReplies.length === 0 && <div className="ib-mh">No saved replies yet.</div>}
          {cannedReplies.map((c) => (
            <button key={c.id} type="button" role="menuitem" onClick={() => { addSaved(c.body); }}><b>{c.shortcut}</b><span>{c.body}</span></button>
          ))}
        </div>
      )}
      <textarea ref={mb.ref} rows={1} value={text} placeholder={placeholder} aria-label={placeholder} maxLength={4096} disabled={pending}
        onChange={(e) => { onChange(e.target.value, e.target.selectionStart); }} onKeyDown={onKeyDown} onPaste={onPaste} />
      {!isNote && pasted.length > 0 && (
        <div className="ib-imgs">
          {pasted.map((p, i) => (
            <span key={p.url} className="ib-th">
              <img src={p.url} alt={`Pasted picture ${String(i + 1)}`} />
              <button type="button" aria-label={`Remove picture ${String(i + 1)}`} onClick={() => { setImages(pastedNow.current.filter((_x, j) => j !== i)); }}><X size={14} aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      {previewBody !== '' && (
        <div className="ib-pvl"><span className="ib-cap">Preview</span><div className="ib-wb" dangerouslySetInnerHTML={{ __html: previewBody }} /></div>
      )}
      <div className="ib-cbar">
        <FormatButtons className="ib-fmt" onWrap={mb.wrap} />
        {!isNote && <button type="button" className="ib-chipbtn" aria-expanded={menu === 'fill'} onClick={() => { mb.setBraceTyped(false); setMenu(menu === 'fill' ? null : 'fill'); }}>{'{ }'} Fill-in</button>}
        {!isNote && <button type="button" className="ib-chipbtn" aria-expanded={menu === 'saved'} onClick={() => { setMenu(menu === 'saved' ? null : 'saved'); }}>Saved replies</button>}
        <span className="ib-sp" />
        <button className="ib-btn ib-p ib-sm" type="button" disabled={empty || pending || blocked} onClick={() => { submit(); }} title="Enter sends, Shift+Enter adds a line">
          {pending ? (isNote ? 'Saving…' : 'Sending…') : isNote ? 'Add note' : 'Send'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="ib-comp">
      <div className="ib-tabrow">
        <div className="ib-mini" role="group" aria-label="Reply or note">
          <button type="button" aria-pressed={!isNote} disabled={replyOff} onClick={() => { setTab('reply'); setMenu(null); }}>Reply</button>
          <button type="button" aria-pressed={isNote} onClick={() => { setTab('note'); setMenu(null); }}>Note</button>
        </div>
        {senderStatus !== null && (
          <span className="ib-small">Sending from {senderStatus.label} · <span className={`ib-st ${senderStatus.canSend ? 'ib-ok' : 'ib-bd'}`}><i />{senderStatus.canSend ? 'Linked' : 'Not linked'}</span></span>
        )}
      </div>

      {error !== null && <p role="alert" className="ib-err">{error}</p>}
      {collision !== null && (
        <div role="alert" className="ib-hint">
          <span>{collision}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ib-btn ib-sm" disabled={pending} onClick={() => { submit(true); }}>Send anyway</button>
            <button type="button" className="ib-btn ib-sm ib-g" onClick={() => { setCollision(null); }}>Wait</button>
          </span>
        </div>
      )}
      {doNotContact && (
        <div role="alert" className="ib-hint ib-bad">
          <span>
            This person is marked <b>do not contact</b>.
            {isAdmin ? ' As an admin you can message them anyway, knowingly. The reason goes in the audit log.' : ' Replies are blocked. Ask an admin if this needs to go out. You can still add a note.'}
          </span>
          {isAdmin && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={overrideOn} onChange={(e) => { setOverrideOn(e.target.checked); }} /> Message them anyway
              </label>
              {overrideOn && (
                <input className="ib-in" value={overrideReason} onChange={(e) => { setOverrideReason(e.target.value); }}
                  placeholder="Why? At least 10 characters" aria-label="Why you are overriding do not contact" />
              )}
            </span>
          )}
        </div>
      )}
      {!numberDown && senderStatus !== null && (senderStatus.sessionTrouble ?? null) !== null && (
        <p role="alert" className="ib-hint ib-bad">
          <span><b>The encryption session of {senderStatus.label} looks broken.</b>{' '}
            {senderStatus.sessionTrouble === 'own'
              ? 'Messages you type on your own phone or WhatsApp Web cannot be read by this number, so they will not appear here. '
              : 'Messages from people to this number could not be decrypted, and the people you write to may see “Waiting for this message”. '}
            Unlink the number and link it again on the Numbers page to fix it.</span>
        </p>
      )}
      {numberDown && (
        <div role="alert" className="ib-hint">
          <span><b>{senderStatus.label} isn’t linked, so replies can’t be sent.</b> Notes still work.</span>
          <Link className="ib-btn ib-sm" href="/link">Open Linked numbers</Link>
        </div>
      )}
      {replyLocked && (
        <div className="ib-hint"><span><b>{lockedBy ?? 'Another colleague'}</b> has this chat, and only the owner or an admin can reply. You can read it and add a note. To reply yourself, ask an admin to give you the chat.</span></div>
      )}

      {gated ? (
        <div className="ib-gate">
          <div inert aria-hidden="true">{editor}</div>
          <div className="ib-veil">
            <button className="ib-btn ib-p" type="button" disabled={props.takingOver} onClick={props.onTakeOver}>{props.takingOver ? 'Taking over…' : 'Take over'}</button>
            <span className="ib-small">The AI is answering. Take over to write yourself.</span>
          </div>
        </div>
      ) : editor}
    </div>
  );
}
