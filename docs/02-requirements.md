# 02 · Requirements

Numbered so everything downstream — features, tests, acceptance criteria — can cite them.
`FR` functional, `NFR` non-functional, `CON` constraint. Priority: **V1** must ship,
**V2** next, **V3** later.

## Constraints (non-negotiable, mostly external)

| id | Constraint | Consequence |
|---|---|---|
| CON-1 | Baileys is unofficial and violates WhatsApp's ToS; any number can be banned without appeal | Anti-ban engine is mandatory, not a feature. Business-critical traffic routes to the official API. |
| CON-2 | Meta charges per template message and enforces messaging tiers (250 → 1k → 10k → 100k → unlimited) and a quality rating | The dispatcher must track tier and quality and refuse to exceed them |
| CON-3 | Meta's 24-hour service window: freeform messages are only legal inside it | Capability declaration per provider; the dispatcher decides template vs freeform, never the caller |
| CON-4 | Meta webhooks require a 2xx within ~3 s and retry with backoff for up to 7 days | Webhook handler verifies, enqueues, returns. No processing inline. |
| CON-5 | Operators are subject to **their own jurisdiction's** messaging/consent law (DPDP, GDPR, TCPA, …) — the product bakes in none of them | Provide jurisdiction-neutral tooling: `do_not_contact`, opt-out handling, audit trail, export/erasure. Enforce no specific regime; compliance is the operator's |
| CON-6 | Must run entirely on free, self-hostable software | Every paid dependency has a free default driver |
| CON-7 | Must be operable by one person on one VPS | `lean` preset; no component required that a single operator cannot reason about |
| CON-8 | Baileys 7.x is currently a release candidate with breaking changes | Pin an exact version; keep the adapter surface thin |

## Functional requirements

### Contacts & identity
| id | Requirement | Pri |
|---|---|---|
| FR-1 | Contacts with user-defined custom fields (typed, with per-field merge policy) | V1 |
| FR-2 | A contact has many identities (`phone`, `email`, `wa_jid`, `wa_lid`, `external`); inbound resolves on identity, not on the contact row | V1 |
| FR-3 | Phone numbers normalised to E.164 at every boundary, with a per-source default country | V1 |
| FR-4 | Tags, notes, owner assignment, lifecycle stage | V1 |
| FR-5 | Duplicate detection and a merge flow with a preview of what would be overwritten | V1 |
| FR-6 | Static lists and dynamic segments (saved filters) | V1 |
| FR-7 | `do_not_contact` flag with reason and timestamp, honoured by every send path | V1 |
| FR-8 | **Optional** per-contact consent/opt-in record (source, evidence, timestamp) the operator maps to their own jurisdiction — not tied to any regime | V2 |
| FR-9 | Contact data export and per-contact delete — the mechanism for any "remove my data" request, whatever regime requires it | V2 |

### Channels & sessions
| id | Requirement | Pri |
|---|---|---|
| FR-10 | Baileys adapter: link a number by QR **and** by pairing code | V1 |
| FR-11 | Auth state persisted in Postgres, never on local disk; sessions auto-restore on boot | V1 |
| FR-12 | Multiple numbers per install, each owned by a user, with admin reassignment | V1 |
| FR-13 | Automatic reconnect with exponential backoff, typed disconnect classification, alert if down > 5 min | V1 |
| FR-14 | Meta Cloud API adapter: send, receive, delivery status, 24h window tracking | V1 |
| FR-15 | Per-provider capability declaration; the dispatcher refuses sends the capabilities forbid | V1 |
| FR-16 | Intent-based routing between transports, with a per-org rule table | V1 |
| FR-17 | Sender pools with weighted rotation | V2 |
| FR-18 | Additional channels (SMS, email, Telegram) behind the same port | V3 |

### Inbox & conversations
| id | Requirement | Pri |
|---|---|---|
| FR-19 | Threaded two-way conversations, scoped per conversation (never per contact) | V1 |
| FR-20 | Assignment to an agent; open / pending / snoozed / closed | V1 |
| FR-21 | Collision detection — an agent sees when another is viewing or typing in the same thread | V1 |
| FR-22 | Internal notes with @mentions, invisible to the contact | V1 |
| FR-23 | Canned replies with variable substitution | V1 |
| FR-24 | Full-text search across messages and contacts | V1 |
| FR-25 | Media send and receive, stored via the storage driver | V1 |
| FR-26 | Realtime updates across connected agents | V1 |
| FR-27 | SLA timers, routing rules (round-robin / load / skill), working hours | V2 |

### Templates & campaigns
| id | Requirement | Pri |
|---|---|---|
| FR-28 | Versioned templates with typed variables, preview, category and locale | V1 |
| FR-29 | Meta template sync and approval-status polling | V1 |
| FR-30 | Campaigns targeting a segment or explicit list, scheduled, with quiet hours and timezone | V1 |
| FR-31 | Dry run showing recipient count, estimated cost, estimated duration and risk assessment | V1 |
| FR-32 | Pause, resume, cancel; per-recipient status with an explicit `skip_reason` | V1 |
| FR-33 | Opt-out keywords (multi-language) honoured automatically and irreversibly | V1 |
| FR-34 | Campaign survives a worker restart with no duplicate sends | V1 |
| FR-35 | Drip sequences with delays, conditions and exit rules | V2 |
| FR-36 | A/B variants, retargeting on non-response, recurring campaigns | V2 |
| FR-37 | Interactive messages — buttons, lists, carousels, Flows | V2/V3 |

