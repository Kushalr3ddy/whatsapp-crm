# 04 · Architecture

## Shape

A **modular monolith with a detached gateway**. One deployable codebase, internally split
into modules with enforced boundaries; the only separate process is the WhatsApp gateway,
because it owns long-lived stateful sockets that cannot be load-balanced or restarted casually.

Not microservices: one operator, one VPS, and the failure modes of a distributed system buy
nothing here. Not a single process either: the gateway must be able to stay up while the API
redeploys.

## Topology

```
                        Caddy (auto-TLS)
                              │
          ┌───────────────────┼────────────────────┐
          │                   │                    │
        web              core-api            webhook edge
      Next.js             Express           POST /wh/{provider}
                              │                    │
                              └─────────┬──────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          │   Queue (pg-boss | BullMQ)│
                          └─────────────┬─────────────┘
                                        │
      ┌───────────────┬─────────────────┼──────────────┬───────────────┐
      │               │                 │              │               │
 worker-send    worker-ingest    worker-automation   worker-webhook   wa-gateway
 (dispatcher)   (imports,sync)   (sequences,sched)   (outbound wh)    (Baileys sockets)
      └───────────────┴─────────────────┴──────────────┴───────────────┘
                                        │
                                 PostgreSQL 16
                          (+ Redis, storage — driver-dependent)
```

In the `lean` preset every box above except `wa-gateway` and Postgres runs **in one Node
process** (`PROCESS_ROLE=all`). In `standard` they split. Nothing in the code knows which.

### Why the gateway is separate

- Baileys holds an authenticated WebSocket per number with in-memory crypto state. A restart
  costs a reconnect and risks a session-health penalty, so it must not restart when the API does.
- It is the only component that can be killed by a third party's bug (M26). Isolating it means
  a crash there cannot take the API down.
- It is deliberately **dumb**: it owns sockets and auth state and knows nothing about contacts,
  campaigns, policy or consent. It consumes send commands and publishes normalised events.
  All policy lives in the dispatcher, on the other side of the queue.

## Module boundaries

```
packages/
  shared/      types, zod schemas, errors, result types, phone/E.164 utils
  db/          drizzle schema, migrations, repositories, RLS helpers
  core/        domain logic — contacts, conversations, campaigns, policy, dispatcher
  antiban/     the engine: limiter, warmup, pacing, risk, recovery
  ingestion/   the SourceConnector port + connectors
  channels/    the ChannelProvider port + baileys | meta | fake
  providers/   infrastructure drivers: storage auth email sms llm kms secrets scanner
  sdk/         generated typed API client
apps/
  api/         HTTP, auth, validation, OpenAPI. Thin — no business logic.
  worker/      queue consumers. Thin — orchestration only.
  gateway/     Baileys socket supervisor.
  web/         Next.js UI. A client of the public API, nothing more.
```

**Dependency rule, lint-enforced** (`no-restricted-imports`):

```
apps/*  →  core, shared, db, sdk
core    →  shared, db, and PORTS only (never a concrete adapter)
channels/*, providers/*, ingestion/*  →  shared (+ their own SDK)
db      →  shared
shared  →  nothing
```

`core` may import `ChannelProvider`; it may never import `baileys`. Adapters are injected at
composition root. This is M1's rule, and it is what makes every adapter swappable and testable.

## The ports

Five ports carry the whole extensibility story.

### `ChannelProvider` — a messaging transport

Shaped deliberately to match the job portal's `docs/06-comms-layer.md` §3.1, so that
integration is configuration rather than a rewrite.

```ts
interface ChannelProvider {
  readonly capabilities: {
    freeformOutsideWindow: boolean;    // baileys true, meta false
    sessionWindowHours: number | null; // baileys null, meta 24
    requiresApprovedTemplate: boolean;
    supportsDeliveryReceipts: boolean;
    supportsMedia: boolean;
    supportsInteractive: boolean;
    perSenderDailyCap: number | null;
    costPerMessage: boolean;
  };
  send(sender, to, content): Promise<ProviderMessageId>;
  inbound(): AsyncIterable<NormalisedInboundEvent>;
  status(): AsyncIterable<NormalisedStatusEvent>;
  health(): Promise<ProviderHealth>;
}
```

`content` is **always** `template(key, variables)` or `freeform(text, media?)`. The dispatcher
decides which is legal from the capability declaration plus the conversation's
`last_inbound_at` — **never the caller**. This is why official and unofficial WhatsApp cannot
hide behind one uniform `send(text)`: the 24-hour window and template pre-approval are policy
differences that legitimately leak into the product.

