# 21 · Deferred decisions

Things deliberately **not** decided yet, each with the condition that should bring it back.

A parked decision is not a forgotten one. The point of this file is that nobody has to
re-derive the reasoning, and nobody revisits something before the thing that would change the
answer has actually happened.

Format: what · why parked · **what brings it back** · what it would cost to do later.

---

## D-1 · A lightweight database browser (Drizzle Studio or similar)

**What:** a web UI for running SQL against the live database from any device — a phone, a
borrowed laptop — without installing anything.

**Why parked:** the need is real (checking data or debugging away from your own machine), but
every option carries a catch:

| Option | Catch |
|---|---|
| **Drizzle Studio** (`npm run db:studio`) | Works today, but the **UI is served from `https://local.drizzle.studio`** — a page on Drizzle's servers that connects to your local port. Data stays on your machine; the interface code does not. Needs internet, and puts a third party in the loop. |
| **pgweb** | Single Go binary, ~20 MB RAM. Self-hosted, no third party. Needs to be put behind authentication. |
| **Adminer** | One PHP file. Same shape as pgweb. |
| **Supabase dashboard** | Free SQL editor in the browser, no setup — but only if the database is hosted there. |
| **DBeaver / psql** | What to use on your own machine. Not the answer to "from my phone". |

Starburst-style query UIs (stages, metrics, execution plans) are enormously more than this
needs — that is a distributed-query problem, and this is one Postgres instance.

**What brings it back:**
1. **Consolidating infrastructure for Indian data-residency compliance.** When everything moves
   in-region under DPDP, *where the database browser's UI is served from* becomes a real
   question rather than a preference — a third-party page holding a live connection to a
   database of personal data is exactly the kind of thing that needs an answer. Choose the
   self-hosted option then, behind the same authentication as everything else.
2. Or: someone needs database access away from their own machine often enough to be annoying.

**Cost of deferring:** none. Every option is additive and none touches the schema or the
application. `psql` and DBeaver cover the day-to-day case now.

---

## D-2 · Data residency, DPDP consent enforcement, DLT registration

**What:** hosting, database, storage and any inference inside India; enforced purpose-separated
consent; DLT registration for SMS.

**Why parked:** the deployment is **in-house beta only** (decided 2026-09-16). The job portal
is on the same footing.

**What brings it back:** the first real user who is not on the team. That is the line — beta
testing among colleagues is one thing, processing other people's personal data is another.

**What stays in place regardless**, because it protects phone numbers rather than a legal
position: `do_not_contact`, opt-out keyword handling, and the `consent_record` table. Recording
consent costs nothing now and is expensive to backfill; enforcement can be switched on later.

**Cost of deferring:** low, provided the tables exist. Retrofitting consent *records* onto
historical contacts is impossible — you cannot invent evidence of an agreement that was never
captured. Hence keeping the table from the start.

---

## D-3 · Licence (ADR-0001)

**Why parked:** it changes nothing technical.

**What brings it back:** making the repository public, or accepting the first outside
contribution — whichever comes first.

**Cost of deferring:** rises sharply after the first outside contributor, since changing a
licence then needs every contributor's agreement. Decide before, not after.

---

## D-4 · The AI agent (F12)

**Why parked:** the heaviest dependency, the least certain value, and an unresolved privacy
question. A self-hosted model needs 5–7 GB of RAM; a hosted one sends contact data to a third
party. Most of what the previous system used AI for — classifying "yes, interested" — is better
served by rules that are free, instant, deterministic and correctable.

**What brings it back:** rule-based classification demonstrably failing on real conversations,
or a volume of inbound that humans genuinely cannot keep up with.

**Cost of deferring:** none. The seam exists — `LlmDriver` defaults to `none`, and the agent is
just another producer writing into the same outbox, so every safety gate already applies to it.

---

## D-5 · Baileys 7.x (ADR-0002)

**Why parked:** pinned to `6.7.24`, the stable line. 7.x has sat in release-candidate status
across twelve iterations.

*Correcting an earlier claim: the objection was never the Rust dependency. `whatsapp-rust-bridge`
is WebAssembly, base64-inlined, with no native binaries, no install scripts and no platform
restrictions — it installs like any pure-JS package. The reason is RC churn alone.*

**What brings it back:** a stable 7.0.0, or 6.x breaking against a WhatsApp protocol change.

**Cost of deferring:** low by construction. The `ChannelProvider` port plus its contract suite
means evaluating 7.x is: write the adapter against the new version, run the same suite, compare.

---

## D-6 · UUIDv7 primary keys

**Why parked:** Postgres 16 has no native `uuidv7()`; it arrives in PG18. Keys currently use
`gen_random_uuid()`.

**What brings it back:** upgrading to Postgres 18, or index bloat from random keys becoming
measurable.

**Cost of deferring:** moderate. Changing key generation later affects new rows only, so old and
new coexist — workable, but it makes the ordering property unreliable until every old row ages
out.

---

## D-7 · Turborepo, and splitting the queue driver

**Why parked:** npm workspaces are enough at this size, and `pg-boss` avoids running Redis at
all in the lean preset.

**What brings it back:** build times becoming annoying (Turborepo), or needing to scale workers
horizontally, at which point `pg-boss` stops being appropriate and BullMQ on Redis is correct.

**Cost of deferring:** none. Both sit behind interfaces already.