### Anti-ban (detail in `08-antiban.md`)
| id | Requirement | Pri |
|---|---|---|
| FR-38 | Per-number warmup ramp from link date | V1 |
| FR-39 | Rate limits per minute / hour / day with Gaussian jitter, enforced across all workers | V1 |
| FR-40 | Typing simulation and circadian pacing | V1 |
| FR-41 | Contact-graph gates: stranger multipliers, new-contact throttle, reply-ratio floor | V1 |
| FR-42 | Risk scoring from typed disconnect and delivery signals, with auto-throttle and auto-pause | V1 |
| FR-43 | Recovery orchestration per incident class | V1 |
| FR-44 | Policy gates with a hard distinction between admin-overridable and never-overridable | V1 |
| FR-45 | Blocked recipients are always reported, never silently dropped | V1 |
| FR-46 | Meta-side tier, quality-rating and status tracking, with a hard stop on marketing at Low | V1 |

### Ingestion (detail in `07-ingestion.md`)
| id | Requirement | Pri |
|---|---|---|
| FR-47 | Connector framework: a new source type is one class plus a config schema | V1 |
| FR-48 | Excel/CSV import, entirely server-side, streaming, never through the browser | V1 |
| FR-49 | Column-mapping UI driven by `discover()`, with reusable saved mappings | V1 |
| FR-50 | Mandatory dry run with a diff preview before any write | V1 |
| FR-51 | Per-row error ledger; failed rows downloadable as a corrections file | V1 |
| FR-52 | Configurable ordered identity-resolution rules and per-field merge policies | V1 |
| FR-53 | Google Sheets, generic REST puller, inbound webhook source | V1 |
| FR-54 | Scheduled incremental syncs with cursors | V1 |
| FR-55 | Idempotent and resumable — a killed worker resumes from the last committed batch | V1 |

### API & extensibility
| id | Requirement | Pri |
|---|---|---|
| FR-56 | Versioned REST API covering everything the UI can do | V1 |
| FR-57 | API keys, hashed at rest, scoped, rotatable, per-key rate limits | V1 |
| FR-58 | OpenAPI 3.1 generated from the code, so it cannot drift | V1 |
| FR-59 | `Idempotency-Key` honoured on every POST that sends or spends | V1 |
| FR-60 | Signed outbound webhooks, at-least-once, with retry, replay and a dead-letter queue | V1 |
| FR-61 | A policy-delegation hook so a host app can own consent and contactability | V1 |
| FR-62 | Typed client SDK | V1 |

### Automation, analytics, admin
| id | Requirement | Pri |
|---|---|---|
| FR-63 | Keyword auto-reply, business-hours auto-reply, stage-change triggers | V1 |
| FR-64 | Reply classification via configurable rules with locale packs, a human override, and the matched rule surfaced | V1 |
| FR-65 | Delivery/read/reply funnel, campaign performance, agent productivity, sender health | V1 |
| FR-66 | Cost report: Meta spend by category against free Baileys volume | V1 |
| FR-67 | Users, roles, permissions; configurable branding; audit-log viewer | V1 |
| FR-68 | Configurable retention with a hard-delete job | V1 |
| FR-69 | `GET /admin/providers` showing the active driver, health and last error per port | V1 |

## Non-functional requirements

### Performance & capacity
| id | Requirement |
|---|---|
| NFR-1 | API p95 < 300 ms, p99 < 1 s for read endpoints at the Small-team tier |
| NFR-2 | Inbox message delivery to a connected agent < 1 s from provider receipt |
| NFR-3 | Ingest ≥ 1,000 rows/second on the Small-team tier |
| NFR-4 | A 10,000-recipient campaign enqueues in < 5 s (execution is deliberately slow — see CON-1) |
| NFR-5 | `lean` preset runs the Solo tier within **2 GB RAM**, enforced by a CI memory-limit test |
| NFR-6 | No HTTP request performs unbounded work; everything long-running is a job with progress |

### Reliability
| id | Requirement |
|---|---|
| NFR-7 | No message is sent twice, ever — idempotency on `provider_message_id` and job keys |
| NFR-8 | No inbound message is lost: raw payloads persisted before processing and replayable |
| NFR-9 | A poison message is quarantined after N attempts and never takes down a session (M26) |
| NFR-10 | Killing any process mid-campaign loses no state and creates no duplicates |
| NFR-11 | RPO ≤ 24 h, RTO ≤ 1 h, proven by a restore drill that runs in CI |
| NFR-12 | Zero-downtime deploys: expand → migrate → contract, health-gated, auto-rollback |

### Security & privacy
| id | Requirement |
|---|---|
| NFR-13 | Message bodies and contact identifiers encrypted at rest, with versioned keys and online rotation |
| NFR-14 | Tenant isolation enforced by Postgres RLS, asserted per table by tests |
| NFR-15 | No secret in code, image or logs; config validated at boot with a hard crash if incomplete |
| NFR-16 | All user-supplied URLs SSRF-guarded (webhooks, REST sources) |
| NFR-17 | Every state change produces an audit row with a non-null actor |
| NFR-18 | PII redacted from logs by field allowlist |

### Operability & maintainability
| id | Requirement |
|---|---|
| NFR-19 | Install to working instance in < 10 minutes following the README alone |
| NFR-20 | Every alert links to a runbook entry that says what to do |
| NFR-21 | Every class, function, exported constant and type carries a 1–4 line comment, lint-enforced |
| NFR-22 | ≥ 80% coverage on core; **100% on the anti-ban engine and the dispatcher** |
| NFR-23 | Adding a channel, source or infrastructure driver requires no change to calling code |
| NFR-24 | The free/`lean` path is the primary tested path in CI |
| NFR-25 | Accessibility: WCAG 2.1 AA for the inbox and campaign builder |
