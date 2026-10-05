# 08 · Anti-ban engine

The most important document in this repository. The entire free transport depends on it, and
a failure is unrecoverable — a hard-banned WhatsApp number has no appeal process.

> **Read this first.** Running Baileys against a normal WhatsApp number **violates WhatsApp's
> Terms of Service**. The number can be banned at any time, for reasons outside this system's
> control, with no recourse. Everything below substantially *reduces* that risk. Nothing below
> *eliminates* it. Reported industry analysis puts roughly **68% of Indian SMBs using
> unofficial automation hitting at least one ban within 12 months**. Never point this at a
> number you cannot afford to lose, and route anything your business depends on through the
> official Cloud API.

Every default here is a config value in `org_setting`. The hard safety limits are **not**
editable to an unsafe value by anyone, including an admin — see "Two classes of gate".

## What actually gets numbers banned

From 2025–26 signal research and community post-mortems. WhatsApp's detection is a multi-layer
system: device fingerprinting at registration, behavioural analysis during messaging, recipient
report/block signals, and content pattern matching.

| Signal | Weight | What it means |
|---|---|---|
| **Reply ratio below ~10%** | Very high | Spray-and-pray. The single strongest behavioural signal. |
| **Contact-graph distance** | Very high | Messaging strangers who have never interacted with you |
| **Block / report rate above ~2%** | Very high | Triggers a quality downgrade and a self-reinforcing spiral |
| **Robotic timing** | High | Fixed intervals, instant reads at 4 a.m., "too perfect" behaviour |
| **Identical message bodies** | High | The same text to many recipients |
| **Burst floods after reconnect** | High | Draining a backlog the moment the socket returns |
| **Unanswered-message accumulation** | Medium–high | Messages with no reply within 48 h |
| **Device fingerprint anomalies** | Medium | The same account appearing from inconsistent clients |

The feedback loop is what makes this dangerous: a block rate above 2% downgrades quality,
which throttles volume, which reduces replies, which lowers the reply ratio, which degrades
quality further. **Once started it is very hard to reverse** — so the engine is designed to
brake early rather than recover late.

## What is built, and what is not

✅ **Layer 1 (warmup) and Layer 2 (rate limiting) are enforced** in
`packages/core/src/pacing.ts`, called from `handleSend` in the gateway — the single point every
outbound message passes through. A paced message is **left queued**, never failed: a message
that is merely early has not gone wrong, and failing it would lose it.

Counts come from the `message` table rather than an in-memory bucket. A bucket resets on
restart and counts separately per replica, and `tsx watch` restarts the gateway on every file
save — which would silently hand a developer an unlimited sender. The database already records
what was sent and when, so it is the only source that cannot lie. The cache-driver buckets
below (M13) are an optimisation for later, not a prerequisite.

✅ **Circadian pacing is built** (also in `packages/core/src/pacing.ts`, same gate). Once a send
is within every layer 1–2 ceiling, the time of day gets a say: overnight it is deferred to the
morning (reason `circadian`, left queued like any paced message), and through the day the
jittered pause is stretched so the shoulders of the day send more slowly than midday. The curve
is a smooth cosine — full speed 09:00–22:00, tapering to dead 02:00–06:00, ramping back by 09:00
— read against the number's timezone (`SEND_TIMEZONE`, default IST; `SEND_CIRCADIAN=false` turns
it off). It is opt-in per sender, so it never changes what layers 1–2 do on their own.

✅ **Contact-graph gates are built** (`packages/core/src/contact-graph.ts`, called from
`handleSend` alongside the pacing gate). Every send is classified by relationship from real
message history — **known** (they have replied), **contacted** (we have messaged, no reply yet),
**stranger** (no contact either way) — which stretches the pause by 1.0× / 1.8× / 2.5×. On top of
that, a **new-contact throttle** caps how many brand-new strangers a number may *start* messaging
(`NEW_CONTACTS_PER_HOUR` / `_PER_DAY`, default 5 / 20); a stranger over the cap is left queued
(reason `new_contact_throttle`), while known and already-contacted recipients are never throttled.
Opt-in like circadian (`CONTACT_GRAPH_GATES=false` disables it), and campaigns are gated for free
since their sends pass through the same point.

