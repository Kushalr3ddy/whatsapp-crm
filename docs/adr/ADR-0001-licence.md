# ADR-0001 · Licence

**Status:** Open — must be decided before any public release.

## Context

The product is intended to be self-hostable by anyone. The licence determines whether someone
can take it, host it as a paid service, and contribute nothing back — and whether companies
are willing to adopt it at all.

## Options

**AGPL-3.0** — anyone offering it as a network service must publish their modifications.
Protects against a hosted competitor built on this work. The cost: many companies prohibit
AGPL dependencies outright, which limits adoption, and the "module inside a larger product"
use case (`16-integration-jobportal.md`) needs care — a host application calling it over HTTP
is generally fine, but embedding it is not.

**MIT / Apache-2.0** — maximum adoption, zero friction, usable inside closed products.
Someone else may host it commercially and contribute nothing. Apache-2.0 adds an explicit
patent grant, which is why it is usually preferred over MIT for anything non-trivial.

**Dual licence** — AGPL plus a commercial licence. Preserves both, but requires a legal entity
and a sales process to mean anything.

## Decision

Undecided.

Worth weighing: the first consumer is a host application that will call this over HTTP from a
separate process, so AGPL is likely workable there. The question is really what this project
is *for* — a widely adopted open tool, or a defensible asset.

## Consequences

Affects nothing technical. Changing it later requires the agreement of every contributor, so
it is much cheaper to decide before accepting the first outside contribution.
