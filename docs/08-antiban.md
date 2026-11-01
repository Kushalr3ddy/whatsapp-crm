# 08 · Anti-ban

> **v2, parts 1 and 2 (2026-10-31).** The send lane, WhatsApp's warnings, the exact schedule and the extra protection (part 1), and
> the delivery checks, decrypt retries and opt-out handling (S4 to S6, part 2) are in. The screens (S10) come after. The spec, with
> every acceptance case, is `06-features/F6-antiban.md`; this page says where the code is.

Running Baileys against a normal WhatsApp number **violates WhatsApp's Terms of Service**. The number can be banned at any
time, for reasons outside this system's control, with no appeal. Nothing here removes that risk. This feature acts on every signal
WhatsApp gives us, never sends in a way that breaks a chat, and says what it is doing and why. Never point this at a number you
cannot afford to lose.

**There are no daily caps**, by design (a user decision). The only limits are WhatsApp's own signals (timelock, new-chat quota) and
the state of one contact. Every threshold with no data behind it is a named constant marked *guess* in
`packages/core/src/antiban/constants.ts`, and every decision that uses one is logged at `info` with its inputs.

## How a message goes out

One **lane** per number (`apps/gateway/src/lane.ts`). Every outbound message of that number, from any source, waits in it, and the
only thing that reaches the provider is the lane.

1. **Order:** a reply (answers an inbound from the last 24 h), then what an agent typed, then the AI, then campaign messages; oldest first within each. The priority is read from the chat, not from who wrote the message: an AI or campaign message to a chat whose contact wrote in the last 24 h goes as a reply (and skips quiet hours). The opt-out closing message is always a reply.
2. **Gates outside the policy** (they cannot be relaxed by it): do-not-contact (the message is **failed** with `do_not_contact`, not held), an empty body, the number itself, a number that is not connected (the message stays queued with `sender_not_connected`).
3. **The policy** (`AntiBanPolicy`, `packages/core/src/antiban.ts`; the v2 driver is `antiban/policy.ts`) answers `send`, `wait ms` or `hold {reason, until}`. It is pure: everything it reads is in the `SendContext`.
4. **Gap:** uniform 1 to 50 s after the previous send; the first message of a run (a silence of 90 s or more) has none. The gap is drawn once and stored (`campaign_recipient.planned_gap_ms`, copied to `message.planned_gap_ms`), so the schedule is known in advance.
5. **Typing sits inside the wait:** `composing` for `clamp(chars x 60 ms, 2 s, 25 s)`, refreshed every 5 s, then `paused`, then the send. The wait is the longer of gap and typing.
6. **Presence:** `available` before the first send of a run, `unavailable` after 90 s of nothing sent. A message is never marked read on arrival: only when an agent opens the chat, or 3 to 20 s before the reply to it starts typing.
7. **Waiting is scheduling.** A wait longer than the typing is not slept: the lane returns the moment to come back (`WorkContext.schedule`), so a sweep never sits open on a gap, a timelock or a held message. Only the typing and the read delay are slept (25 s at most).
8. **A send that fails is `failed` with a reason code** (`send_error`, `whatsapp_refused_463`, `not_on_whatsapp`, ...) and is never retried.

A hold keeps the message queued with `hold_reason` and `hold_until` (null when it waits for something). It never drops a message,
survives a restart, and when it lifts the message goes in its original place in the lane. Hold reasons are a typed list
(`HOLD_REASONS`). A hold on one contact or on the whole number is looked up in one place,
`antiban/holds.ts` (`contactHoldOf`, `numberHoldOf`). Which priorities a hold stops is the policy's rule: most stop everything, but
`likely_blocked` stops only campaign and AI messages and `many_undelivered` only campaigns.

## What the policy acts on

| Signal | Effect |
|---|---|
| Timelock active (`reachoutTimeLock`) | New chats held (`timelock`) until it ends; known contacts still go |
| Cap `FIRST_WARNING` / `SECOND_WARNING` | Gaps before new chats x2 / x3 (*guess*) |
| Cap `CAPPED`, or quota used up | New chats held (`new_chat_cap`) until the cycle ends |
| A 463 refusal | That message `failed`; new sends to that contact held (`refused_463`). Nothing clears it yet (the Retry action is S10): today it is cleared by hand (`conversation.refused_463_at`). A containment: the cause of 463 is not known yet |
| Reaction brake: of the last 50 new-chat sends, 30+ with under 5% replies (or 10%+ marked `likely_blocked`) | New-chat gaps x2 (*guess*); lifts by itself |
| Quiet hours (default 22:00 to 08:00 in Asia/Kolkata until the org sets its own, `antiban_setting`) | Campaign and AI first messages held (`quiet_hours`); replies and manual sends still go |
| `device_removed` | As before (R-017): everything held, campaigns paused `unlinked` |

Setting `SEND_TYPING_SIMULATION=false` turns the typing off (CI and the fake channel do); it is the only anti-ban setting in the environment, everything else is a constant or an org setting.

WhatsApp's raw warnings are kept in `whatsapp_notice`; the latest of each, the quota, `linked_since` and the timelock type are on
`channel_session`. The port carries them as `ChannelProvider.notices()`; `presence()` and `markRead()` are optional port methods.

## After the send: ticks, retries and opt-outs (S4 to S6)

**One tick for 30 minutes (S4, `antiban/ticks.ts`, `antiban/delivery-check.ts`).** The gateway sweep (`sweepDeliveries`, run with every
sweep) looks at each outbound message still at one tick 30 minutes after it went. A message the contact asked for again belongs to S5
and is only marked. For the rest it probes the contact's profile photo and about (`ChannelProvider.profileSnapshot`, at most once per
contact per 24 h, a few lookups per pass) and compares with the snapshot taken when a message to them was last delivered. Both visible
then and both gone now: the contact is marked `likely_blocked` (campaigns and the AI stop messaging them; an agent can still send by
hand; a message from them clears the mark). Anything else, or no snapshot: `likely_offline`. **Nothing is ever resent.**

