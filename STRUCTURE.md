# Repository structure

> This is the short sketch. **To find any file or symbol, query the CodeGraph index: `codegraph explore "<question or symbol names>"`** (build it with `codegraph init .`).

What belongs where. Empty placeholder packages (worker, sdk, a separate antiban package, the
Meta channel, ingestion connectors, unused provider drivers) were removed on 2026-10-26; the
anti-ban policy lives in `packages/core`.

```
apps/
  api/        Express HTTP layer. Auth, validation, OpenAPI. THIN — no business logic.
  gateway/    Baileys socket supervisor. Owns sockets and auth state, nothing else.
  web/        Next.js UI. A client of the public API, nothing more.

packages/
  shared/     Types, Zod schemas, errors, Result types, E.164 helpers. Imports nothing.
  db/         Drizzle schema, migrations, repositories, RLS helpers.
  core/       Domain logic — contacts, conversations, campaigns, policy, dispatcher.
              May import PORTS; may never import a concrete adapter.
              Includes the anti-ban policy (antiban.ts and antiban/); the send lane is in apps/gateway/src/lane.ts.
  baileys/    Vendored Baileys 7.0.0-rc14 source (WhatsApp Web client). Rebuild: npm run baileys:build.
  channels/   The ChannelProvider port.
    {baileys,fake}/
  providers/  Infrastructure drivers, one directory per port (docs/18-providers.md).
    {storage,auth,llm,kms}/

infra/
  docker/     Dockerfiles.
  compose/    docker-compose.yml + per-profile overlays (docs/13-deployment.md).
  scripts/    setup, migrate, backup, restore-drill, context-append.

tests/
  contract/   One conformance suite per port. Every adapter and driver must pass.
  e2e/        Playwright. Runs against all three presets.
  fixtures/   Synthetic data generators. NEVER real PII (docs/00-prior-art.md, M19).

docs/         The design. Start at docs/README or the table in ../README.md.
```

## The dependency rule

Lint-enforced via `no-restricted-imports`:

```
apps/*    →  core, shared, db
core      →  shared, db, PORTS only — never a concrete adapter
adapters  →  shared (+ their own vendor SDK)
db        →  shared
shared    →  nothing
```

`core` may import `ChannelProvider`. It may never import `baileys`. Adapters are injected at
the composition root. This is the rule that makes every adapter swappable and testable — and
it is the one the previous system lacked, which is why its transport client was imported
directly by five modules (`docs/00-prior-art.md`, M1).
