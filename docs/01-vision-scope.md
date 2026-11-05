# 01 · Vision & scope

## The one-line version

A conversation and outreach platform for WhatsApp that anyone can self-host, that makes no
assumptions about your business, and that treats WhatsApp as one adapter behind a port.

## The problem

Teams that run their business on WhatsApp end up in one of three bad places:

1. **A personal phone.** No history when someone leaves, no assignment, no reporting, no
   opt-out tracking, and a compliance exposure nobody has thought about.
2. **A SaaS WhatsApp CRM.** Wati, AiSensy, Interakt and the rest work well, but you rent
   your conversation history, pay a 12–20% markup on top of Meta's per-message rate, and
   cannot run the thing on your own infrastructure or extend it beyond what their roadmap
   allows.
3. **A bespoke internal tool.** Which becomes `docs/00-prior-art.md`.

The gap: **a self-hostable, API-first, genuinely generic messaging CRM that supports both
the free unofficial transport and the paid official one, with the anti-ban engineering the
free path actually requires.**

## Who it is for

| Persona | What they need | What they'll judge it on |
|---|---|---|
| **Solo operator / small agency** | One number, a few hundred contacts, bulk outreach that doesn't get them banned | Does it install in 10 minutes on a €5 VPS and not get my number killed |
| **Small team (3–15 agents)** | Shared inbox, assignment, no two agents replying at once, basic reporting | Does the inbox feel as fast as WhatsApp Web |
| **Developer embedding it** | A real API, webhooks, no surprises | Can I drive the whole thing without reading the source |
| **Self-hosting engineer** | Predictable resources, backups that work, upgrades that don't break | Can I reason about what it will cost and what happens when it breaks |

The first three are the v1 audience. The fourth is the one who decides whether it survives.

## Principles

1. **Channel-agnostic core.** The word "WhatsApp" appears in `packages/channels/*`, in
   migrations for channel-specific columns, and nowhere else in the core.
2. **Nothing domain-specific in the schema.** No `candidate`, no `job`, no `deal`. Pipelines,
   stages, custom fields and tags are user-defined rows, never enums in code.
3. **One send path.** Every outbound message — campaign, agent, human reply, API call,
   automation — passes the same dispatcher, the same policy gates, the same rate limiter.
   This is not a style preference; it is the only way the anti-ban guarantees hold (M12).
4. **API-first.** The web UI is a client of the public API. If the UI can do it, the API can
   do it. No private endpoints the UI alone enjoys.
5. **Free by default, paid by choice.** Every external resource has a free self-hostable
   driver and a managed alternative. No paid service is ever required to run the product.
6. **Small by default.** The default install is the smallest useful thing. Telemetry, LLM,
   object storage, Redis and antivirus are all opt-in, because a 2 GB box should not spend
   half its memory watching itself.
7. **Honest about risk.** The docs say plainly that Baileys can get a number banned, that
   the engine reduces but cannot eliminate that, and that compliance is the operator's
   responsibility.

## Scope

### In scope for v1

Shared inbox and contacts · bulk campaigns with the full anti-ban engine · pluggable data
ingestion · public API and webhooks · both WhatsApp transports with intent-based routing ·
templates · opt-out handling · single-tenant deploy on a multi-tenant-ready schema.

### Explicitly out of scope

- **Being an ATS, a helpdesk, or a sales CRM.** No domain objects. Others build those on top.
- **Being a BSP.** We talk to Meta; we do not resell WhatsApp access.
- **Commerce** — catalogue, cart, WhatsApp Pay. Region-locked and a product in itself.
- **Voice and video.**
- **A visual journey builder**, before the primitives underneath it are solid.
- **Mobile apps.** The web UI is responsive; that is the v1 answer.
- **Multi-tenant SaaS operations** — billing, plan limits, signup funnels. The *schema* is
  ready; the business around it is not built.

### Deliberately deferred

| Thing | Why deferred | Seam kept |
|---|---|---|
| AI agent (F12) | The heaviest dependency, the least certain value, and an unresolved privacy question | `LlmDriver` port; the agent is just another producer writing into the same outbox |
| Multi-tenancy in operation | No second tenant yet | `org_id` + RLS on every table from migration 1 |
| Kubernetes | One VPS covers the v1 audience | 12-factor, stateless, health endpoints — a Helm chart is additive |
| Channels beyond WhatsApp | Focus | `ChannelProvider` port with capability declaration |

## Market research

Moved to [`03-competitive-analysis.md`](03-competitive-analysis.md#market-research-2026-10-10--what-the-others-have-that-we-do-not)
(the 2026-10-10 pass: who was looked at, the feature gaps, the interface patterns worth copying with their
screenshots, pros and cons, and what it suggests building next).

## Two deployment shapes, one codebase

| | Standalone | Embedded in a host app |
|---|---|---|
| Contact system of record | The CRM | The host; CRM contacts carry `external_ref` and sync |
| Pipelines | User-defined in the CRM | Usually unused; the host owns stages |
| Auth | CRM's own users, or an external IdP | Host app via API key / OIDC |
| Consent & do-not-contact | CRM's own store | Delegated to the host via a policy endpoint, with a cached negative |

`16-integration-jobportal.md` works the embedded case through in detail.

## What success looks like

- A stranger self-hosts it from the README alone in under 10 minutes.
- The `lean` preset runs the Solo tier inside 2 GB, proven by a CI memory-limit test.
- A developer drives the full product through the API without reading application source.
- A 10,000-recipient campaign completes over warmed numbers without a ban, and the
  the tests catch it if the policy ever regresses.
- Someone forks it, writes a `SourceConnector` and a `StorageDriver`, and never touches core.