✅ **Health scoring is built** (`packages/core/src/health.ts`, run in the gateway sweep). It is
the closed loop: it watches send outcomes (delivery ratio, failure rate, typed disconnect codes,
reconnect churn), rolls them into a 0–100 `risk_score` with the evidence stored in
`sender_identity.health`, and **acts** — a `high` band degrades the number (sends at half speed), a
`critical` band quarantines it (sends are held, its campaigns skipped), and — the property this
project has botched three times — it **recovers in both directions**, climbing back to `active`
through the bands once the signals clear, with hysteresis so a score near a threshold does not
flap. A quarantined number stays *connected* (it can still receive, which is what lets it recover);
it just does not send.

✅ **Per-incident recovery orchestration is now built** (Layer 6 below). Beyond the scorer's
both-ways *status* recovery, a typed incident now starts a **timed** response: a **463** timelock →
24 h pause then resume at 10 % of cap, +15 %/week; a **429** rate overlimit → 4 h then 25 %,
+25 %/week; a **delivery-collapse soft ban** → 48 h then 5 %, +10 %/week. State lives in three
`sender_identity` columns (`recovery_incident`, `recovery_started_at`, `recovery_until`, migration
0016); everything else is computed by `recoveryState` in `@crm/core`. The pause is a full hold at
the send chokepoint (message left queued, never failed), the ramp is a fraction that only *lowers*
the daily ceiling, and the Numbers page shows an at-risk / cooling-off banner per number. A 401 hard
ban stays on the existing unlink→re-link path rather than auto-retiring, because a genuine ban and a
user unlink are indistinguishable at the socket. One refinement to what *is* built remains open: inferring the *recipient's* timezone.

✅ **Typing simulation is now built** (D-24). Before each send the gateway emits a `composing`
presence, pauses a beat proportional to the message length (Gaussian on the rate, clamped
0.7–8 s), then clears it — so a send looks human rather than instant. Opt-in via
`SEND_TYPING_SIMULATION` (default on), cosmetic and best-effort: a failed presence never fails the
send. The beat is a *compressed* pause, not literal 45-WPM typing time (a 30-second bubble before
every send would stall a paced queue for no gain).

✅ **The "never received an inbound message is capped harder" rule is now built.** A sender whose
`last_inbound_at` is null is clamped to **20 sends/day regardless of warmup day** in `dailyCeiling`
(`OUTBOUND_ONLY_DAILY_CAP`), lifting automatically the moment its first inbound arrives. Enforced at
the send chokepoint and in campaign dispatch, and reflected in the campaign forecast. It only ever
*lowers* the ceiling, and a caller that does not evaluate inbound (`lastInboundAt` absent) skips it,
so the rest of the pacing path is unchanged. Outbound-only is exactly the pattern the graph
heuristics punish — a real account gets replies — and now the ceiling says so.

## Layer 1 — Warmup

Per sender identity, from `warmup_started_at`. Exponential ramp, factor **1.8×/day**:

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
|---|---|---|---|---|---|---|---|---|
| Max sends | 20 | 36 | 65 | 117 | 210 | 378 | 680 | steady-state cap |

- Re-enters warmup after **72 hours of inactivity**.
- A number that has never received an inbound message is capped harder regardless of day —
  outbound-only is exactly the pattern the graph heuristics punish.
- The ceiling cannot be raised by an admin, an override, or an API call.

## Layer 2 — Rate limiting

Defaults per sender identity: **8/minute · 200/hour · 1,500/day**.
Inter-send delay **1.5–4 s** with **Gaussian jitter** — clustered around the midpoint, because
uniform random is itself a detectable signature (and a fixed 1,000 ms interval, as in M10, is
a perfect 1 Hz fingerprint).

Token buckets live in the cache driver so the limit holds **across worker replicas** (M13).
A shared org-wide bucket prevents the "5 senders × 8/min = 40/min from one IP" pattern.

## Layer 3 — Human-behaviour simulation

- **Typing** ✅ **built** (D-24): `composing` → beat proportional to the message length (Gaussian
  on the per-char rate, clamped 0.7–8 s) → `paused` → send, at the one send chokepoint in the
  gateway. Opt-in via `SEND_TYPING_SIMULATION` (default on). The beat is a compressed, practical
  pause rather than literal 45-WPM typing time — a half-minute "typing…" bubble before every send
  would stall the paced queue for no anti-ban gain, since the tell being removed is the *instant*
  send, not a fast one. Best-effort: a failed presence update never fails the send.
- **Circadian pacing** ✅ **built** (see "What is built" above): fast 09:00–22:00, slow
  22:00–02:00, near-dead 02:00–06:00, with a smooth cosine transition rather than steps. Uses the
  configured send timezone (`SEND_TIMEZONE`); the recipient's inferred timezone is a future
  refinement, not built yet.
