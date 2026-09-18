# 17 · Roadmap

Each phase is independently demoable, ends with tests green, and ends with a `CONTEXT.md` entry.
Nothing is "done" until its exit criteria are met.

## Phases

| Phase | What | Exit criteria |
|---|---|---|
| **P0 · Docs** ✅ | The full `docs/` set, `CONTEXT.md`, README, capacity calculator | Someone unfamiliar can read `docs/` and know what is being built and why |
| **P1 · Skeleton** ✅ | Monorepo, Compose, Postgres, migrations, config validation, health/ready/metrics, logging, CI (lint incl. the JSDoc rule, typecheck, test), the provider layer + contract suite with `storage` `email` `kms` `secrets` drivers | `docker compose --profile core up` reaches a green `/ready`; CI passes on an empty PR; flipping `STORAGE_DRIVER` changes no application code |
| **P2 · Core domain** | Org/user/RBAC/API keys/audit; `AuthProvider` built-in **and** OIDC (verified against Keycloak in CI); contacts, identities, custom fields, tags; RLS everywhere | Cross-org isolation suite passes; authz matrix green under both auth drivers |
| **P3 · Channels** | `ChannelProvider` port, `fake` adapter, contract suite, `baileys` adapter (Postgres auth store, QR **and** pairing code, reconnect/backoff), gateway process, inbound normalisation, sender identities | Link a real number, send and receive; kill the gateway mid-conversation and lose nothing |
| **P4 · Inbox** | Conversations, messages, encryption + blind index, assignment, collision detection, notes, canned replies, realtime, search | Two agents work one inbox without stepping on each other |
| **P5 · Ingestion** | `SourceConnector` port, Excel/CSV, mapping UI, dry run, identity resolution, merge policies, error ledger, Google Sheets, REST puller, schedules | 50k hostile rows import with a per-row report and no data loss |
| **P6 · Anti-ban** | The full engine + the simulation harness + the sender-health dashboard | Simulation: a 10k campaign completes without tripping the simulated ban heuristics |
| **P7 · Campaigns** | Templates, segments, campaigns, dispatcher, throttling, opt-out, quiet hours, per-recipient status, cost estimate | 10k campaign runs, pauses, resumes, survives a worker restart, zero duplicates |
| **P8 · Meta adapter** | Cloud API adapter, template sync + approval, webhook ingest, 24h window, tier/quality tracking, routing rules, cost report | Both transports live; routing demonstrably picks the cheaper safe path |
| **P9 · API & webhooks** | Public API hardening, OpenAPI, SDK, outbound webhooks with retry/replay/DLQ, policy delegation | An external app drives the CRM end to end using only the docs |
| **P10 · Automation & analytics** | Rules, auto-replies, classification with locale packs, sequences, dashboards | Drip sequence runs; analytics reconcile against raw message rows |
| **P11 · Hardening** | Load, security, chaos, backup/restore drill, runbooks, dashboards, docs pass; **measure real footprints and replace the calculator's estimates** | All gates green; restore drill succeeds from cold; `lean` runs the Solo tier inside 2 GB |
| **P12 · Release** | Versioning, changelog, upgrade guide, one-click templates, demo instance | A stranger self-hosts it in under 10 minutes from the README alone |

## Feature tiers

| Module | V1 | V2 | V3 |
|---|---|---|---|
| F1 Channels | Baileys, Meta, fake, QR + pairing, multi-number, reconnect | Sender pools, proxy binding | SMS / email / Telegram |
| F2 Contacts | CRUD, identities, custom fields, tags, dedup/merge, segments | Enrichment, bulk edit, duplicate finder | Scoring, lookalikes |
| F3 Inbox | Threads, assignment, collision, notes, canned replies, search, realtime | SLA, routing rules, working hours, saved views | Sentiment, auto-summary |
| F4 Templates | Versioned, typed variables, Meta sync, locales, spintax | Media headers, buttons, lists, carousels, A/B | Flows builder |
| F5 Campaigns | Segments, schedule, dry run, throttle, pause/resume, opt-out, quiet hours | Drip, retargeting, A/B, recurring, approval workflow | Send-time optimisation, journeys |
| F6 Anti-ban | Full engine | Cross-instance budget, per-number proxy, predictive risk | — |
| F7 Ingestion | Excel/CSV, mapping UI, dry run, error ledger, Sheets, REST, webhook, schedules | DB source, CRM connectors, Airbyte-compatible | CDC streaming |
| F8 API | REST, keys, OpenAPI, webhooks, SDK, policy delegation | GraphQL, SSO, per-endpoint quotas | Plugin registry |
| F9 Automation | Opt-out, keyword replies, business hours, classification rules | Visual builder, branching, HTTP action | Journey orchestration |
| F10 Analytics | Funnel, campaign, agent, sender health, cost report | Cohorts, attribution, custom dashboards | Forecasting, anomalies |
| F11 Admin | Users, roles, branding, policy, retention, audit viewer, providers | Org provisioning, quotas, SSO, IP allowlist | Billing |
| F12 AI agent | **seam only** | Summarisation, tagging, suggested replies | Autonomous with handoff |

## Open decisions

| # | Decision | Blocks | Status |
|---|---|---|---|
| 1 | **Licence** — AGPL-3.0 (protects against a hosted competitor) vs MIT (maximum adoption) | Nothing technical; needed before public release | ADR-0001, open |
| 2 | **Baileys version to pin** — 7.x is a release candidate (`7.0.0-rc14`) with breaking changes; last stable Nov 2025 | P3 | ADR-0002, open |
| 3 | **Meta onboarding** — who owns the WhatsApp Business Account, when Business Verification starts (it gates the messaging tiers) | P8 | Not a code decision; open |
| 4 | **Direct Cloud API vs a BSP** — direct is cheaper with no markup; a BSP simplifies onboarding | P8 | Open, follows #3 |
| 5 | **Does F12 ship in V2** or stay a seam indefinitely | Nothing in V1 | Open |
| 6 | **Keep two queue drivers** (pg-boss + BullMQ) or standardise on one | P1 | Revisit at P11 with real numbers |

## Explicitly not planned

Commerce (catalogue, cart, payments) · voice and video · becoming a BSP · native mobile apps ·
multi-tenant SaaS business operations (billing, plans, signup funnels — the *schema* is ready,
the business is not built) · a visual journey builder before the primitives beneath it are solid.
