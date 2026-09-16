# ADR-0004 · Express over Fastify

**Status:** Accepted, 2026-09-16. Supersedes the framework choice in
[ADR-0003](ADR-0003-fastify-over-nestjs.md); ADR-0003's rejection of NestJS still stands.

## Context

ADR-0003 replaced NestJS with Fastify, reasoning that the HTTP framework is not on the
critical path and the choice should therefore minimise learning cost. That reasoning was
right. The conclusion did not follow it far enough.

What surfaced immediately afterwards, from the person who has to build and maintain this:

> *"i didnt want to learn a new framework and complicate things cause im learning at a slow
> pace but this needs to get done fast and adding another framework just for it to become
> another hurdle is time taking"*

Three facts ADR-0003 weighed too lightly:

1. **Express is what the learning material uses.** Essentially every Node tutorial, course
   and YouTube series teaches Express. Fastify is better engineered; Express is better
   *supported* for someone learning. For a solo developer learning the language while
   shipping, that asymmetry outweighs the engineering difference.
2. **Express is what both sibling codebases use.** `Mikhil31/JobPortal` runs Express 4;
   the previous CRM ran Express 5. Choosing Fastify meant this repo was the odd one out of
   three.
3. **"Next" and "Nest" and "Fastify" are three similar-sounding words** for two unrelated
   layers, and that confusion cost real time in conversation. Fewer distinct names in play
   is itself a benefit.

## Decision

**Express 5 + Zod.**

Express 5 rather than 4 for one concrete reason: it forwards rejected promises from async
handlers to the error middleware automatically. In Express 4 an async handler that throws
hangs the request instead of answering it — a live footgun, not a style preference. The
previous CRM also ran Express 5, so this matches its lineage.

## Consequences

**Cost of the change:** about fifteen lines. The framework surface in this codebase is
`app.get(path, handler)` and one error middleware. That the switch was this cheap is itself
evidence that ADR-0003's central claim — the framework is not the bottleneck — was correct.

**Given up versus Fastify:** built-in JSON-schema validation (Zod covers this at the
boundary instead), slightly weaker TypeScript inference, and raw throughput that is
irrelevant at any volume this product will see — the anti-ban engine caps sending at roughly
8 messages per minute per number.

**Added:** `pino-http` for request logging and correlation ids, which Fastify bundled.

**Unchanged:** every architectural decision in `04-architecture.md`. Ports and adapters, the
single send path, the layering rule and the composition root were never framework features.

**The framework list is now:** TypeScript, Express, React/Next.js — of which two are already
shared with JobPortal and one is already being learned. No framework is introduced by this
project that is not also needed elsewhere.