- **Read behaviour** ✅ **built**: an inbound message is blue-ticked only after its own 10–60 minute
  delay (`readDelayMs`, derived from the message id so a restart cannot reshuffle it), only in the
  number's active hours (circadian level ≥ 0.5, so never at 4 a.m.), never for a message older than
  24 h, and at most 3 per sender per 60-second sweep — a backlog is a trickle, never a burst.
  `message.read_at` on an inbound message records "we sent the receipt", set only after the provider
  confirms, so a closed socket just retries. `ChannelProvider.markRead` is optional like `typing`.
  `SEND_READ_RECEIPTS=false` stops the gateway sending any.
- **Background entropy** ✅ **built**: every 2–6 hours per connected number, in active hours only, the
  gateway emits one noise event — a "typing…" for 3–8 s that is then abandoned (`paused`, no message),
  and an available→unavailable presence blip held 30–120 s. The typing goes only to a contact who has
  replied, never a stranger; with nobody suitable it does just the blip. `EntropyScheduler` (core)
  schedules per number, in memory — the first sighting schedules 2–6 h out, so a restart never fires
  every number at once. Best-effort and detached from the send sweep. Optional `ChannelProvider.presence`.
  `SEND_BACKGROUND_ENTROPY=false` turns it off.
- **Body variation** ✅ **built** (D-26): spintax (`{Hi|Hey}`) plus per-recipient variables
  (`{{name}}`) render each recipient's copy in `dispatchCampaign` (`renderBody`, `@crm/core`), so
  sends are no longer byte-identical. **And the dispatcher now refuses more than N identical bodies
  in a window**: a sender holds at most `IDENTICAL_BODY_DAILY_CAP` messages with the same
  `body_hmac` per rolling 24h (default 50), the excess left pending (never failed) until the window
  frees or the operator adds variation. Spintax/`{{name}}` make bodies differ, so it only bites a
  no-variation blast — exactly the shape it exists to slow.

## Layer 4 — Contact-graph gates ✅ built (see "What is built" above)

Delay multiplier by relationship:

| Relationship | Multiplier | Built as |
|---|---|---|
| Known contact (has replied before) | 1.0× | `known` |
| Handshake complete | 1.3× | folded into `known` (a reply is a reply) |
| Handshake sent | 1.8× | `contacted` |
| **Stranger** | **2.5×** | `stranger` |

New-contact throttle: **5/hour, 20/day** ✅ enforced.