### `SourceConnector` — a place data comes from
See `07-ingestion.md`.

### `StorageDriver`, `AuthProvider`, `QueueDriver`, and the rest
See `18-providers.md`.

## The one send path

Everything outbound converges here. This is M12's rule and the foundation of every anti-ban
guarantee — a bypass anywhere invalidates the whole engine.

```
producer (campaign | agent reply | automation | API | AI agent)
      │
      ▼
OutboundDispatcher.enqueue(intent, contact, content, sender?)
      │
      ├─ 1. Policy gates    do_not_contact → consent for intent → engagement lock
      │                     → cooldown → duplicate-campaign guard
      │                     (blocked ⇒ recorded with a skip_reason, never silently dropped)
      ├─ 2. Route           intent + sender health + cost rules ⇒ provider + sender identity
      ├─ 3. Capability      template vs freeform legality, window check, media support
      ├─ 4. Render          template + variables ⇒ body (spintax, per-recipient variation)
      └─ 5. Enqueue         job keyed idempotently on (campaign, contact, template_version)
                │
                ▼
        worker-send  ──► antiban.acquire(sender)   token bucket, warmup, circadian,
                │                                   contact-graph multiplier, jitter
                ├──────► typing simulation
                ├──────► provider.send(...)
                ├──────► persist message + provider_message_id
                └──────► on failure: classify → retry w/ backoff → DLQ after N
                                   → feed risk score → maybe auto-throttle/pause sender
```

## Key flows

### Inbound message
```
provider webhook or socket event
  → verify signature over RAW bytes (Meta: X-Hub-Signature-256 vs app secret)
  → persist inbound_event_raw
  → 200 within 3s  (CON-4)
  → enqueue
  → worker: dedupe on provider_message_id (idempotency key)
          → resolve contact_identity → contact (create if unknown)
          → attach to conversation (open one if none)
          → decrypt-free storage: body_enc + body_hmac
          → run automations: opt-out keywords FIRST, then rules
          → update window_expires_at, reply-ratio stats, sender health
          → emit realtime event + outbound webhook
```

Opt-out is evaluated before anything else and is irreversible without explicit human action.

### Campaign execution
```
create (draft) → dry run (count, cost, duration, risk) → schedule
  → worker: expand segment → snapshot recipients (campaign_recipient rows)
  → per recipient: dispatcher.enqueue with an idempotent job key
  → the anti-ban limiter paces execution; a 10k campaign takes days by design
  → pause/resume/cancel act on the queue, not the DB rows
  → sender risk crossing High auto-pauses the campaign on that sender and alerts
```

### Session lifecycle
```
boot → load auth state from Postgres → connect → restore
link → QR or pairing code → auth state written to Postgres per key
disconnect → classify (401 logged-out / 403 / 408 / 429 / 463 / 515 …)
           → backoff, or quarantine, or retire the sender
           → feed risk score; alert if down > 5 min
```

## Cross-cutting decisions

| Decision | Choice | Why |
|---|---|---|
| Tenancy | `org_id` on every table + Postgres RLS from migration 1 | Retrofitting tenancy means touching every table and query. RLS means a forgotten `WHERE` is a denied read, not a leak. |
| IDs | UUID v7 | Time-sortable, index-friendly, no coordination |
| Time | UTC RFC3339 everywhere; localise only in the UI | M25 |
| Money | integer micros + currency code | Never floats |
| Errors | RFC 7807 problem+json with stable machine-readable codes | Clients can branch on them |
| Config | one Zod schema, validated at boot, hard crash if incomplete | M17 |
| State | no mutable module state; locks and buckets in the cache driver | M13 |
| Migrations | forward-only, expand → migrate → contract | Zero-downtime deploys |
| Audit | every state change writes an audit row with a non-null actor; a reserved `system` actor exists | Nothing is ever "who did this?" |

## Failure isolation

The lesson of M26, stated as architecture rather than as a bug fix:

- Every send is a job with its own error boundary. A throw affects one recipient.
- Failures are **classified** — transient (retry with backoff), permanent (fail the recipient,
  continue the campaign), or poison (quarantine after N attempts, never re-attempt).
- Session health is computed from aggregate signals, never from a single send.
- The gateway supervises sockets independently of the work flowing through them.
- Any recipient a provider rejects is recorded with a reason and surfaced in campaign results.

## Diagrams to produce during P1

ERD (`05-data-model.md`) · dispatcher sequence · inbound sequence · session state machine ·
campaign state machine · deployment topology per preset. Source kept as Mermaid in the docs
so they cannot drift from review.
