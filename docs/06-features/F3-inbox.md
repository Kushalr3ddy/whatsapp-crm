# F3 · Shared inbox

**Covers** FR-19…FR-27 · **Fixes** M31 · **Tier** V1 (SLA & routing V2)

## Purpose

The screen agents live in all day. It has to feel as fast as WhatsApp Web, or nothing else in
the product matters. Competitive bar is Respond.io.

## What each piece is, in plain words

The parts of the inbox and what they are for. Status as of this writing in brackets.

- **Assignment** *(built)* — giving a conversation an owner, so a team knows who is handling whom
  instead of everyone facing one undifferentiated pile. Set from a dropdown in the thread header;
  `conversation.assignee_user_id` holds it.
- **Status** *(built)* — a conversation is **open** (live, needs attention) or **closed** (dealt
  with, archived). "Resolve" closes it, "Reopen" brings it back. Keeps the working list to what is
  actually live.
- **Filters** *(built)* — narrow the list instead of scrolling everything: by owner
  (**Mine / Unassigned / All**) and by status (**Open / Closed / Any**). "My open threads" is the
  everyday view. Server-side on `GET /conversations`, mirrored by the tabs in the UI.
- **Attachments** *(built)* — files sent or received in a thread (a PDF, an image). Shown as a
  download link with filename, type and size. Always served as a download, never rendered inline,
  so a booby-trapped file cannot execute from our origin (see `09-security.md` and the media notes
  in `24-local-testing.md`).
- **Sending files** *(built, D-25)* — the 📎 button in the composer sends an image, video, audio file, PDF or
  Office document into the thread, with the typed text as its caption. The file's type is decided from its
  bytes (HTML and unknown types are refused) and it goes through the same anti-ban policy as any message.
- **Internal notes** *(built)* — team-only comments inside a thread that the contact never sees —
  "spoke on call, sending CV tomorrow". How two agents hand a thread off. They live in
  `internal_note`, a table the send path never reads, so a note can never be transmitted (AC-4).
- **Canned replies** *(built)* — saved message templates with a `shortcut`. Insert one and its
  `{{name}}` placeholder is filled from the contact, so an agent does not retype the same opener.
- **Thread lock** *(built)* — once a thread is assigned, only that owner may reply until they
  resolve or reassign it; replying otherwise is `409`. An admin overrides, and an API key (an
  integration, not a person) is exempt. A deliberately simple stand-in for collision detection.
- **Read state** *(built)* — opening a thread clears its unread badge (and `POST
  /conversations/:id/read` does it explicitly). The count rises on inbound and resets on read;
  it is per-conversation today, not yet per-agent.
- **Opening any thread** *(built)* — `GET /conversations/:id` fetches one conversation by id, so a
  thread further down than the recent-100 list can still be opened.
- **Presence, typing, collision detection** *(deferred, D-17)* — showing that a colleague is
  viewing or typing in a thread. Needs a realtime channel; the thread lock covers the "don't both
  reply" case simply for now.
- **Live inbound** *(deferred, blocked by D-14)* — a new incoming message appearing in under a
  second without a refresh. The inbox polls every 5 s today.
- **Search, snooze, priority, Meta 24-hour window UI, ~~keyboard shortcuts~~** *(deferred — search is
  open; snooze / Meta-window are pinned as D-18; keyboard shortcuts struck out 2026-10-10)*.

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

- **AC-1** Threads list with filters (mine / unassigned / all / status / channel / tag) and
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
