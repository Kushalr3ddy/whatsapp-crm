# ADR-0003 · Fastify over NestJS for the API layer

**Status:** Accepted, 2026-09-16. Supersedes the NestJS choice in `docs/10-stack.md`.

## Context

`10-stack.md` originally chose NestJS, reasoning that its opinionation and documentation give
the highest "a new developer is productive on day two" score, and that its module system *is*
the modular monolith we want.

Three facts have changed since:

1. **The author is learning TypeScript while building.** NestJS front-loads decorators,
   dependency injection, modules, guards, pipes, interceptors and exception filters — a large
   concept count to absorb at the same time as a new language.
2. **The sibling project chose Express.** `Mikhil31/JobPortal` began building 2026-09-16 on
   TypeScript + Express + raw `pg` + Zod + Vitest. A solo developer switching between the two
   codebases weekly benefits from one set of patterns, not two.
3. **The HTTP framework is not on the critical path.** The work that makes this product hard —
   the Baileys gateway, the queue workers, the outbound dispatcher, the anti-ban engine — sits
   below the HTTP layer and is framework-agnostic. Of the five things an in-house beta needs
   (link a number, send/receive, import contacts, run a campaign safely, view an inbox) only
   the last touches the API framework at all.

The original argument was about handover to a team. There is no team yet, and the structure
NestJS would enforce has already been written down in `docs/` and is enforceable by lint.

## Options

**NestJS.** Ships validation pipes, guards, interceptors, exception filters, config module,
OpenAPI generation and testing utilities. For a ~60-endpoint API that plumbing is weeks you
don't write. Costs a large upfront concept load and diverges from the sibling repo.

**Express.** Exactly matches JobPortal; maximum pattern transfer. But Express 4 has weaker
TypeScript support and no built-in schema validation, so more is hand-rolled.

**Fastify.** ~90% the same mental model as Express, so JobPortal knowledge transfers both
directions. Better TypeScript support, and native JSON-schema validation that pairs with Zod —
which recovers OpenAPI generation, the one NestJS feature genuinely missed.

## Decision

**Fastify + Zod.**

Optimise for the author's learning time, because the framework is not the bottleneck. Recover
the structure NestJS would have enforced through lint rules (`no-restricted-imports`) and an
explicit composition root, both of which the architecture already specified.

## Consequences

**Costs, accepted:** the composition root is wired by hand (~50 lines) instead of resolved by a
DI container; auth guards and the error handler are written once rather than configured. That
is roughly a day of work, not a week.

**Unchanged:** every architectural decision in `04-architecture.md` survives intact. Ports and
adapters, the single send path, the layering rule, and the modular-monolith split were never
NestJS features — NestJS would merely have made the wiring implicit. Hand-wiring arguably makes
the dependency graph easier to read, which matters more than convenience for a codebase whose
central rule is *nothing reaches a provider except through the dispatcher*.

**Revisit if:** the API surface grows past what manual wiring stays legible for, or a team
forms and enforced structure becomes worth its learning cost.

## Related

Two smaller choices settled at the same time, for the same reason — fewest moving parts while
learning:

- **npm workspaces, not pnpm + Turborepo.** npm is already installed, pnpm is not, and
  JobPortal uses npm. Package boundaries — the part that is load-bearing — are enforced by
  lint, not by the package manager. Add Turborepo if build times ever hurt.
- **Local Postgres or Supabase for development, not Docker Compose.** The `docker compose`
  plugin is not installed on the development machine and Postgres 16 is already running
  locally. The compose file still ships for deployment; development just does not depend on it.
