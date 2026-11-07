# F3 · Shared inbox

**Covers** FR-19…FR-27 · **Fixes** M31 · **Tier** V1 (SLA & routing V2)

## Purpose

The screen agents live in all day. It has to feel as fast as WhatsApp Web, or nothing else in
the product matters. Competitive bar is Respond.io.

## What each piece is, in plain words

The parts of the inbox and what they are for. Status as of this writing in brackets.

- **Assignment** *(built)* — giving a conversation an owner, so a team knows who is handling whom
  instead of everyone facing one undifferentiated pile. Set in **Details** (the AI assistant, a person or nobody);
  `conversation.assignee_user_id` holds it.
- **Status** *(built)* — a conversation is **open** (live, needs attention) or **closed** (dealt
  with, archived). "Resolve" closes it, "Reopen" brings it back. Keeps the working list to what is
  actually live.
- **Search and views** *(built)* — search looks in the person's name, number and the last message and highlights the match.
  Five quick views, each with a count: **All**, **Needs you** (an open chat where the customer spoke last and a person is meant to
  answer, or where the AI is stuck), **Unread**, **AI answering** and **You answering**. One **Filters** button narrows by campaign,
  imported file, owner and status (**Open / Closed / Any**), shown as removable chips. Server-side on `GET /inbox` and
  `GET /inbox/filters`.
- **Attachments** *(built)* — files sent or received in a thread (a PDF, an image). Shown as a
  download link with filename, type and size. Always served as a download, never rendered inline,
  so a booby-trapped file cannot execute from our origin (see `09-security.md` and the media notes
  in `24-local-testing.md`).
- **Sending files** *(built, D-25)* — the composer sends an image, video, audio file, PDF or
  Office document into the thread, with the typed text as its caption; up to five pictures can be pasted into it. The file's type is decided from its
  bytes (HTML and unknown types are refused) and it goes through the same anti-ban policy as any message.
- **Internal notes** *(built)* — team-only comments inside a thread that the contact never sees —
  "spoke on call, sending CV tomorrow". How two agents hand a thread off. They live in
  `internal_note`, a table the send path never reads, so a note can never be transmitted (AC-4).
- **Canned replies** *(built)* — saved message templates with a `shortcut`. Insert one and its
  `{{name}}` placeholder is filled from the contact, so an agent does not retype the same opener.
- **Who can reply** *(built)* — only a chat's owner or an admin can send; anyone else on the chat reads it and adds notes, and
  sending is `409 THREAD_ASSIGNED`. The first person to send in a chat nobody owns becomes its owner (audited). An API key never
  claims a chat, and an admin replying to someone else's chat does not take it.
- **Take over and Hand back** *(built)* — while the AI owns a chat the reply box is blurred with **Take over**, which stops the AI at
  once (it checks the owner before it writes and again before it sends); **Hand back** gives the chat to the AI again. When the AI
  skips a chat a card offers **Reply myself** and **Let the AI try again**.
- **Details** *(built)* — a slide-over, closed by default: who has the chat, Resolve and Reopen (with Undo), the number and whether
  it is linked, the campaigns that messaged the person, **Open in Contacts**, and the other people on the chat (admins add and remove).
- **One message box** *(built)* — Reply or Note, bold / italic / strike / mono, **Fill-in** from the person, Saved replies, a
  **Preview** line; Send waits while the preview shows a blank or unknown fill-in. It is the same box as New campaign.
- **Read state** *(built)* — opening a thread clears its unread badge (and `POST
  /conversations/:id/read` does it explicitly). The count rises on inbound and resets on read;
  it is per-conversation today, not yet per-agent.
- **Opening any thread** *(built)* — `GET /conversations/:id` fetches one conversation by id, so a
  thread further down than the recent-100 list can still be opened.
- **Presence and typing** *(built)* — who is viewing and who is typing show under the chat's name.
- **Live inbound** *(deferred, blocked by D-14)* — a new incoming message appearing in under a
  second without a refresh. The inbox polls every 5 s today.
- **Snooze, priority, Meta 24-hour window UI** *(deferred, D-18)*.

## User stories

- As an agent I see conversations assigned to me, unassigned, and everything, and switch fast.
- As an agent I know immediately when a colleague is already in a thread, so we don't both reply.
- As an agent I leave an internal note and @mention someone without the contact seeing it.
- As an agent I insert a canned reply and it fills in the contact's details.
- As an agent I snooze a thread until tomorrow and it comes back.
- As a manager I see which threads are breaching response time.

## Design notes

**Conversation is the scope, always.** Message history is fetched per conversation, never per
contact — the old system's `listMessages()` returned every message a contact had ever sent,
which mixed contexts when the same person was worked for two campaigns (M31).

**Collision detection** is presence over the realtime channel: who is viewing, who is typing.
Cheap once realtime exists, and one of the clearest differentiators in the India segment.

**The window clock is visible.** For Meta conversations the UI shows time remaining in the
24-hour service window, because after it expires only templates are legal and an agent
needs to know that before typing.

## Acceptance criteria

- **AC-1** Threads list with search, the five views and filters (campaign / file / owner / status) and
  loads the first screen in under 500 ms at the Small-team tier.
- **AC-2** A new inbound message appears in a connected agent's inbox in under 1 second.
- **AC-3** Two agents opening the same thread each see the other's presence; typing is shown live.
- **AC-4** Internal notes are visually distinct and never transmitted; a test asserts they
  cannot reach a provider.
- **AC-5** Canned replies substitute contact variables and are previewable before sending.
- **AC-6** Snooze returns the thread at the chosen time and re-opens it.
- **AC-7** Search covers message bodies and contact fields, respecting encryption (via blind
  index / trigram on permitted columns).
- **AC-8** Media sends and receives through the storage driver; nothing is written to local disk.
- **AC-9** The Meta window countdown is shown, and the composer switches to template-only when
  it expires.
- ~~**AC-10** Keyboard shortcuts for reply, assign, resolve, next/previous thread.~~ *(struck out, Kushal 2026-10-10)*

## API surface

```
GET    /api/v1/conversations                filters + cursor
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}           status, assignee, priority, snooze
GET    /api/v1/conversations/{id}/messages  cursor, newest-first
POST   /api/v1/conversations/{id}/messages  freeform or template (dispatcher decides legality)
POST   /api/v1/conversations/{id}/notes
POST   /api/v1/conversations/{id}/read
GET    /api/v1/canned-replies
WS     /realtime                            presence, typing, new message, assignment
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-3.1 | Contact in two campaigns simultaneously | Two conversations; neither shows the other's messages (M31 regression) |
| TC-3.2 | Two agents open one thread | Each sees the other's presence within 1 s |
| TC-3.3 | Agent types an internal note | Never reaches the provider; fake adapter records nothing |
| TC-3.4 | Inbound arrives while agent is viewing | Appears without refresh, unread count correct |
| TC-3.5 | Snooze 1 h, wait | Thread re-opens at the right time |
| TC-3.6 | Meta window expires while composing | Composer switches to template-only; freeform send rejected |
| TC-3.7 | 10k-message thread | Paging stays under 300 ms p95 |
| TC-3.8 | Agent A assigns to B | B's inbox updates live; audit row written |
| TC-3.9 | Accessibility sweep | WCAG 2.1 AA on the inbox |
