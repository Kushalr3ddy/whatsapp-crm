# F9 · Automation

**Covers** FR-63, FR-64 · **Fixes** M32 · **Tier** V1 partial (sequences and the visual
builder are V2)

## Purpose

Handle the predictable parts of a conversation without a human, and without an LLM. Most of
what the old system used an AI agent for — classifying "yes I'm interested" — is better done
by rules that are fast, free, deterministic and inspectable.

## Scope by tier

| | V1 | V2 | V3 |
|---|---|---|---|
| Opt-out keyword handling | ✅ | | |
| Keyword auto-reply | ✅ | | |
| Business-hours / away auto-reply | ✅ | | |
| Reply classification rules | ✅ | | |
| Stage-change and tag triggers | ✅ | | |
| Drip sequences | | ✅ | |
| Conditional branching, HTTP action step | | ✅ | |
| Visual rule builder | | ✅ | |
| Full journey orchestration | | | ✅ |

## Design notes

**Opt-out is evaluated first, always.** Before any other rule, before any AI, before anything.
It is irreversible without an explicit human action, and it must work in the languages the
contacts actually use — the old system handled "a couple of English phrasings" (M32).

**Rules carry locale packs.** English, Hindi and Hinglish at minimum for the India case
("haan", "nahi", "baad mein", "call me", "busy"). Packs are data, editable by the operator,
not code.

**Every match records which rule fired.** The UI shows "matched rule: interested-affirmative"
or "no rule matched, defaulted to replied", so an operator can tell a confident classification
from a guess (M32). Without this, users stop trusting the whole feature.

**A human override always exists**, and correcting a classification is a signal worth keeping
for later rule tuning.

## Acceptance criteria

- **AC-1** Opt-out keywords are matched before every other rule and set `do_not_contact`
  irreversibly (an admin can only clear it with an explicit, audited action).
- **AC-2** Opt-out works across configured locale packs, including transliterated Hinglish.
- **AC-3** Classification records the matched rule id, or explicitly records that nothing matched.
- **AC-4** An agent can override any classification; the override is audited.
- **AC-5** Auto-replies respect business hours, quiet hours and the Meta service window.
- **AC-6** An auto-reply can never trigger another auto-reply (loop guard), and never fires
  more than once per conversation per window.
- **AC-7** Rules are ordered by priority and the first match wins, deterministically.
- **AC-8** Automations pass through `OutboundDispatcher` like every other producer — no bypass.

## API surface

```
GET    /api/v1/automation-rules
POST   /api/v1/automation-rules
PATCH  /api/v1/automation-rules/{id}
POST   /api/v1/automation-rules/{id}/test    {sample_message} → would-match result
GET    /api/v1/locale-packs
POST   /api/v1/conversations/{id}/classify   manual override
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-9.1 | "STOP" | DNC set, confirmation sent, all pending sends cancelled |
| TC-9.2 | "band karo" / "mujhe nahi chahiye" | Same as TC-9.1 via the Hindi pack |
| TC-9.3 | "haan interested hu" | Classified affirmative; matched rule shown |
| TC-9.4 | "asdkjh" | No rule matched; recorded as defaulted, not as a confident result |
| TC-9.5 | Auto-reply triggers a contact's own auto-reply | Loop guard stops it after one exchange |
| TC-9.6 | Inbound at 3 a.m. | Away reply only if configured; otherwise queued for business hours |
| TC-9.7 | Two rules both match | Higher priority wins, deterministically, every time |
| TC-9.8 | Agent overrides a classification | Audited; original preserved |
