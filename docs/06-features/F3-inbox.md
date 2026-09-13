# F3 · Shared inbox

**Covers** FR-19…FR-27 · **Fixes** M31 · **Tier** V1 (SLA & routing V2)

## Purpose

The screen agents live in all day. It has to feel as fast as WhatsApp Web, or nothing else in
the product matters. Competitive bar is Respond.io.

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
- **AC-10** Keyboard shortcuts for reply, assign, resolve, next/previous thread.

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
