# F6 · Anti-ban

**Status:** v2 in build (2026-10-31). Replaces the placeholder `basicPolicy` behind the `AntiBanPolicy` seam that the cleanup
(PR #9) left. The diagrams this spec follows: https://claude.ai/artifact/FrRGsgBUBwYxuKUofWmGWn (sections 1–8).

**What nothing here can promise:** that a number is not banned. WhatsApp's model is secret and the biggest input is people
reporting the number. This feature does three things: it acts on every signal WhatsApp gives us, it never sends in a way that
breaks a chat ("Waiting for this message"), and it tells the user exactly what is happening and why.

**No daily caps.** A user decision: nothing in this feature limits how many messages a number sends in a day. The only
limits come from WhatsApp's own signals (timelock, new-chat quota) or from the state of one contact.

Every number marked *guess* is a threshold with no data behind it. Each one is a named constant in
`packages/core/src/antiban/constants.ts`, and every decision that uses one is logged with its inputs, so it can be tuned.

## Delivery

One feature, shipped as two PRs:

| PR | Stories | Why split |
|---|---|---|
| A · engine | S1–S9 | Everything that decides what is sent, when, and records why. Exposes it through the API. |
| B · visibility | S10 | Shows it: message timeline, campaign recipients, number card, ETA. Reads only what PR A stores. |

## Words

- **Lane:** the one queue a number sends from. Every outbound message of that number, from any source, goes through it in order.
- **New chat:** a contact who has never sent this number a message. Everyone else is a **known** contact.
- **Run:** a stretch of sends from a lane with no gap of 90 s or more between them.
- **Hold:** a message stays queued with a reason. Nothing is dropped by a hold.

---

## S1 · Send lane

One lane per number. Priority, highest first: reply (answers an inbound from the last 24 h) → manual (an agent typed it) → AI →
campaign. Within a priority, oldest first.

- **AC-1.1** Two messages from one number never leave at the same time, whatever queued them.
- **AC-1.2** A reply queued after 10 campaign messages goes before all of them.
- **AC-1.3** The first message of a run goes without a gap. Each next one waits a random 1–50 s (uniform) after the previous send.
- **AC-1.4** Typing: `composing` for `clamp(chars × 60 ms, 2 s, 25 s)` (*guess*), refreshed every 5 s, then `paused`, then the send. Typing happens inside the wait, so it adds no time: the wait is `max(gap, typing)`.
- **AC-1.5** Text plus a photo goes as one message: the photo with the text as its caption.
- **AC-1.6** Presence: `available` before the first send of a run, `unavailable` after 90 s (*guess*) with nothing sent. The number is never left online.
- **AC-1.7** Read receipts: an inbound message is never marked read when it arrives. It is marked read when an agent opens the chat, or 3–20 s (*guess*) before the reply to it starts typing.
- **AC-1.8** Every policy decision (send, wait n ms, hold reason) is logged with its inputs at `info`.
- **AC-1.9** A send that fails is marked `failed` with a reason code from the list in S10 and never retried automatically.

## S2 · WhatsApp's warnings

The adapter turns Baileys' `connection.update.reachoutTimeLock` and `message-capping.update` into port events. The gateway stores the
latest of each on the number and every raw one in `whatsapp_notice` (kind, payload, received_at).

- **AC-2.1** Timelock active: new chats are held (`timelock`) until `timeEnforcementEnds`; known contacts still get messages.
- **AC-2.2** Timelock ends (time passes or an inactive update arrives): held messages go, in lane order.
- **AC-2.3** New-chat cap `FIRST_WARNING`: gaps before new chats ×2. `SECOND_WARNING`: ×3 (*guess*). Known contacts unchanged.
- **AC-2.4** `CAPPED`: new chats held (`new_chat_cap`) until `cycle_end_timestamp`.
- **AC-2.5** The number stores `total_quota`, `used_quota`, `capping_status`, `cycle_end`, timelock `active`, `until`, `enforcementType`, and `linked_since` (first open after the last link).
- **AC-2.6** A 463 refusal on one send: that message is `failed` (`whatsapp_refused_463`), new sends to that contact held (`refused_463`). The cause of 463 is not known yet: an RCA is open, and this is a containment, not a fix.
- **AC-2.7** `device_removed` keeps today's behaviour (R-017): everything held, campaigns paused `unlinked`.

## S3 · Exact schedule and ETA

- **AC-3.1** On launch, the campaign draws every recipient's gap once and stores it on the recipient (`planned_gap_ms`). The lane uses that stored gap, so the schedule is known in advance.
- **AC-3.2** `GET /campaigns/:id/eta` returns `finishAt`, `goNow` (count), `afterReset` (count), `resetAt`, and `basis` (`quota` or `time_only`).
- **AC-3.3** With a known quota: new chats beyond `total_quota − used_quota` are scheduled after `cycle_end`. With none, `basis` is `time_only`.
- **AC-3.4** 500 recipients, no holds: ETA equals the sum of stored gaps (plus typing where typing exceeds the gap), to the second.
- **AC-3.5** A reply that jumps the queue, or a hold, moves the ETA, and the API says why (`delayedBy`: reason and seconds).

## S4 · After the send: ticks, offline or blocked

Checked by the sweep for every outbound message still at one tick 30 min (*guess*) after sending.

- **AC-4.1** The contact sent a decrypt retry for it: handled by S5. Nothing else here.
- **AC-4.2** Otherwise: probe the contact's profile photo and about, at most once per contact per 24 h (*guess*), compared with the snapshot taken the last time a message to them was delivered.
- **AC-4.3** Both were visible before and both are gone now: contact marked `likely_blocked`. Campaigns and AI stop messaging them (`likely_blocked`); an agent can still send by hand.
- **AC-4.4** Either still visible, or no earlier snapshot: `likely_offline`. Nothing is resent, ever.
- **AC-4.5** A contact "delivers fast" when one of their last 3 messages from us was delivered within 5 min (*guess*).
- **AC-4.6** Many stuck: of this number's last 20 sends to distinct fast-delivering contacts, excluding messages sent from the phone, 8 or more (*guess*) still at one tick after 30 min → campaigns on this number held (`many_undelivered`) and a health event recorded.
- **AC-4.7** That hold lifts when the count falls below 4 (*guess*), or when an agent resumes from the number card.

## S5 · Never "Waiting for this message"

- **AC-5.1** A retry receipt from a contact holds every new send to that contact (`decrypt_retry`). Baileys re-sends the message itself.
- **AC-5.2** The hold lifts on a delivered or read receipt from that contact after the retry, or a message from them that decrypts.
- **AC-5.3** A second retry for the same message: the session with that contact is recreated, the hold stays, and the composer shows the existing warning.
- **AC-5.4** Retries from 3 or more different contacts within 10 min (*guess*): the whole number is held (`decrypt_wave`) with a health event. Likely our session store, not the contacts.
- **AC-5.5** No campaign or AI message goes to a contact that has a retry not yet resolved.

## S6 · Replies, STOP and closing message

- **AC-6.1** Opt-out intent: a STOP word (`stop`, `unsubscribe`, `opt out`, and the org's list), or the AI classifier says negative (who is this, don't message me, abuse). With no AI configured, keywords only.
- **AC-6.2** On opt-out, one closing message is sent at reply priority: why they were messaged (the campaign's purpose, or the org default), a one-line summary, the org's contact number and email. Plain text, no link.
- **AC-6.3** Exactly one closing message per opt-out. A second STOP from them sends nothing.
- **AC-6.4** Then the contact goes on DNC: campaigns and AI blocked.
- **AC-6.5** A DNC contact writes again: an agent may reply by hand; campaigns and AI stay blocked.
- **AC-6.6** DNC lifts only when an agent lifts it, or the contact sends a restart word (`start`, and the org's list).
- **AC-6.7** Closing messages are on by default and switchable per org. Without a contact number or email set, the message leaves that line out, and the settings page asks for them.
- **AC-6.8** An agent can mark a reply as opt-out by hand (the classifier missed it), with the same effect.

## S7 · Extra protection

- **AC-7.1** Before the first message to a new chat, that one number is checked with `isRegistered`, result cached 30 days. Not on WhatsApp → `failed` (`not_on_whatsapp`). Unknown → send anyway. Never checked as a batch: the port warns that a stream of lookups is itself a restriction pattern.
- **AC-7.2** Campaign text supports variants `{Hi|Hello|Hey}` and `{{first_name}}`; each recipient gets one pick from a seeded draw. A campaign whose text has no variation and no AI writing shows a warning (it can still launch).
- **AC-7.3** First message to a new chat: on by default, a campaign with a link or a photo sends the text alone to new chats, and the photo or link goes as a follow-up when they reply. Known contacts get it all at once. Switchable per campaign.
- **AC-7.4** Reaction brake: over the number's last 50 new-chat sends, if `likely_blocked` ≥ 10% or (at least 30 sent and replies < 5%), new-chat gaps ×2 (*guess*). It lifts when both fall back below the thresholds. Logged.
- **AC-7.5** Quiet hours, default 22:00–08:00 in the org's time zone: campaign and AI first messages wait. Replies and manual sends still go. Switchable per org.
- **AC-7.6** Hints, advice only, never blocking: linked less than 7 days ago → "new number, go gentle"; timelock type `WEB_COMPANION_ONLY` → "use WhatsApp on the phone itself too".

## S8 · Holds never lose a message

- **AC-8.1** Every hold has a reason code from the list in S10 and the time it is expected to lift, or null if it waits for something.
- **AC-8.2** When a hold lifts, the message goes in its original lane order.
- **AC-8.3** A gateway restart keeps every queued and held message and its reason.

## S9 · Policy is still a driver

- **AC-9.1** The v2 policy implements `AntiBanPolicy`. The gateway takes any policy; tests can pass a fixed one.
- **AC-9.2** DNC, the recipient gates and "number not connected" still sit outside the policy and cannot be relaxed by it.
- **AC-9.3** `basicPolicy` is deleted.

## S10 · Visibility (PR B)

Reason codes shown to the user, each with a plain sentence and, where one exists, an action:

| Code | Sentence | Action |
|---|---|---|
| `timelock` | WhatsApp is not letting this number start new chats until HH:MM. | none |
| `new_chat_cap` | WhatsApp's new-chat limit for this number is used up until HH:MM. | none |
| `refused_463` / `whatsapp_refused_463` | WhatsApp refused messages to this contact. | Retry |
| `unlinked` | The number was unlinked from the phone. | Relink |
| `many_undelivered` | Many recent messages are not reaching people. WhatsApp may be limiting this number. | Resume |
| `decrypt_retry` | This contact's phone could not read our last message yet. Waiting until it can. | none |
| `decrypt_wave` | Several contacts could not read our messages. Sending is paused. | Relink |
| `likely_blocked` | This contact has probably blocked the number. | Send by hand |
| `dnc` | This contact asked not to be messaged. | Lift |
| `not_on_whatsapp` | This number is not on WhatsApp. | none |
| `quiet_hours` | Waiting for quiet hours to end at HH:MM. | Send now |
| `send_error` | The send failed: (provider message). | Retry |

- **AC-10.1** Every message shows a timeline: queued → waiting n s (reason) → typing → sent → delivered → read, or failed/held with the sentence and the action.
- **AC-10.2** The campaign page lists every recipient (paged), filterable by state and reason, instead of the four count boxes. Counts stay as the header.
- **AC-10.3** The campaign page shows the ETA from S3: "Finishes at 17:42", or "370 go now, finishing 15:10; 130 after WhatsApp's reset at 09:00 tomorrow".
- **AC-10.4** The number card shows live lane state ("Sending next in 12 s", "Holding new chats: timelock until 14:20"), the WhatsApp warning level with quota used/total, linked since, and the hints from AC-7.6.
- **AC-10.5** The countdown updates without a reload.

## Tests

Each AC has at least one test named after it (`AC-1.3 …`). Unit tests for the policy, schedule and classifier in
`packages/core/src/antiban/*.test.ts`; integration tests in `tests/integration/antiban-v2-*.test.ts` against the fake provider
(which gains timelock, capping, retry, profile-probe and presence hooks); Playwright for S10 in `tests/e2e/antiban-visibility.spec.ts`.
