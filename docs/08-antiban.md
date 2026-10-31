# 08 · Anti-ban

> **v2, part 1 (2026-10-31).** The send lane, WhatsApp's warnings, the exact schedule and the extra protection are in. Delivery
> checks, decrypt retries and opt-out handling (S4 to S6) and the screens (S10) come after. The spec, with every acceptance case, is
> `06-features/F6-antiban.md`; this page says where the code is.

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

1. **Order:** a reply (answers an inbound from the last 24 h), then what an agent typed, then the AI, then campaign messages; oldest first within each.
2. **Gates outside the policy** (they cannot be relaxed by it): do-not-contact, an empty body, the number itself, a number that is not connected.
3. **The policy** (`AntiBanPolicy`, `packages/core/src/antiban.ts`; the v2 driver is `antiban/policy.ts`) answers `send`, `wait ms` or `hold {reason, until}`. It is pure: everything it reads is in the `SendContext`.
4. **Gap:** uniform 1 to 50 s after the previous send; the first message of a run (a silence of 90 s or more) has none. The gap is drawn once and stored (`campaign_recipient.planned_gap_ms`, copied to `message.planned_gap_ms`), so the schedule is known in advance.
5. **Typing sits inside the wait:** `composing` for `clamp(chars x 60 ms, 2 s, 25 s)`, refreshed every 5 s, then `paused`, then the send. The wait is the longer of gap and typing.
6. **Presence:** `available` before the first send of a run, `unavailable` after 90 s of nothing sent. A message is never marked read on arrival: only when an agent opens the chat, or 3 to 20 s before the reply to it starts typing.
7. **Waiting is scheduling.** A wait longer than the typing is not slept: the lane returns the moment to come back (`WorkContext.schedule`), so a sweep never sits open on a gap, a timelock or a held message. Only the typing and the read delay are slept (25 s at most).
8. **A send that fails is `failed` with a reason code** (`send_error`, `whatsapp_refused_463`, `not_on_whatsapp`, ...) and is never retried.

A hold keeps the message queued with `hold_reason` and `hold_until` (null when it waits for something). It never drops a message,
survives a restart, and when it lifts the message goes in its original place in the lane. Hold reasons are a typed list
(`HOLD_REASONS`); the codes of S4 to S6 are already in it. A hold on one contact or on the whole number is looked up in one place,
`antiban/holds.ts` (`contactHoldOf`, `numberHoldOf`).

## What the policy acts on

| Signal | Effect |
|---|---|
| Timelock active (`reachoutTimeLock`) | New chats held (`timelock`) until it ends; known contacts still go |
| Cap `FIRST_WARNING` / `SECOND_WARNING` | Gaps before new chats x2 / x3 (*guess*) |
| Cap `CAPPED`, or quota used up | New chats held (`new_chat_cap`) until the cycle ends |
| A 463 refusal | That message `failed`; new sends to that contact held (`refused_463`) until a person lifts it. A containment: the cause of 463 is not known yet |
| Reaction brake: of the last 50 new-chat sends, 30+ with under 5% replies (or 10%+ blocked, from S4) | New-chat gaps x2 (*guess*); lifts by itself |
| Quiet hours (default 22:00 to 08:00, org time zone, `antiban_setting`) | Campaign and AI first messages held (`quiet_hours`); replies and manual sends still go |
| `device_removed` | As before (R-017): everything held, campaigns paused `unlinked` |

WhatsApp's raw warnings are kept in `whatsapp_notice`; the latest of each, the quota, `linked_since` and the timelock type are on
`channel_session`. The port carries them as `ChannelProvider.notices()`; `presence()` and `markRead()` are optional port methods.

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

- **Do-not-contact**, checked when a message is created and again as the last line before it is sent. Only an admin can lift it, per message or per campaign, with a reason, audited.
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
