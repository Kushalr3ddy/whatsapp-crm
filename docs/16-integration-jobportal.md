# 16 · Integration: embedding in a host application

The first consumer is a job portal (`Mikhil31/JobPortal`), but nothing here is specific to
recruitment. This document is the worked example of the **embedded** deployment shape from
[`01-vision-scope.md`](01-vision-scope.md).

## Why this shaped the architecture

That project has no application code yet, but it has a rigorous specification — and
`docs/06-comms-layer.md` in it already defines the exact port shape, ownership split and
integration seams a comms layer must satisfy. Rather than invent our own and reconcile later,
the architecture here was designed to satisfy it directly. Integration then becomes
configuration rather than a rewrite.

Its own conclusion is worth recording, because it independently matches ours: the unofficial
transport *"may carry recruiter-driven sourcing; it may not carry anything a client or the
platform's own credibility depends on."* That is precisely the intent-based routing policy in
[`04-architecture.md`](04-architecture.md).

## The ownership split

This is the rule that keeps the CRM generic. **The CRM does not model the host's domain.**

| The host owns | The CRM owns |
|---|---|
| People as domain objects (candidates, customers, patients) | Conversations and messages |
| Jobs, applications, orders, tickets | Sender identities and their health |
| Pipeline stages and stage history | Outreach rounds, campaigns, delivery state |
| Consent and contactability rules | Templates and their approval state |
| Users, roles, permissions | Anti-spam gates and rate limits |
| Contact-release / PII-masking rules | A phone→thread lookup index |

The one deliberate duplication is that lookup index: the CRM must resolve an inbound message
from a phone number without a round-trip to the host on the hot path. **It stores identifiers
only — it is an index, not a profile.**

Any contact-like tables in an older CRM are a *migration source, not a second home.*

## The nine seams

The host spec names nine things a host application must have for this to work. Each maps to
something concrete here:

| # | Seam | In this CRM |
|---|---|---|
| 1 | An outbox table | `message`, with `status` and `provider_message_id` |
| 2 | A template registry | `message_template`, versioned, with typed variables |
| 3 | No direct sends anywhere — one `notify()` entry point | `POST /api/v1/messages` → `OutboundDispatcher`. There is no second path (M12). |
| 4 | A channel-intent field on every template | `message_template.channel_intent`, which drives routing |
| 5 | Consent and do-not-contact queryable pre-send | `consent_record` + `contact.do_not_contact`, or delegated to the host's policy endpoint |
| 6 | Contact release exposed as an **authorization question, not a joined column** | The policy-delegation endpoint in [`15-api.md`](15-api.md). The CRM **asks**; it never imports the rule. |
| 7 | Stable public ids on host entities | `contact.external_ref` = `{system, id}`, GIN-indexed |
| 8 | A `system` actor that already exists | Reserved `system` actor row; no audit entry may have a null actor |
| 9 | One structured, correlated log format | `request_id` propagated across HTTP → queue → worker → provider |

## Two rules that must be *asked*, never *joined*

1. **"May I contact this person for this purpose?"** — consent and do-not-contact.
2. **"May I reveal this number?"** — the host's PII-release rule.

Both are synchronous calls to the host's policy endpoint with a cacheable negative. The CRM
never replicates the logic, because the moment it does, the two systems can disagree — and
they will disagree in the direction of contacting someone who withdrew consent.

## Two classes of gate, preserved

The host spec makes the same distinction the anti-ban engine does, and for the same reason:

- **Admin-overridable with a logged reason** — engagement lock, cooldown, duplicate-role guard.
  These protect the recipient's experience; a human with context may legitimately override.
- **Overridable by nobody** — per-sender daily cap, rate and burst limits. *"The thing they
  protect is not a policy — it is a number that gets banned."*

And in both systems: **blocked recipients are reported, never silently dropped.**

## Integration sequence

```
1. Host creates an API key with contacts:write, messages:send, webhooks:manage
2. Host registers a webhook endpoint and a policy endpoint
3. Host syncs people:  POST /contacts  with external_ref = {system:"portal", id:"..."}
   (identity rules put external_ref first, so re-sync updates rather than duplicates)
4. Host sends:         POST /messages  with an intent and a template key
5. CRM calls the policy endpoint before sending; caches a negative
6. CRM delivers inbound and status events to the webhook
7. Host renders conversation state from its own copy, or embeds the CRM inbox
```

The host never touches the CRM database, and the CRM never reads the host's.

## What the CRM must *not* grow

Stated plainly, because this is how generic software stops being generic:

- **No `candidate`, `job`, `application`, or `stage` tables.** The prior system had all four,
  and they collided directly with the host's model (`00-prior-art.md`).
- **No domain-specific status enums.** Pipelines and stages are user-defined rows.
- **No host-specific business rules in the AI or automation layers.** The prior system's agent
  hardcoded "never reveal the hiring company's name" — a correct rule for a recruitment agency,
  and exactly the kind of thing that must live in the host, expressed as data.
- **No branding.** Configuration, always.
