# F6 · Anti-ban engine

**Covers** FR-38…FR-46 · **Fixes** M10, M11, M12 · **Tier** V1

The full specification, with every number and its source, is **[`../08-antiban.md`](../08-antiban.md)**.
This file is the feature-level view: what it must do, and how we prove it.

## Purpose

Keep Baileys-connected numbers alive. This is the highest-risk subsystem in the product — the
entire free transport depends on it, and a failure is unrecoverable (a hard-banned number has
no appeal). It is also the clearest differentiator: most unofficial tools hide this problem
rather than engineer against it.

## Acceptance criteria

- **AC-1** Every outbound message passes through the limiter. There is no bypass — `/messages`,
  campaigns, agent replies, automations and the API all converge on `OutboundDispatcher` (M12).
- **AC-2** Caps count **messages**, not campaigns or rounds (M11), per sender identity.
- **AC-3** Inter-send delay is Gaussian-jittered, never a fixed interval (M10).
- **AC-4** A newly linked number follows the warmup ramp and cannot exceed the day's ceiling,
  by any means, including an admin override.
- **AC-5** Gates split into two classes and the distinction is enforced in code:
  admin-overridable (engagement lock, cooldown, duplicate-campaign) and
  **never-overridable by anyone** (daily cap, rate limit, warmup ceiling, DNC, missing consent).
- **AC-6** Blocked recipients are always reported with a reason, never silently dropped.
- **AC-7** Risk score is computed from typed events and every contributing event is inspectable.
- **AC-8** Crossing High auto-throttles and pauses campaigns; Critical quarantines the sender.
- **AC-9** Recovery follows the documented schedule per incident class.
- **AC-10** Token buckets are shared across worker replicas — two workers cannot each spend a
  full budget (M13).
- **AC-11** Meta-side: tier, quality rating and number status are tracked; marketing sends
  **hard-stop** at quality Low.
- **AC-12** 100% unit-test coverage on this package (NFR-22).

## Test cases

The decisive tests run against the **simulation harness** (`../12-testing.md`) — a virtual
WhatsApp that enforces the documented ban heuristics and bans you if you trip them. This is
the only way to validate the engine without risking a real number.

| id | Case | Expect |
|---|---|---|
| TC-6.1 | Day-1 number, 10k campaign | Engine caps at the warmup ceiling; simulation never bans |
| TC-6.2 | Send timing distribution over 1,000 sends | Gaussian, no detectable fixed period |
| TC-6.3 | 5 workers, one sender, cap 200/hour | Total across workers ≤ 200 |
| TC-6.4 | Reply ratio drops below the floor | New-contact allowance shrinks; alert raised |
| TC-6.5 | Provider returns 463 (reachout timelock) | 24 h pause, resume at 10%, ramp +15%/week |
| TC-6.6 | Delivery ratio falls to 50% | Speed drops to 25%; soft-ban signal recorded |
| TC-6.7 | Admin tries to override the daily cap | Rejected — no code path exists |
| TC-6.8 | Admin overrides a cooldown | Allowed, with a logged reason and an audit row |
| TC-6.9 | 2–6 a.m. local time | Near-zero send rate; queue defers rather than draining |
| TC-6.10 | 500 recipients, same template | Bodies vary above the identical-body threshold |
| TC-6.11 | Meta quality drops to Low | Marketing sends stop; utility/auth continue |
| TC-6.12 | Sender at risk 90 | Quarantined; campaigns paused; Critical alert |

## Honest limitation

**The engine reduces ban risk; it cannot eliminate it.** Running Baileys against a normal
number violates WhatsApp's Terms of Service and the account can be banned at any time for
reasons outside our control. This must be stated in the README, in the UI when linking a
number, and in the docs — not buried. Anything the business depends on routes to the official
Cloud API (`../04-architecture.md`, channel routing policy).
