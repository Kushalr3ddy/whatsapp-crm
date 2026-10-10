# 27 · Silent-restriction tracking

> **The problem.** When WhatsApp restricts an unofficial number it does **not** tell you. There is no
> error and no disconnect. Messages sit on one tick, arrive hours late, or never leave — and a
> campaign keeps pouring into the hole. The previous system could not see this at all. This is how
> this one does.

## What is detected, and from what

Nothing here reads WhatsApp's mind. It reads **our own delivery records**: every outbound message has
a `sent_at` and, once a receipt arrives, a `delivered_at`. A message that was sent more than 30
minutes ago and is still not delivered is **stuck**. The detector compares recent stuck-ness with the
number's own history.

| Signal | Meaning | Fires when |
|---|---|---|
| `stuck_spike` | A burst of undelivered sends | ≥ 8 sends 30 min–4 h old, ≥ 50 % still undelivered, and ≥ 30 points above this number's baseline |
| `slow_delivery` | Delivery has become slow | ≥ 8 delivered, median send→delivered over 5× baseline (and over 5 min), or over 15 min with no baseline |
| `known_contacts_stuck` | The people who normally reply are stuck too | ≥ 5 sends to people who have replied before, ≥ 50 % undelivered — this is not "some phones are off" |
| `strangers_only_stuck` | Only new contacts are stuck | ≥ 8 sends to people who never replied, ≥ 60 % undelivered while known contacts are fine — the shape of a **reachout timelock** |
| `inbound_silence` | Nobody has answered for two days despite heavy sending | ≥ 48 h since a reply with ≥ 20 sends in the last day — weak, only corroborates |

## The state machine

```
            two signals                 stuck spike + (known contacts stuck
   ok  ───────────────────►  suspected   or ≥ 60 % of ≥ 20 sends)
   ▲                            │  ▲ ─────────────────────────────────────►  likely
   │   held ≥ 1 h, evidence ok  │  │        held ≥ 6 h, evidence better          │
   └────────────────────────────┘  └─────────────────────────────────────────────┘
```

- **Up is immediate. Down is slow and one step at a time** (hysteresis), so a number does not flap.
- **One signal is never enough** for `suspected`: every signal has an innocent explanation.
- The state is recomputed about once a minute by the gateway sweep.

## What the system does

| State | Sending | Campaigns | Operator sees |
|---|---|---|---|
| `ok` | normal | normal | nothing |
| `suspected` | **slowed** (×3 on the inter-send delay) | continue | amber banner on the number, a warning in the thread composer, a badge on **Numbers** in the sidebar |
| `likely` | held — a **soft-ban recovery** is opened (48 h pause, then 5 % of cap, ramping) | **paused automatically** (`pause_reason = restriction_likely`) | red banner, the campaign says why it was paused, a critical event on the health timeline |

Resuming a campaign clears the pause reason. The number's state clears itself when delivery is
normal again and the stuck sends age out of the window.

A **possible hard ban** is separate: a logout that nobody asked for (no unlink in flight) is recorded
as `hard_ban_suspected` on the timeline. It is not auto-retired — a ban and someone unlinking on the
phone look identical at the socket — so the operator decides.

## What the operator sees

- **Numbers page** — a banner on the affected number, the risk meter, and a **Health timeline**
  listing every state change in plain sentences with the time (`GET /senders/:id/health-events`).
- **Sidebar** — a red count on **Numbers** while any number is `suspected` or `likely`.
- **Inbox** — a message stuck at one tick for 30 minutes reads `sent · no delivery for 3h`; the
  composer warns when the thread's number may be limited (it does not block sending).
- **Campaign page** — "Paused automatically: delivery from this number looks restricted".

Alerts are **in-app only**. Webhook, email and a canary self-test are pinned as D-43.

## Runbook: a number is flagged

1. Open **Numbers**, read the health timeline. `suspected` + `strangers_only_stuck` is usually a
   reachout timelock: stop messaging new people from that number for a day.
2. Check the phone. Are the messages really not delivered? Is the number still logged in?
3. Do **not** relink, restart or push the campaign harder. The system has already slowed or held it.
4. `likely`: leave it. It cools off for 48 h and ramps back. Resume the campaign on **Broadcast**
   only after the state has cleared.
5. A recurring pattern means the number is being reported: slow the campaign, vary the message,
   prefer people who have replied before.

## Fixes made alongside

- The close code (401 / 403 / 428 / 463 / 429) and consecutive-close count are now actually
  **stored**, so the health score's reachout/ban/reconnect-churn weights work (they read columns
  nothing used to write).
- A server **delivery ERROR** acknowledgement is recorded as a failed send instead of being dropped.

## Where it lives

`packages/core/src/restriction.ts` (pure `classifyRestriction`, `nextRestrictionState`, evidence
gathering, `checkRestriction`) · `apps/gateway/src/work.ts` (`sweepRestriction`, the send-gate
slowdown, the hard-ban event) · `sender_health_event` table and `sender_identity.restriction_*`
(migration 0022) · tests in `tests/integration/restriction.test.ts` and the `silent restriction`
scenarios in `tests/simulation/scenarios.sim.ts`.

## Limits, said plainly

It infers; it cannot know. A genuinely mass-offline audience can look like a restriction (the
cohort split and the baseline exist to avoid that), and a restriction that only delays by a few
minutes will not trip it. Thresholds are starting values to be tuned against a real-number pilot
(still pending).