Many stuck: of the number's last 20 sends to distinct contacts who "deliver fast" (one of their last 3 messages delivered within 5 min),
excluding messages sent from the phone, 8 or more still at one tick after 30 min hold the number's campaigns (`many_undelivered`) and add
a health event. It lifts when the count falls below 4, or when an agent resumes (`POST /senders/:id/resume`, the number card); after a
resume only newer sends count, so the old stuck ones do not bring the hold straight back.

**Decrypt retries (S5, `antiban/retry-state.ts`).** A contact's phone asking for a message again ("Waiting for this message") arrives as a
port event (`ChannelProvider.retries()`; the Baileys adapter reads it from its log line). Baileys resends the message itself; we never
queue a copy. Every new send to that contact is held (`decrypt_retry`) until a delivered or read receipt that comes after the retry, or a
message from them that decrypts. A second request for the same message recreates the session with that contact
(`ChannelProvider.resetSession`; in Baileys this removes the contact's `session-<user>.<device>` keys, and those under their privacy
address, from the credential store) and raises the composer's existing encryption-session warning (`decrypt_burst_at`). Retries from 3 or
more different contacts within 10 minutes hold the whole number (`decrypt_wave`) with a critical health event; that hold ends when the
number is linked again, not on a reconnect.

**Opt-outs (S6, `antiban/optout.ts`, `antiban/opt-out.ts`).** When a stored inbound message is a STOP word (`stop`, `unsubscribe`,
`opt out`, and the org's own: the whole message, not a word inside a sentence), or the AI classifier reads it as negative (who is
this, do not message me, abuse; keywords only when no AI is configured; a slow or failing model counts as no), one closing message is
queued at reply priority and the contact goes on do-not-contact with the reason `opt_out`. The closing message says why they were
messaged (the campaign's `purpose`, else the org's default), a one-line summary of what was last sent, that they will not be messaged
again, and the org's contact number and email; plain text with every link removed, and a line is left out when what it needs is not set.
Exactly one per opt-out: a second STOP sends nothing. Campaigns and the AI stay blocked by the existing do-not-contact gates; a
do-not-contact contact who writes again can be answered by an agent by hand (a signed-in person, not a key or the AI). The flag lifts
when an agent lifts it (`PUT /contacts/:id/do-not-contact`), or the contact sends a restart word (`start`, and the org's own), but only
a flag that came from an opt-out. An agent can mark a reply as an opt-out by hand (`POST /conversations/:id/opt-out`), with the same
effect. The closing message is on by default and switchable per org (`antiban_setting.closing_message_enabled`; the opt-out itself
happens either way).

Settings: `GET/PUT /antiban/settings` (admin). `missing` lists the contact details the closing message is still without.

## Extra protection

- **Is this number on WhatsApp:** `isRegistered`, for one number, just before the first message to a new chat, cached 30 days. "Not on WhatsApp" fails the message; "could not tell" sends. Never a batch.
- **Variants:** `{Hi|Hello|Hey}` and `{{first_name}}`, one pick per recipient from a draw seeded by campaign and contact. A campaign with no variation and no AI writing it gets a `no_variation` warning and can still launch.
- **Media after reply:** on by default, a new chat gets the text alone and the picture or link follows when they reply; known contacts get it all at once. `campaign.media_after_reply`.
- **Hints (advice only):** a number linked under 7 days ago; a `WEB_COMPANION_ONLY` timelock. Shown by `GET /senders` (`hints`).

## The ETA

`GET /campaigns/:id/eta` (`antiban/eta.ts`) plays the stored gaps forward: with no holds, the sum of the gaps plus typing where it is longer.
New chats beyond the quota WhatsApp reported go after the cycle end (`goNow`, `afterReset`, `resetAt`, `basis`), and what moved the
finish is named (`delayedBy`).

## What stays, because it protects people and not the number

- **Do-not-contact**, checked when a message is created and again as the last line before it is sent. An admin can override it per message or per campaign, with a reason, audited; an agent can answer by hand a contact who wrote after being flagged; an agent or the contact (a restart word) can lift an opt-out.
- **The recipient policy gates** (`packages/core/src/policy-gates.ts`): an agent mid-conversation, the 14-day cooldown after another campaign, a duplicate in a live campaign.
- **Not sending to the sending number itself, an empty body, a contact whose numbers have no WhatsApp account** (the number fallback, D-60).
- **Connection handling**: a 403 raises a ban warning and pauses the number's running campaigns; an unrequested logout (401) does the same; a device removed under Linked devices is an unlink, not a ban (R-017). Written to `sender_health_event`.

## Plugging a different driver in

Write an `AntiBanPolicy` and pass it as `antiBan` in the gateway's `WorkContext` (`apps/gateway/src/main.ts`); tests pass a fixed one.
`basicPolicy`, the placeholder, is deleted. The old engine's names fail `tests/integration/antiban-purged.test.ts` on purpose.

## What was removed on 2026-10-30

The old engine (warmup ramp, per-minute/hour/day caps, circadian pacing, contact-graph gates, risk score and health bands, timed
recovery, silent-restriction detection, advisory mode, fake background activity, delayed read receipts, recipient time zones). Its
numbers were copied from one public library with no data behind them; the only primary source is WhatsApp's own 2019 white paper on
abuse and unwanted messages. The history stays in `CHANGELOG.md`, `HANDOFF.md` and `21-deferred.md`.
