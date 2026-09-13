# Repository structure

Directories are scaffolded but **empty** — no code has been written yet (P0 is docs only).
This file records what belongs where, so the first commit of code lands in the right place.

```
apps/
  api/        NestJS HTTP layer. Auth, validation, OpenAPI. THIN — no business logic.
  worker/     Queue consumers. THIN — orchestration only.
  gateway/    Baileys socket supervisor. Owns sockets and auth state, nothing else.
  web/        Next.js UI. A client of the public API, nothing more.

packages/
  shared/     Types, Zod schemas, errors, Result types, E.164 helpers. Imports nothing.
  db/         Drizzle schema, migrations, repositories, RLS helpers.
  core/       Domain logic — contacts, conversations, campaigns, policy, dispatcher.
              May import PORTS; may never import a concrete adapter.
  antiban/    The engine: limiter, warmup, pacing, risk scoring, recovery. 100% covered.
  ingestion/  The SourceConnector port.
    connectors/{excel,csv,gsheets,rest,webhook}/
  channels/   The ChannelProvider port.
    {baileys,meta,fake}/
  providers/  Infrastructure drivers, one directory per port (docs/18-providers.md).
    {storage,auth,queue,cache,email,sms,llm,kms,secrets,scanner}/
  sdk/        Generated typed API client.

infra/
  docker/     Dockerfiles.
  compose/    docker-compose.yml + per-profile overlays (docs/13-deployment.md).
  scripts/    setup, migrate, backup, restore-drill, context-append.
  grafana/    Dashboard JSON — shipped whether or not Grafana is running.
  prometheus/ Scrape config and alert rules.

tests/
  contract/   One conformance suite per port. Every adapter and driver must pass.
  e2e/        Playwright. Runs against all three presets.
  simulation/ The virtual WhatsApp that bans you if you misbehave. Highest-value test here.
  load/       k6 scenarios.
  fixtures/   Synthetic data generators. NEVER real PII (docs/00-prior-art.md, M19).

config/       preset.yml and driver configuration.
docs/         The design. Start at docs/README or the table in ../README.md.
```

## The dependency rule

Lint-enforced via `no-restricted-imports`:

```
apps/*    →  core, shared, db, sdk
core      →  shared, db, PORTS only — never a concrete adapter
adapters  →  shared (+ their own vendor SDK)
db        →  shared
shared    →  nothing
```

`core` may import `ChannelProvider`. It may never import `baileys`. Adapters are injected at
the composition root. This is the rule that makes every adapter swappable and testable — and
it is the one the previous system lacked, which is why its transport client was imported
directly by five modules (`docs/00-prior-art.md`, M1).
