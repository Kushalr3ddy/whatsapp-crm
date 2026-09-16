# 10 · Stack — every choice and the alternative that lost

Selection criteria, in order: **(1)** a new developer can be productive in days, not weeks;
**(2)** free and self-hostable; **(3)** mature enough to still exist in three years;
**(4)** fits the problem.

Criterion (1) outranks personal familiarity deliberately. This project must survive its
original author losing interest.

## Language & runtime

**TypeScript 5.x strict, Node 22 LTS.**

Baileys is Node-only and is the hardest dependency in the system. A Python or Go core would
mean operating **two runtimes** and a cross-language RPC boundary purely to avoid writing a
few thousand lines of TypeScript. One language means one toolchain, one test runner, shared
types between API and UI, and the largest pool of developers who could take this over.

*Rejected:* Python core + Node sidecar (two runtimes to operate, types stop at the boundary) ·
Go (excellent runtime, but the Baileys equivalent is immature and the ecosystem for this
problem is thinner) · Rust (wrong cost/benefit here).

## Monorepo

**npm workspaces.** Already installed, and the sibling JobPortal repo uses npm — one toolchain
across both codebases. The part that is load-bearing, package boundaries, is enforced by lint
rather than by the package manager. *Rejected:* pnpm + Turborepo (better caching, but another
tool to install and learn — revisit if build times hurt) · Nx (more power than needed) ·
polyrepo (version skew between API and UI for no gain). See ADR-0003.

## API framework

**Express 5 + Zod.** See [ADR-0004](adr/ADR-0004-express-over-fastify.md) (which supersedes
[ADR-0003](adr/ADR-0003-fastify-over-nestjs.md), which had superseded an earlier choice of NestJS).

Express 5 specifically, because it forwards rejected promises from async handlers to the error
middleware — in Express 4 an async handler that throws hangs the request instead of answering it.

The framework is not on the critical path — the gateway, workers, dispatcher and anti-ban engine
sit below the HTTP layer and are framework-agnostic. So the choice optimises for the smallest
concept count while the author is also learning TypeScript, and for matching JobPortal's Express
so patterns transfer between the two codebases — and because Express is what essentially every
Node tutorial teaches, which matters more than engineering elegance for someone learning the
language while shipping.

The structure NestJS would have enforced is instead enforced by `no-restricted-imports` and an
explicit composition root. Arguably that makes the dependency graph easier to read.

*Rejected:* NestJS (validation pipes, guards, interceptors and OpenAPI for free, but a large
upfront concept load and divergence from the sibling repos) · Fastify (better typed and faster,
but a fourth similar-sounding name for a layer that is not the bottleneck) · tRPC (excellent for a
TS-only client, wrong for an API-first product with third-party consumers) · Hono (promising,
younger ecosystem).

## Database & ORM

**PostgreSQL 16** — the only datastore required. Relational integrity, `jsonb` for user-defined
fields, RLS for tenancy, `pg_trgm` for search, `pgcrypto`, and LISTEN/NOTIFY. Adding a second
datastore would be adding an operational burden for a self-hoster with nothing to show for it.

**Drizzle ORM + drizzle-kit.**

SQL-first, so anyone who reads SQL reads the code. Real versioned SQL migration files rather
than Prisma's shadow-database process. Clean transaction-scoped `SET LOCAL app.org_id`, which
is what RLS needs and what Prisma makes awkward. Bulk upserts for ingestion stay both fast and
legible.

The honest trade: Prisma has more mindshare and a nicer studio. But "TypeScript that looks like
SQL" is arguably a *lower* learning curve for anyone who knows SQL, and the RLS ergonomics are
decisive given tenancy is in from migration 1.

*Rejected:* Prisma (RLS friction, migration model, heavier client) · TypeORM (decaying) ·
Kysely (excellent query builder, thinner schema/migration story) · raw `pg` (what the old
system used — and why it ended up with two schema sources of truth, M5).