✅ **Reply-ratio floor built.** The 20/day cap is *earned*, not given: it applies only once at least
**10** new contacts from the last **7 days** (each given a **48 h** grace to answer) exist and **≥30 %**
of them replied. Until then the daily allowance is **5/day** (`DEFAULT_REPLY_FLOOR`,
`newContactDailyAllowance` in `contact-graph.ts`). It only ever lowers the cap, is computed from the
`message` table like every other layer, and a held send names the evidence in its reason (e.g. "2 of
10 recent new contacts replied"). It is deliberately a *floor on the allowance*, not a hard stop — a
hard stop would starve the number of the very replies that raise the ratio. `NEW_CONTACT_REPLY_FLOOR=false`
restores the flat cap.

Group operations (V2, but the limits belong here): ~3 adds and ~2 creates per 10 minutes;
a **12-hour lurk period** after joining a group before posting.

## Layer 5 — Health monitoring & adaptive throttle ✅ built (see "What is built" above)

*First slice built from the `message` and `channel_session` rows already recorded; the normalised
`send_risk_event` table below is a later refinement, and its evidence currently lives in the
`sender_identity.health` jsonb. The delivery-ratio → speed curve below is now **built as the
continuous scaling** (`deliveryDelayMultiplier` in `@crm/core`, applied in `handleSend`): ×1 at
≥85 %, up to ×4 below 55 %, linear between — plus a degraded sender is held to at least half speed
whatever its delivery, since it may be degraded for failures or disconnects rather than delivery.*

**Delivery tracking.** Sustained delivery below **60%** is a soft-ban signal. Adaptive speed:

| Delivery ratio | Speed |
|---|---|
| ≥ 85% | 100% |
| 55–85% | scaled linearly |
| < 55% | 25% |

**Decrypt failures** ✅ built. 3 "Bad MAC" events within 60 seconds mark the session as diverged
(D-14) and degrade the number. Baileys drops undecryptable frames before the app sees them, so the
adapter taps its logger (`tapDecryptFailures`); the gateway's `DecryptFailureTracker` detects the
burst and writes `channel_session.decrypt_burst_at`; the scorer adds +60 (high band) while the burst
is under 15 minutes old. It lapses by time, so the number recovers without anyone clearing it — the
both-directions rule. A slow drip (under 3 a minute) never trips it.

**Risk score, 0–100**, from typed events, each written to `send_risk_event` so the dashboard
shows evidence rather than a bare number:

| Event | Weight |
|---|---|
| 401 logged out | +60 |
| 403 forbidden | +40 |
| 463 reachout timelock | +25 |
| Frequent disconnects | +15 … +30 |
| Failed sends | +20 |

| Band | Range | Action |
|---|---|---|
| Low | 0–29 | Normal |
| Medium | 30–59 | Warn; reduce new-contact allowance |
| **High** | **60–84** | **Auto-throttle; pause campaigns on this sender; alert** |
| **Critical** | **85–100** | **Quarantine the sender; Critical alert** |

## Layer 6 — Recovery orchestration

| Incident | Pause | Resume at | Weekly ramp |
|---|---|---|---|
| 463 reachout timelock | 24 h | 10% of cap | +15% |
| 429 rate overlimit | 4 h | 25% | +25% |
| Suspected soft ban (delivery collapse) | 48 h | 5% | +10% |
| **Hard ban (401)** | — | **no recovery** — sender retired, operator alerted | — |

## Two classes of gate

This distinction is enforced in code, not convention, and is one of the load-bearing ideas in
the whole design.

**Overridable by an admin, with a logged reason and an audit row:**
- Engagement lock — another agent owns an active conversation with this contact
- Cooldown — contacted too recently
- Duplicate-campaign guard — already in a live campaign

*These protect the recipient's experience. A human with context may legitimately override them.*

**Overridable by nobody, including an admin, with no code path to do so:**
- Per-sender daily cap
- Rate and burst limits
- Warmup ceiling
- `do_not_contact`
- Missing consent for a marketing intent

*These protect a phone number that gets banned, and a legal obligation. They are not policy.*

**Blocked recipients are always reported, never silently dropped.** Every blocked send writes
a `campaign_recipient.skip_reason` and appears in results. Silent dropping is how an operator
loses trust in the whole system.

## Meta-side safety (the other transport)

Different risks, same discipline. Track per sender identity:

- **Messaging tier**: 250/day unverified → 1K → 10K → 100K → unlimited. Meta re-evaluates
  roughly every 6 hours. Advancement requires unique-customer volume over a rolling 7 days:
  500 (→10K), 5,000 (→100K), 50,000 (→unlimited).
- **Quality rating**: High / Medium / Low. Must be Medium or above to be upgraded.
- **Phone number status**: must be `Connected`.

Dispatcher behaviour:
- Never exceed the known tier limit — refuse and queue instead.
- Alert when quality drops to Medium.
- **Hard-stop marketing sends at quality Low**, because continuing to send at Low is exactly
  the feedback loop described at the top of this document. Utility and authentication continue.

## Configuration

Every value above is an `org_setting` with the default shown. Admin-editable within a safe
range; the hard limits above have a ceiling that cannot be raised. Full table in
[`13-deployment.md`](13-deployment.md).

## How this is proven

Not by messaging real people. The **simulation harness** ([`12-testing.md`](12-testing.md)) is
a virtual WhatsApp that implements the ban heuristics at the top of this document and bans you
if you trip them. Campaign scenarios run against it in CI:

- cold number, day-1 blast
- 10k campaign over a warmed number
- reconnect-then-burst
- low-reply-ratio spiral
- multi-worker shared-budget contention

**This is the single highest-value test in the project.** After the simulation passes, a
controlled real-number pilot: one number, 7-day warmup, ≤50 messages/day, watched daily.

## Sources

- [baileys-antiban](https://github.com/kobie3717/baileys-antiban) — rate/warmup/jitter/risk
  parameters and recovery schedules; the most concrete public implementation of these ideas
- [Meta · Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- [Kraya AI · WhatsApp automation ban risk, India 2026](https://blog.kraya-ai.com/whatsapp-automation-ban-risk) — the 68% figure, from an analysis of 600+ Indian SMB accounts
- [Whatsable · WhatsApp spam policy for businesses 2026](https://whatsable.app/blog/whatsapp-spam-policy-explained-for-businesses-in-2026)
- [Achiya · WhatsApp spam detection 2026](https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/) — detection layers
- [Uptail · Message limits, tier progression 2026](https://www.uptail.ai/blog/whatsapp-business-message-limits-2026-broadcast-caps-tier-progression-what-happens-when-you-hit-the-ceiling)
- [Wapisimo · Unofficial API ban risk](https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk)
