# Architecture Decision Records

One file per decision that would be expensive to reverse, or that someone will later ask
"why on earth" about.

Format: **Context · Options · Decision · Consequences · Status**.

An ADR is never edited after acceptance. It is **superseded** by a later one, which links back.

| # | Decision | Status |
|---|---|---|
| [0001](ADR-0001-licence.md) | Licence | Open |
| [0002](ADR-0002-baileys-version.md) | Baileys version to pin | **Accepted** — `baileys@6.7.24` |
| [0003](ADR-0003-fastify-over-nestjs.md) | Fastify over NestJS for the API layer | Superseded by 0004 |
| [0004](ADR-0004-express-over-fastify.md) | Express over Fastify | **Accepted** |