## Queue

**A `QueueDriver` port with two implementations.**

- **pg-boss** (`lean` default) — Postgres-backed. No extra service to run, no extra memory.
  For a single-instance deploy this is genuinely enough.
- **BullMQ + Redis** (`standard`+) — the Node default. Delayed jobs, repeatable jobs,
  rate-limited groups, priorities, backoff, DLQ — all of which the anti-ban engine needs.

Two implementations is a real maintenance cost, accepted because the resource difference
matters at the bottom end and the contract suite covers both. *Rejected:* BullMQ only (forces
Redis on every self-hoster) · pg-boss only (Postgres as a queue does not scale to the `scale`
tier) · Kafka/RabbitMQ (absurd for one VPS).

## Frontend

**Next.js 15 App Router + TanStack Query + shadcn/ui + Tailwind.**

Next.js is the default React choice and matches what the job portal settled on. In `lean` it is
**statically exported and served by Caddy** — the CRM is a logged-in application and needs no
SSR, which saves 100–200 MB.

shadcn/ui is copy-in components rather than a dependency: no vendor lock, and fully themeable,
which matters because branding must be configurable (the old system hardcoded a client name
into every page title).

*Rejected:* Vite SPA (lighter, but loses the shared-types and file-routing conveniences, and
diverges from the portal) · Remix · a component library with baked-in theming (Material, Ant) —
re-theming those is a fight.

## Realtime

**Socket.IO with the Redis adapter** (`standard`+), falling back to a single-node in-process
adapter in `lean`. Mature, handles reconnection and fallbacks. *Rejected:* raw WebSocket
(re-implement reconnection) · SSE (one-directional; typing indicators need both ways) ·
Pusher/Ably (paid, external).

## Validation

**Zod**, used for DTOs, OpenAPI generation **and** environment config. One schema language for
all three means the config validated at boot is the same shape as the config documented in
`.env.example` — which is how M17 stops recurring.

## Everything else

| Concern | Choice | Note |
|---|---|---|
| Object storage | filesystem / MinIO / any S3 | `StorageDriver`, see [18](18-providers.md) |
| Auth | built-in / OIDC / SAML | `AuthProvider` |
| Observability | OpenTelemetry → Prometheus, Grafana, Loki, Tempo | **off by default** — ~1–2 GB ([19](19-capacity.md)) |
| Errors | GlitchTip (Sentry-compatible) | opt-in |
| Proxy | Caddy | auto-TLS in two lines |
| Phone parsing | libphonenumber-js | the canonical E.164 normaliser (M8) |
| Spreadsheets | SheetJS (read), ExcelJS (write) | streaming both ways |
| Passwords | argon2 | not bcrypt (M16) |
| Logging | Pino | JSON, UTC (M25) |
| Tests | Vitest, Supertest, Testcontainers, Playwright, k6 | [12](12-testing.md) |
| CI | GitHub Actions | matches the portal |

## Versions to pin at P1

| | Version | Note |
|---|---|---|
| Node | 22 LTS | |
| PostgreSQL | 16 | |
| **Baileys** | **TBD — ADR needed** | 7.x is a release candidate (`7.0.0-rc14`) with breaking changes; the last stable release was Nov 2025. Pin exactly; keep the adapter surface thin so an upgrade is contained. |

## Decisions worth revisiting later

- **Drizzle vs Prisma** — if the team turns out to prefer Prisma's ergonomics and RLS is
  handled another way.
- **Express vs NestJS** — revisit if the API surface outgrows legible manual wiring, or a team
  forms and enforced structure becomes worth its learning cost (ADR-0003, ADR-0004).
- **pg-boss in `lean`** — if maintaining two queue drivers turns out to cost more than the
  ~80 MB it saves.

Each would be an ADR. None is load-bearing on the architecture, because all three sit behind
boundaries the rest of the system does not see.
