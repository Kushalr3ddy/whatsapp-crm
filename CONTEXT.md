# CONTEXT — delta log

Append-only. Every working session adds one entry at the **bottom**; nothing above is
ever edited or deleted. Read top-to-bottom to see how the system came to be the way it is.

Rule (see `docs/11-conventions.md`): **no session ends without an entry here.**
Scaffold one with `infra/scripts/context-append.sh`.

Entry template:

```markdown
## YYYY-MM-DD · Session NNN · <short title>
**Decided:**  what was chosen
**Why:**      the reasoning, especially what was rejected and on what grounds
**Built:**    what actually landed
**Open:**     what is still undecided or half-done
**Next:**     the intended next step
**Files:**    paths touched
```

---

## 2026-09-13 · Session 001 · Planning, research & architecture

**Decided:**
- Build from scratch. The existing `github.com/Mikhil31/WhatsAppCRM` (private, last commit
  2026-08-03) is reference material only — see `docs/00-prior-art.md` for the 30-item
  catalogue of what went wrong and the rule each defect becomes.
- Full TypeScript monorepo: NestJS (Fastify adapter) + Drizzle + Next.js, BullMQ or pg-boss
  behind a queue port, Postgres 16 as the only required datastore.
- Baileys embedded directly in a dedicated gateway process — **not** behind a third-party
  gateway. Auth state in Postgres, never on disk.
- Every external resource sits behind a driver port with a free self-hosted default and a
  managed/paid alternative (`docs/18-providers.md`).
- Three presets — `lean` (default, ~700 MB–1 GB, one process, no Redis, no telemetry),
  `standard`, `scale`. Telemetry, LLM, SMS, antivirus are all **off by default**.
- Single-tenant deploy, multi-tenant-ready schema: `org_id` on every table, RLS enabled
  from the first migration.
- Generic by construction: no `candidate`/`job` tables. Contacts with user-defined fields,
  user-defined pipelines, `external_ref` to whatever system owns the domain objects.

**Why:**
- One language lowers the cost of handing this to another developer, and Baileys is
  Node-only — a Python core would mean operating two runtimes to avoid writing ~2k lines
  of TypeScript.
- The old system's private OpenWA-gateway fork made ~40% of its WhatsApp code pure
  workaround for someone else's defects.
- The job portal's own spec (`JobPortal/docs/06-comms-layer.md`) independently defines a
  `CommsProvider` port, an ownership split, and nine integration seams. Designing to it
  now makes that integration configuration rather than a rewrite.
- Telemetry costs ~1–2 GB RAM — more than the application itself on a small VPS, so it
  cannot be the default. A self-hosted LLM costs 5–7 GB, so it must be opt-in too.

**Built:** `docs/00`–`docs/19` (incl. `06-features/F1`–`F12`), ADR-0001/0002, README,
STRUCTURE, CONTRIBUTING, SECURITY, the empty directory skeleton, and this file.
No application code — P0 is documentation only.

**Open:**
- Licence: AGPL-3.0 vs MIT (ADR-0001, undecided).
- Whether F12 (AI agent) ships in V2 or stays a seam — the job portal defers the same
  question as its T23.
- Baileys version to pin: 7.x is a release candidate (`7.0.0-rc14`); last stable was
  Nov 2025 (ADR-0002).
- The interactive capacity calculator is specified in `docs/19-capacity.md` but not built.
- Who owns the WhatsApp Business Account, and when Business Verification starts — blocks
  P8, not a code decision.

**Next:** P1 — monorepo skeleton, Docker Compose, migrations, config validation, the
provider layer with its contract suite, and CI including the JSDoc lint rule.

**Files:** `docs/**`, `README.md`, `CONTEXT.md`, `.gitignore`

---

## 2026-09-13 · Session 002 · Capacity calculator

**Decided:** The calculator ships as a standalone, dependency-free HTML file under `docs/`,
not as part of the application. It is documentation, so it must open from disk with no server,
no build step and no network.

**Why:** A self-hoster's first question is "what box do I need?", and the two answers that
matter most are not intuitive — the telemetry stack costs more RAM than the application, and
Baileys throughput is bought with phone numbers rather than hardware. A table in a document
does not make either land; a slider does.

**Built:** `docs/capacity-calculator.html` (~34 KB, no dependencies, theme-aware).
Three presets, six load sliders, per-component RAM breakdown as a stacked bar, disk projection
to 24 months, VPS recommendations, self-hosted vs managed cost comparison, and Meta message
spend at Indian rates. Every coefficient lives in one `ASSUMPTIONS` object at the top of the
script. Verified in a browser: no console errors; `lean` defaults compute to **881 MB / 0.9
vCPU / 5.1 GB year-one**, which agrees with the ~0.7–1 GB claimed in `docs/19-capacity.md`.

Two bugs found and fixed during verification: default slider positions opened the page on a
red "not enough numbers" error state, and clicking the `scale` preset displayed "standard"
because the label was re-inferred from config instead of honouring the click.

**Open:** All coefficients are **estimates**, not measurements — P11 replaces them. The page
says so at the top, twice.

**Next:** Still P1 (skeleton) or a P3 vertical slice — awaiting a decision on which feature to
build first.

**Files:** `docs/capacity-calculator.html`, `docs/19-capacity.md`, `README.md`, `CONTEXT.md`


---

## 2026-09-16 · Session 003 · ADR-0003 and the P1 skeleton

**Decided:**
- **Fastify + Zod instead of NestJS** (ADR-0003). The HTTP framework is not on the critical
  path — the gateway, workers, dispatcher and anti-ban engine all sit below it. So optimise
  for the smallest concept count while learning TypeScript, and for matching JobPortal, which
  began building the same day on TypeScript + Express + Zod + Vitest.
- **npm workspaces, not pnpm + Turborepo.** npm is installed, pnpm is not, and JobPortal uses
  npm. Package boundaries — the load-bearing part — are enforced by lint, not by the package
  manager.
- **Local Docker Postgres for development, not Docker Compose.** The compose plugin is not
  installed on this machine; the compose file still ships for deployment.
- **Scope is in-house beta.** India data residency, DPDP consent enforcement and DLT
  registration are parked. `do_not_contact` stays, because it feeds the anti-ban engine
  rather than a legal position.

**Built:** npm workspace root, `tsconfig`, ESLint flat config, Vitest.
`packages/shared` — config (Zod, hard-crash on missing), logger (pino, UTC), `Result`, and
the E.164 normaliser with 9 tests. `packages/db` — drizzle schema (`org`, `app_user`,
`org_membership`, `contact`, `contact_identity`), client, migration runner, two migrations.
`apps/api` — Fastify app with gated startup, `/health`, `/ready`, request-id propagation.
CI with typecheck, lint, tests, migration idempotency and a gitleaks scan.

**Verified, not assumed:**
- `/health` 200 and `/ready` 200 with the database up; `/ready` **503** with it stopped while
  `/health` stays 200 — liveness and readiness are genuinely different.
- Config gate refuses to start and names the missing variables (M17).
- Blank identity values, unknown identity kinds and duplicate identities are all rejected **by
  the database**, so M7 is structurally unwritable rather than merely discouraged.
- RLS actually isolates: no org context → **0 rows**; each org sees only its own; a cross-org
  insert errors. A forgotten `WHERE org_id` fails closed.
- The comment-rule lint fires on an undocumented function, exported const and type, and passes
  clean code — checked both directions, because a rule that never fails is not a rule.

**Found while building:**
- **Postgres superusers bypass RLS entirely**, even with `FORCE`. The policies look enabled in
  `pg_tables` while doing nothing. Migration `0001` creates a `crm_app` role for the app to
  connect as; documented in `docs/13-deployment.md`.
- **libphonenumber's default metadata accepts junk** — `1111111111` and `5555555555` both pass
  as valid Indian numbers. Switched to the `max` bundle, which rejects them *and* distinguishes
  `MOBILE` from `FIXED_LINE`. That earned a feature: a landline is flagged unreachable on
  WhatsApp at import, saving a doomed send and the delivery-ratio penalty it would cost.
- The JSDoc rule as written in `docs/11-conventions.md` demanded a docblock on every inline
  callback. Relaxed to named declarations only, and the doc corrected to match the working
  config.

**Open:** UUIDv7 deferred — Postgres 16 has no native `uuidv7()` (PG18 does), so primary keys
use `gen_random_uuid()` for now. Licence (ADR-0001) and Baileys version (ADR-0002) still open.

**Next:** P2 — contacts and identity resolution over the schema now in place, then P3 Baileys.

**Files:** `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`,
`.env.example`, `packages/shared/**`, `packages/db/**`, `apps/api/**`,
`.github/workflows/ci.yml`, `docs/adr/ADR-0003*`, `docs/10-stack.md`, `docs/11-conventions.md`,
`docs/13-deployment.md`, `README.md`, `STRUCTURE.md`

---

## 2026-09-16 · Session 004 · Express, and why the framework churn stopped here

**Decided:** **Express 5 replaces Fastify** (ADR-0004, superseding ADR-0003's framework pick;
its rejection of NestJS stands). ADR-0003's reasoning — the HTTP framework is not on the
critical path, so minimise learning cost — was right but under-applied. Express is what every
Node tutorial teaches, what JobPortal runs, and what the previous CRM ran. Choosing Fastify
made this repo the odd one out of three, for an engineering gain that is irrelevant at a
volume the anti-ban engine caps at ~8 messages/minute/number.

Express **5**, not 4, for one concrete reason: it forwards rejected promises from async
handlers to the error middleware. In Express 4 an async handler that throws hangs the request
instead of answering it.

**The cost of the change was ~15 lines**, which is itself the evidence for ADR-0003's central
claim. The framework surface in this codebase is `app.get(path, handler)` plus one error
middleware.

**Built:** converted `apps/api` to Express + `pino-http`; added a real error boundary and a
404 that matches the problem+json error shape; added 6 API tests with supertest, replacing
manual curl checks. 15 tests total.

**Verified:** `/health` 200 without touching the database, `/ready` 200 when it answers and
**503** when it does not, caller-supplied `x-request-id` echoed, one generated when absent,
unknown routes answered as problem+json with a correlation id.

**Caught during verification:** the first Express check appeared to pass while actually hitting
a **stale Fastify process** still holding port 3000 — `tsx` spawns a child, and killing the
shell's job left the child alive. The 404 body was Fastify-shaped, which is what gave it away.
Worth remembering when verifying a server locally: confirm the port is free first, and check a
response that differs between old and new code.

**Data sources confirmed** for the ingestion framework: Excel/CSV, Google Sheets, the job
portal API, and a job-board API — all four eventually, **Excel/CSV first** for the beta. Four
readers, one pipeline (`docs/07-ingestion.md`).

**Process:** commits go straight to `main`. No branches.

**Not done, deliberately:** no stress or load tests yet. There are two health endpoints; load
testing them would measure Express, not this product. Stress testing is P11, and the targets
that matter are a 10k-recipient campaign, 100 msg/s inbound, a 50k-row import and a 24-hour
soak — none of which exist yet.

**Next:** P2 — contacts and identity resolution.

**Files:** `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/app.test.ts`,
`package.json`, `docs/adr/ADR-0004*`, `docs/adr/README.md`, `docs/10-stack.md`,
`docs/04-architecture.md`, `STRUCTURE.md`

---

## 2026-09-16 · Session 005 · Every column explained

**Built:** rewrote `docs/05-data-model.md` (150 → 637 lines) so **every table has a
column-by-column explanation**, 1–2 lines each, saying what the column is and why it exists —
not restating its type. Where a column exists to prevent a specific past failure, it cites the
defect id from `00-prior-art.md`.

Added a status marker per table: ✅ built · 🔜 next · ⬜ planned. Five tables exist; the map
lists 44.

Also added migration `0002_column_comments.sql` — `COMMENT ON TABLE/COLUMN` for the five
tables that exist. `\d+ contact_identity` in psql now prints the reasoning, as does any GUI
tool. The point is that someone inspecting the database directly gets the explanation without
finding the repo, and that it cannot drift out of the database the way a separate file can.

**Corrected:** the table count. Earlier I said "~35 tables"; the map actually lists **44**
(~46 counting ones mentioned only in prose). Also clarified a real confusion: all 44 are the
**WhatsApp CRM**. The job portal has its own separate ~25 entities in its own database. Two
systems, two databases, talking over an API.

**Still open from session 004:** `contact.custom_fields` and `contact.external_ref` are
`text` in the Drizzle schema where the docs specify `jsonb`. Consequence: custom fields cannot
be queried or filtered, and `external_ref` cannot be GIN-indexed — which is the lookup the job
portal integration depends on. Two-line fix plus one migration **while the tables are empty**;
after P2 populates contacts it becomes a data migration.

**Next:** fix the jsonb defect, then P2 — contacts and identity resolution.

**Files:** `docs/05-data-model.md`, `packages/db/migrations/0002_column_comments.sql`, `CONTEXT.md`

---

## 2026-09-16 · Session 006 · jsonb, and index choices made by measurement

**Fixed:** `contact.custom_fields` and `contact.external_ref` were `text` in the Drizzle schema
where the docs specified `jsonb` — a defect introduced in P1. Consequences while wrong: custom
fields could not be filtered at all, `external_ref` could not be indexed, and malformed JSON
was storable. Migration `0003` changes both, **while the tables are empty**; after P2 populates
contacts this would have been a data migration.

**Index choices, measured rather than assumed.** Finding one contact by external id across
200k rows:

| approach | time | index size |
|---|---|---|
| seq scan | 116 ms | — |
| GIN `jsonb_ops` (the default) | 2.0 ms | — |
| GIN `jsonb_path_ops` | 0.48 ms | 11 MB |
| **B-tree on `(external_ref->>'id')`** | **0.09 ms** | **6 MB** |

So `external_ref` gets a **B-tree expression index, not GIN** — every host-app sync looks it up
the same way, and GIN's generality is pure cost against a fixed access pattern. `custom_fields`
keeps GIN, because there users invent their own keys and we cannot know which will be filtered;
but with `jsonb_path_ops` rather than the default, since only `@>` is ever queried. `docs/05`
updated with the numbers.

**Two Postgres gotchas hit on the way, both now commented in the migration:**
1. `text → jsonb` has no automatic cast; `USING` is required. drizzle-kit does not generate it.
2. The column's **DEFAULT** cannot be cast either, so it must be dropped first and re-set after.
   The error names the column, not the default, which sends you looking in the wrong place.

**Process note:** the first failed migration looked like a silent no-op because I truncated the
output with `tail -3`. It had actually failed loudly and rolled back — only 3 of 4 migrations
were recorded. The tooling behaved correctly; the verification did not. Check the exit code,
not the last three lines.

**Verified:** filtering by an arbitrary custom field, the host-app `external_ref` lookup,
numeric comparison inside jsonb, malformed JSON now rejected by the column type, and migrations
re-running clean.

**Next:** P2 — contacts and identity resolution.

**Files:** `packages/db/src/schema.ts`,
`packages/db/migrations/0003_contact_jsonb_and_indexes.sql`, `docs/05-data-model.md`

---

## 2026-09-18 · Session 007 · Encryption, and credentials that survive a restart

**Context:** P3a (the `ChannelProvider` port, the fake adapter, the contract suite) had already
landed in `98d9fda` from an earlier session today, along with ADR-0002 pinning
`baileys@6.7.24`. Pulled before starting and discarded a duplicate edit to the data-model map
rather than clobbering that work. This session builds the layer beneath the Baileys adapter.

**Corrected a claim from the previous session.** I had argued against Baileys 7.x partly
because it pulls in `whatsapp-rust-bridge`, calling it a native module that would complicate
Docker builds. That was wrong: it is Rust compiled to **WebAssembly**, base64-inlined into a
2 MB `index.js`, with no `.node` files, no install scripts and no os/cpu restrictions. It
installs like any pure-JS package. ADR-0002's conclusion still holds, but on the honest
grounds — a stable API versus a release candidate that has sat in RC across twelve iterations.

**Built:**
- `packages/providers/kms/local` — AES-256-GCM with a key from configuration. GCM rather than
  CBC because it authenticates: a tampered ciphertext fails loudly instead of returning
  plausible garbage. Every envelope carries its key version, so a rotation can run online and
  a mismatch names the version rather than reporting a generic failure. A **separate**
  non-rotated key does blind indexing, and the constructor refuses to let one key serve both —
  deterministic indexing under the encryption key would leak which plaintexts are equal.
- `sender_identity`, `channel_session`, `channel_auth_state` tables, with RLS forced. The two
  child tables reach their tenant through `sender_identity` via `EXISTS` rather than carrying
  their own `org_id`, since neither has meaning apart from its parent. Anti-ban columns
  (`warmup_started_at`, `risk_score`, `daily_cap_override`) exist from this first migration so
  P6 needs no migration against a live table.
- A `bytea` custom column type for Drizzle, which has no first-class one.
- `PostgresAuthStateStore` — the port's `AuthStateStore` backed by Postgres, encrypting every
  value. Upsert rather than delete-then-insert, because Baileys rewrites keys constantly and
  the gap between a delete and an insert is a window where the session is unrecoverable.

**Verified:** 49 tests. The decisive one asserts credentials **survive a restart** — a new
store on a new connection reads what the old one wrote, which is the whole reason the table
exists (M29/M30). Others assert the stored bytes do not contain the plaintext, senders are
isolated, deleting a sender cascades its credentials away, and the config gate refuses to boot
on a missing or malformed key rather than accepting it.

**Note for deployment:** losing `ENCRYPTION_KEY` means losing every linked number and every
stored message. It must be backed up separately from the database — a dump and its key in one
place is a single point of compromise. Documented in `.env.example`.

**Next:** the Baileys adapter itself, against the port and the contract suite.

**Files:** `packages/providers/kms/local/**`, `packages/db/src/schema.ts`,
`packages/db/src/auth-state-store.ts`, `packages/db/migrations/0004_channels.sql`,
`packages/shared/src/config.ts`, `.env.example`, `tests/integration/auth-state-store.test.ts`

---

## 2026-09-18 · Session 008 · Docs a newcomer can actually read

**Problem:** the docs were written for someone who already knew the stack. `M7`, `P3`, `FR-12`,
"port", "RLS", "blind index", "E.164" all appeared without ever being defined, and `docs/` had
no entry point — a reader landed in a directory of twenty numbered files with no starting point.

**Built:** `docs/20-orientation.md` (254 lines) and `docs/README.md`.

The orientation doc assumes no knowledge of TypeScript, Node, Postgres or WhatsApp's API. It
covers: what the product is in plain words; **every numbering scheme decoded** (M = a mistake
from the old system, P = build phase, F = feature module, FR/NFR/CON = requirements, ADR =
decision record, AC/TC = acceptance criteria and tests); what each technology is and why it
was chosen; a glossary of the terms used constantly (migration, port/adapter, fake, contract
test, queue/worker, RLS, jsonb, GIN, blind index, E.164, idempotent, envelope encryption, WASM,
dist-tag); the one rule that explains most decisions — *this tool knows nothing about your
business*; the ban risk stated plainly; and how to run it.

**Deliberately not done:** rewriting all twenty documents. The gap was orientation, not
content — the existing docs are accurate and detailed, they simply assumed context the reader
does not have. One good entry point plus a glossary fixes that far more cheaply than a rewrite,
and leaves the day free for P3.

**Next:** P3 — the Baileys adapter. That is the checkpoint a working prototype means.

**Files:** `docs/20-orientation.md`, `docs/README.md`, `README.md`, `CONTEXT.md`

---

## 2026-09-18 · Session 009 · The Baileys adapter

**Checkpoint 1 — Baileys installed and proven.** Pinned `baileys@6.7.24` **exactly**, no caret,
as ADR-0002 requires. Smoke-tested before building anything on it: `makeWASocket` loads,
protobuf decodes, `initAuthCreds()` produces key material, and `fetchLatestBaileysVersion()`
reached WhatsApp's servers and returned `2.3000.1043857760 (latest)`. So the library works and
the protobuf postinstall npm skipped was not needed.

**Checkpoint 2 — somewhere for messages to land.** `conversation` and `message` tables, RLS
forced. `message.provider_message_id` is UNIQUE per org: that is what makes delivery
idempotent, since WhatsApp retries notifications for up to seven days and a duplicate has to
become a no-op at the database level, not in application code where it can race. A unique index
on `(contact_id, sender_identity_id)` stops two simultaneous inbound messages creating
duplicate threads.

**Checkpoint 3 — the adapter.** `packages/channels/baileys`, implementing `ChannelProvider`:

- `auth-adapter.ts` bridges our encrypted Postgres store into Baileys' `AuthenticationState`.
  Uses Baileys' own `BufferJSON`, because plain `JSON.stringify` silently corrupts the binary
  key material into `{"type":"Buffer"}` objects. A null value in a key write means *delete*,
  not *store null* — Baileys expires pre-keys that way.
- `event-stream.ts` turns Baileys' EventEmitter into the async iterables the port exposes.
  Buffers when nothing is reading yet, so events arriving during startup are not dropped.
- `index.ts` — link by QR **or pairing code**, connect, send, disconnect, logout, health,
  shutdown, plus normalisation of inbound messages and delivery receipts.

**Decisions worth recording:**
- **Pairing-code linking matters more than usual here.** The phones belong to the recruiter and
  the other dev, not to us, so linking a number nobody is holding is the normal case rather than
  the exotic one.
- **Send prefers the address WhatsApp itself supplied.** Synthesising `<number>@s.whatsapp.net`
  for a privacy-mode contact addresses a chat that does not exist, and in the previous system
  that took down the entire engine rather than one send — a permanent crash loop (M26).
- **Group traffic and `status@broadcast` are dropped on inbound.** A group jid is not a person.
- **Our own echoed messages are ignored** (`key.fromMe`), or every outbound send would be
  recorded twice.
- **No rate limiting lives here.** Pacing, warmup and the safety gates belong in the dispatcher
  above, so every producer passes through them and none can bypass by reaching the provider
  directly (M12). This adapter will happily send as fast as it is asked to — which is why it
  must not be pointed at a list yet.

**Verified:** 70 tests. The adapter cannot run the contract suite without a real number, so the
pure functions inside it are tested directly: disconnect-code mapping (401 terminal, 429 back
off, 463 pause — each implies a different response, and the previous system treated them all
alike and retried into a ban), delivery-tick mapping, and `extractBody` across WhatsApp's nested
message union — plain text, replies (a completely different shape on the wire, and missing it is
how a CRM silently drops every reply to a quoted message), media captions, document filenames,
and unknown future types that must return `other` rather than throw.

**Next:** the gateway process and the link/send API, so someone else can link a real number.

**Files:** `packages/channels/baileys/**`, `packages/db/src/schema.ts`,
`packages/db/migrations/0005_conversations.sql`, `package.json`

---

## 2026-09-18 · Session 010 · A real QR, from a real connection

**Built:** `scripts/wa-link.ts` plus `npm run wa:link` / `npm run wa:send` — a hand-run harness
that links one real number and stores what arrives. Not the product: the gateway process and
the HTTP API still do not exist. This is the end-to-end proof that the adapter, the encrypted
credential store and the database work together, run by a person watching the output.

**Verified against the real WhatsApp servers:** `npm run wa:link` reached WhatsApp, received a
linking challenge, and rendered a scannable QR in the terminal. Nothing was linked — the run
was killed after 25 seconds — but the connection, the protocol handshake and the QR issuance
are real.

**Inbound persistence** resolves identity → contact (creating both if unknown), upserts the
conversation, and inserts the message with the body encrypted. `ON CONFLICT (org_id,
provider_message_id) DO NOTHING` is the idempotency guarantee: WhatsApp redelivers
notifications for up to seven days, and a duplicate has to become a no-op in the database
rather than in application code where it can race. A `@lid` privacy address is stored as a
`wa_lid` identity — simply another way of reaching the same person.

**Safety note carried in the file itself:** there is no rate limiting anywhere in this path.
That is P6. The harness is for a handful of messages to people who will reply, which is also
the pattern WhatsApp's heuristics reward. It must not be pointed at a list.

**Next:** the gateway process and the link/send API, so this stops being a hand-run script.

**Files:** `scripts/wa-link.ts`, `package.json`, `tsconfig.json`

---

## 2026-09-18 · Session 011 · Portable migrations, and a home for parked decisions

**Fixed: migrations would have aborted on a managed Postgres.** Migration `0001` runs
`CREATE ROLE crm_app`, and `0004`/`0005` grant to it. Managed providers (Supabase, Neon, Aiven,
RDS) do not always permit role creation — and because the grants follow, a single permission
error would abort the whole migration and leave no schema at all. All three now catch
`insufficient_privilege` and raise a warning instead.

The warning says what is actually lost, rather than being reassuring: without the role the app
connects as the table **owner**, and an owner bypasses row-level security. The policies still
look enabled in `pg_tables` while enforcing nothing. Acceptable for dev or single-tenant;
not for multi-tenant.

**Verified properly, after a first attempt that proved nothing.** The first simulation reported
`crm_app` as "present" even for a user that could not create roles — because **Postgres roles
are cluster-wide, not per-database**, so it already existed from an earlier run. Redone in a
separate container with a genuinely clean cluster and a `NOCREATEROLE` user: role creation fails
with `permission denied`, three warnings are raised, and the migration still completes with
**10 tables, 9 with RLS forced**. Local database also rebuilt from scratch to confirm the edited
migrations still apply cleanly from empty.

**Added `docs/21-deferred.md`** — parked decisions, each with the condition that brings it back.
Seven so far: the database browser (D-1), data residency (D-2), licence (D-3), the AI agent
(D-4), Baileys 7.x (D-5), UUIDv7 (D-6), Turborepo and the queue driver (D-7). Each records what
it would cost to defer, which is the part usually lost — D-2 notes that consent *records* cannot
be backfilled, since you cannot invent evidence of an agreement that was never captured, which
is why that table exists now even though enforcement does not.

**Next:** the gateway process and the link/send API.

**Files:** `packages/db/migrations/0001,0004,0005`, `docs/21-deferred.md`, `docs/README.md`

---

## 2026-09-18 · Session 012 · A database that survives a restart

**Decided:** stay on local Docker with a **persistent named volume**, rather than a hosted dev
database. A managed provider needs payment details and another account to juggle, for a benefit
(querying from any device) that is pinned as D-1 in `21-deferred.md` anyway. The portability fix
from the previous session stands regardless — migrations now work on a managed Postgres whenever
that becomes worth doing.

**Built:** `infra/scripts/dev-db.sh` with `up` / `down` / `reset` / `psql` / `status`, wired to
npm scripts. The container now mounts a named volume and restarts unless stopped.

**Two databases in one container**, which matters more than it sounds: `whatsapp_crm_dev` holds
real data **including WhatsApp session credentials**, and `whatsapp_crm_test` is where the suite
truncates freely. The integration test now reads `TEST_DATABASE_URL` and defaults to the test
database — previously it pointed at `DATABASE_URL`, so once numbers were linked, a routine
`npm test` would have destroyed their credentials and required re-linking every one. That was a
live footgun and it is now closed by construction.

`db:dev:reset` prompts for confirmation and says plainly that it deletes linked numbers.

**Verified:** wrote a marker row, **destroyed the container entirely** (`docker rm -f`), brought
it back, and the row was still there. Both databases migrated.

**Next:** the gateway process and the link/send API.

**Files:** `infra/scripts/dev-db.sh`, `package.json`,
`tests/integration/auth-state-store.test.ts`, `docs/20-orientation.md`

**Correction, same session.** The commit above went out with the integration suite failing —
`relation "org" does not exist`. Two mistakes:

1. Splitting dev and test into separate databases meant the test one also needed migrating, and
   I only migrated dev.
2. **My verification was broken, which is why I did not notice.** I checked with
   `grep -c "migrations applied" | xargs -I{} echo "test: applied"` — `xargs` runs the echo
   whether the count is 1 or 0, so it printed success unconditionally. Then I committed on the
   strength of it. `grep -c` needs its value inspected, not piped into an unconditional echo.

Fixed by adding `npm run db:setup` (brings the container up and migrates **both** databases) and
`npm run db:migrate:all`, so the two can no longer drift apart by hand. Confirmed inline env
vars do take precedence over Node's `--env-file-if-exists`, which is what makes the per-database
migrate scripts work. 70 tests green, both databases at 10 tables.

---

## 2026-09-18 · Session 013 · Inbound persistence, race-free

**Built:** `packages/core` with `storeInboundMessage`, `markMessageSent`, `markMessageFailed`
and `applyDeliveryStatus`. Also `channel_session` columns for the link handshake, and a Postgres
`NOTIFY` trigger channel so the API can hand work to the gateway.

**The command channel between API and gateway is a durable table plus `NOTIFY`**, not a message
broker. Durable because a send has to survive the gateway being down — the row stays `queued`
and is swept on boot. `NOTIFY` on top so the normal case is instant rather than waiting for a
poll. No extra service, which is what a Postgres-only deployment should look like.

**`storeInboundMessage` is a single statement**, deliberately. Resolving identity → contact,
upserting the conversation and inserting the message all happen in one round trip, so two
messages arriving at the same instant cannot produce two contacts or two conversations. The
previous system did this as a sequence of reads and writes and needed an in-process lock to
paper over the race — which stopped working the moment there was more than one process (M13).
The test fires eight concurrent messages from the same unknown number and asserts **1 contact,
1 conversation, 8 messages**.

**`applyDeliveryStatus` refuses to move a message backwards.** Receipts arrive late and out of
order; a stale `sent` must not undo a `read`. Enforced in the `WHERE` clause with a status rank,
and tested by applying them in reverse.

**Two gotchas found, both now commented in the code:**
- **Drizzle's `sql` tag cannot bind a `Date` through `db.execute`** on the postgres.js driver —
  it throws *"the string argument must be of type string … received an instance of Date"*.
  Isolated with a two-line repro; the fix is `.toISOString()` and letting Postgres cast.
- A test counted rows across the whole test database rather than its own orgs, so it passed
  alone and failed in suite. Scoped to the orgs it creates.

**Verified:** 81 tests. Including that the body is encrypted (the plaintext is not in the row),
a redelivered message is a no-op that *reports* itself as such, a `@lid` privacy address becomes
its own identity kind rather than a phone, a closed conversation reopens on new inbound, and the
same number in two orgs is two different people.

**Next:** the gateway process itself, then the HTTP endpoints.

**Files:** `packages/core/**`, `packages/db/src/schema.ts`,
`packages/db/migrations/0006_link_handshake.sql`, `tests/integration/inbound-messages.test.ts`,
`package.json`

---

## 2026-09-18 · Session 014 · A startup check that measures isolation instead of assuming it

**Built:** `inspectDatabaseSecurity()`, run during the gated startup sequence before the server
accepts traffic, plus a `setTenant()` helper. Warns rather than refuses, because single-tenant
and local development are legitimately fine without isolation.

**Why it measures rather than reads role attributes.** Three different things defeat row-level
security and they are easy to confuse: being a superuser, holding `BYPASSRLS`, or owning the
table (owners bypass unless the table is `FORCE`). In all three cases `pg_tables.rowsecurity`
still reports `true` — **the policies look enabled while enforcing nothing.** So the probe
writes a row under one org inside a transaction, switches the session to a different org, tries
to read it back, and always rolls back. Confirmed in psql first: as superuser `dev` the other
tenant's row is visible (`t`); as `crm_app` it is not (`f`).

**Two bugs in my own security check, found by not trusting it.** Both produced a *false pass*,
which is the worst possible failure mode for a check like this:

1. The first version just read from `contact` with no context. On an empty table "no rows"
   is indistinguishable from "isolation working". Fixed by having the probe create its own row.
2. **`SET LOCAL` cannot take a bind parameter.** `SET LOCAL app.org_id = $1` is a syntax error,
   so the probe threw, and the error handling treated that as "stricter than isolation" and
   reported a pass. This one matters well beyond the probe — it is how the application must set
   tenant context on *every* transaction. The answer is `SELECT set_config('app.org_id', $1,
   true)`, which binds safely; interpolating into `SET` instead would make the one setting that
   decides which tenant's data is visible an injection point. Documented in `09-security.md`
   and wrapped in `setTenant()` so nobody has to remember it.

**Verified both directions**, because a check that only ever fails is as useless as one that
only ever passes: superuser → `isolationEffective=false`, 2 warnings; `crm_app` →
`isolationEffective=true`, 0 warnings. 85 tests.

**Pinned D-1b** in `21-deferred.md`, separating three things that all get called "Drizzle":
schema definitions and drizzle-kit migrations are **in use and load-bearing** (migrations are
generated from them); the **query builder** is parked, since every query so far is raw SQL
through the `sql` tag; **Studio** is parked as D-1. The honest cost of parking the builder is
typed results — hence all the hand-written `(rows as unknown as Array<...>)` assertions — and
what brings it back is one of those assertions being wrong and letting a bug through.

**On the existing Supabase project:** flagged not to delete it yet. JobPortal's `.env.example`
documents it as *"your Supabase Postgres"*, its shared dev database. This CRM needs nothing
from it.

**Next:** the gateway process, then the HTTP endpoints.

**Files:** `packages/db/src/security-check.ts`, `packages/db/src/index.ts`,
`apps/api/src/server.ts`, `tests/integration/security-check.test.ts`, `docs/09-security.md`,
`docs/21-deferred.md`

---

## 2026-09-18 · Session 015 · Refuse to start against the wrong database

**Gap found by a good question:** nothing verified the database matched the code. Forget to
migrate and the server booted happily, then failed on the first query with an error naming a
missing column rather than the cause. That contradicted the gated-startup rule (M6).

**Built:** `verifySchema()`, run before the server listens. **Fatal**, unlike the isolation
warning — if migrations are outstanding, queries *will* fail, so failing at boot with an
actionable message is strictly better. Four situations, all verified against purpose-built
databases rather than only the happy path:

| Situation | Message |
|---|---|
| Never migrated | `this database has never been migrated … Run: npm run db:migrate` |
| Migrations outstanding | `1 migration(s) have not been applied (6 of 7) …` |
| A required table missing | `missing 1 required table(s): message …` |
| **Database ahead of the code** | `the database is AHEAD of this code: 7 applied but only 6 exist in this checkout` |

The fourth is the one worth having. It happens when you check out an older commit without
rolling the database back, and the failure it otherwise causes — a column the code does not know
about — looks completely unrelated to the cause.

Required tables are checked **by name** rather than by diffing the whole schema. A full diff is
stricter but fails on harmless differences (an index added by hand, a column another tool
created), and a check that cries wolf gets ignored.

**Process note:** `pkill -f "apps/api/src/server.ts"` inside a compound command kills the shell
running it, because the pattern matches that shell's own command string. It silently ate the
back half of a command — the test file and the commit never ran. Not using it in compound
commands again.

**Next:** the gateway process.

**Files:** `packages/db/src/schema-check.ts`, `packages/db/src/index.ts`,
`apps/api/src/server.ts`, `tests/integration/schema-check.test.ts`

---

## 2026-09-18 · Session 016 · The gateway

**Built:** `apps/gateway` — `main.ts` (the process) and `work.ts` (the handlers), plus
`npm run gateway`.

**Why its own process, concretely:** it owns long-lived authenticated sockets, one per number,
which must not die when the API restarts. `npm run dev` uses `tsx watch`, so sharing a process
would drop every WhatsApp connection on each file save. It is also deliberately dumb — it owns
sockets and knows nothing about campaigns, consent, pacing or policy. Work arrives as database
rows and results go back the same way, so every safety gate stays above it and nothing can
bypass them by reaching a provider directly (M12).

**What it does:** on boot, verifies the schema (same gate as the API), reconnects every
`active` sender from stored credentials, then sweeps for work left behind. Then it listens on
the Postgres `gateway` channel for link and send commands, consumes inbound messages and
delivery receipts, and sweeps again every 60 s as a safety net in case a `NOTIFY` is missed.

**Design decisions worth recording:**
- **A send to a disconnected sender stays `queued`, it does not fail.** A message is not wrong
  because the socket is briefly down; the sweep picks it up when the number reconnects.
- **No retries here, deliberately.** Retrying into WhatsApp is precisely how a number gets
  banned, so retry belongs in the dispatcher with the rest of the pacing (P6), not in a loop
  with no idea how fast it is going. For now a genuine send failure is recorded and left.
- **A link failure is written to `channel_session.link_error`** rather than only logged, so the
  API can tell the caller instead of leaving them polling an endpoint that never resolves.

**Verified end to end, with no phone involved.** 99 tests, 12 of them driving the gateway
handlers against the real database through the fake provider: a queued message is sent and
records its provider id; a disconnected sender leaves it queued; **one failing recipient is
recorded as failed while the next send still works** (M26); a duplicate `NOTIFY` does not send
twice; the sweep picks up work queued while the gateway was down; sessions restore.

Then the real process, against real Postgres: started it, inserted a queued message directly as
the API will, and **the trigger fired, the `NOTIFY` woke the gateway, the handler ran and
correctly left the message queued** because nothing is linked.

**Contract divergence found and recorded as a test rather than a comment:** the real Baileys
adapter rejects a pairing-code link with no phone number; the fake accepts it. The contract
suite does not assert this, so an adapter could diverge here unnoticed. Worth adding to the
suite.

**Cleanup:** all child processes killed, ports 3000 and 4983 free, test fixtures deleted.

**Next:** the HTTP endpoints, then a minimal UI.

**Files:** `apps/gateway/**`, `package.json`, `tests/integration/gateway-work.test.ts`

**Follow-up, same session.** A hand-written RLS snippet handed over for verification was a trap:
`set_config(..., true)` and `SET LOCAL` are **transaction-scoped**, so running the statements
one at a time silently does nothing — the setting expires before the next statement, `SET LOCAL
ROLE` only warns *"can only be used in transaction blocks"*, and the answer comes back as the
superuser with no tenant set. It looks exactly like isolation being broken.

Replaced with `infra/scripts/rls-demo.sql`, which must be run as one unit and says so at the
top. It asserts four cases: superuser sees another tenant's row (1), `crm_app` does not (0),
`crm_app` sees its own (1), and `crm_app` writing into another tenant **errors** — RLS blocks
writes, not just reads. Everything rolls back.

Evidence the snippet had gone wrong, rather than isolation: the leftover row was named
`x`/`x-test`/`visible?` — from the snippet — and it had **committed**, so the `ROLLBACK` never
ran. Reproducing the statements outside a transaction yields exactly the `1` that was reported.
Cleaned up.

---

## 2026-09-18 · Session 017 · The HTTP API — P3 complete

**Built:** `apps/api/src/auth.ts` plus `routes/senders.ts` and `routes/messages.ts`.

**Auth first, not last.** `API_KEY` is **required** config, not optional-with-a-warning —
optional auth is how software reaches production with none (M16). Compared with
`timingSafeEqual`, because `===` returns sooner the earlier two strings differ and over enough
attempts leaks the key. A wrong key and a missing key get byte-identical responses: telling them
apart tells an attacker their key format is right.

Mounted as **one guard over the whole `/api/v1` router** rather than per route, so a new
endpoint cannot be added unprotected by omission.

**Tenant resolution fails closed.** With more than one org the request is refused (409
`MULTIPLE_ORGS`) rather than guessing — a config-level key cannot say which tenant it speaks
for, and choosing one would be a cross-tenant leak waiting to happen. Per-org keys are P2.

**Endpoints:** `GET/POST /senders`, `POST /senders/:id/link`, `GET /senders/:id/link`,
`POST /messages`, `GET /conversations`, `GET /conversations/:id/messages`.

**Design decisions worth recording:**
- **`POST /messages` returns 202, not 201.** It *queues*; the gateway sends. A route that could
  reach a provider directly would be a way around the pacing and policy gates, which is exactly
  the hole the previous system had (M12).
- **Linking returns 202 and a URL to poll**, not the QR. The socket lives in the gateway
  process, so the challenge arrives a moment later on the same row.
- **A landline is refused at the API boundary**, with the line type named. A doomed send costs
  the sender's delivery ratio, which feeds its health score.
- **404, not 403, for a resource in another tenant.** Confirming something exists elsewhere is
  itself a leak.
- **An undecryptable body is reported, not hidden.** It usually means the encryption key
  changed; showing an empty message would make that look like data loss.

**Verified end to end against the real gateway and real WhatsApp servers:**
401 with no key and with a wrong key, 200 with a valid one · created a sender · a landline
refused with *"looks like a fixed_line number"* · junk refused · `NO_ACTIVE_SENDER` with the
next step spelled out · then `POST /senders/:id/link` → 202 → polled twice → **a genuine
WhatsApp QR string (237 chars, `2@CNOPVOBB…`) delivered through HTTP.** That is P3 complete:
link, send and receive all reachable over the API.

**115 tests.** All processes killed afterwards, ports free, fixtures deleted.

**Next:** a minimal UI — the first thing worth opening in a browser.

**Files:** `apps/api/src/auth.ts`, `apps/api/src/routes/**`, `apps/api/src/app.ts`,
`apps/api/src/server.ts`, `packages/shared/src/config.ts`, `.env.example`,
`tests/integration/api.test.ts`

**Correction, same session.** The commit above was pushed with **4 failing tests** — the second
time in this project I have committed on an unverified check. Both times the cause was the
same: running `npm run check` and `git commit` in one command, where the check's result does
not gate the commit. From here the check runs as its own step and its **exit code** is
inspected before anything is committed.

The failures themselves were a **parallelism race, not a real defect**. Vitest runs test files
in parallel by default; `api.test.ts` truncates `org` in `beforeEach`, which destroyed fixtures
other files were holding (foreign key violations) while their orgs made the API see multiple
tenants and correctly refuse with 409. Every affected test **passed alone and failed in suite**,
which is the most confusing failure mode available.

Fixed with `fileParallelism: false`, with the reasoning recorded in `vitest.config.ts`. These
are all integration tests against one shared database, so they should not race. The cleaner
answer — a database per file — is worth doing when the suite is slow enough to care; serial
takes 7 seconds today. 115 tests green, `npm run check` exit code 0.

---

## 2026-09-18 · Session 018 · Handoff

**Built:** `HANDOFF.md` — a point-in-time snapshot for continuing in a new chat, as distinct
from this file, which is the append-only history. Covers: what the project is, where the build
is (P3 complete, 115 tests, 20 commits), what works and what explicitly does not, the pending
live test with the exact numbers and message id, how to run everything, the decisions that
would be expensive to re-litigate, the working preferences, and a list of **gotchas already
paid for** so they are not rediscovered — `SET LOCAL` not taking bind parameters, both tenant
settings being transaction-scoped, superusers silently bypassing RLS, Drizzle refusing to bind
a `Date`, `text → jsonb` needing `USING` with the default dropped first, Vitest file
parallelism corrupting shared-database fixtures, libphonenumber's default metadata accepting
junk, `pkill -f` killing its own shell, and Postgres roles being cluster-wide.

**Clarified:** the live test is a genuine two-phone test — **9035524447** is the number being
linked (Kushal's own), **+919380727007** is an unrelated recipient. Not self-messaging, which
would have been a weaker test since Baileys sending to its own JID can behave oddly. He is also
exercising the API through Insomnia.

**State left clean:** one message queued and waiting in `whatsapp_crm_dev`, one sender row, no
processes running, ports free. The queued message is deliberate — the moment a number is linked,
the gateway's boot sweep sends it, so that single test covers the send path and restart
durability together.

**Next:** P4, a minimal inbox UI.

**Files:** `HANDOFF.md`, `README.md`

---

## 2026-09-19 · Session 019 · Encryption, explained and audited

**No code changed.** This session was planning and documentation, prompted by picking P4 back
up and immediately hitting the API-key question.

**Where it started.** Flagged that `requireApiKey` resolves the tenant by *guessing* — `SELECT
id FROM org LIMIT 2`, 409 if more than one — so a second org is a hard block, not a feature
gap. Kushal's response reframed it correctly: keys need to be **auto-issued**, because nobody
outside the two developers knows how to mint one.

**The reframe that mattered.** `docs/05-data-model.md:123` already settles the human half —
*"Sessions are for the first-party UI only; integrations always use a key."* The recruiter never
needs an API key; they need a **login**. The only thing needing a key is JobPortal, a machine.
Three credentials, not one: session cookies for people, `api_key` rows for integrations, and the
bootstrap problem for the very first admin.

**Findings while reading.** `app_user` and `org_membership` exist and are marked ✅ but hold
**zero rows** — there is no signup, login, session or invite anywhere, so "auto-issue a key at
signup" currently rests on a flow that does not exist. The one org is named `Dev`, created as a
side effect of `scripts/wa-link.ts:37`. Noted that `docs/06-features/F11-admin.md:21` calls out
hardcoding "Hiring Studios" as the exact anti-pattern that made the old system un-reusable — so
Hiring Studios is **a row, not a constant**, and the `Dev` row should simply be renamed.

**Decided:** invite-only now, with provisioning factored as one `createOrgWithAdmin()` service so
a future self-serve `/signup` is a thin caller. Not built yet.

**Parked (Kushal's call):** the self-serve setup wizard, guided walkthrough and whitelabelling
are their own phase — roughly P12 plus F11's branding slice. Not yet written into
`docs/21-deferred.md`.

**Then the encryption questions**, which turned out to be the substance of the session: what a
DEK is, what an "envelope" is, what kind of keys these are, and why rotation needs two keys at
once. One genuine misunderstanding surfaced and was worth resolving in writing — *"how can v1
decrypt v2 data?"*. It cannot. The driver holds a **keyring**, each row names its own key
through the `keyVersion` byte, nothing crosses over, and the mixed state self-liquidates when
the backfill finishes.

**Built:** `docs/22-encryption.md` — the byte layout, the write path, the read path, the blind
index and why its key is frozen, rotation as three phases, hygiene-vs-compromise rotation, and
DEK/KEK. Linked from `docs/README.md` and from `09-security.md`, whose encryption section is
intent only and now says so.

**Four gaps recorded, found by reading the code against the docs:**

1. `LocalKms` holds exactly one key version and throws on any other — **rotation is impossible
   in practice.** The `keyVersion` byte exists with nothing to point at.
2. No per-org DEK. One global key encrypts directly, while `09-security.md` describes an
   `org_encryption_key(org_id, key_version, wrapped_dek)` table that **does not exist**.
3. No backfill job, so even with (1) fixed, phase 2 of a rotation has no implementation.
4. `09-security.md` lists `contact_identity.value_enc` among encrypted columns. **There is no
   such column** — identities sit in clear in `value_normalized`, which carries the UNIQUE
   lookup index. Encrypting it needs the encrypt-plus-blind-index pattern already used for
   message bodies, with uniqueness moved onto the digest.

Two claims in the first draft of the doc were wrong — a `contact.phone_e164` column and a
populated `contact_identity.value_enc`. Neither exists; both were caught by checking the schema
before committing rather than after.

**Also corrected:** an earlier statement this session that message-body encryption was deferred
P4 work. It is already built, on both the send and receive paths — which means the blast radius
of a lost `ENCRYPTION_KEY` is at full size **today**, not later.

**Next:** unchanged — P4.1, a minimal inbox UI. The open question before key work starts is
whether the DEK refactor rides along with `api_key` + login, since it is much cheaper now than
once there is real message history to re-encrypt.

**Files:** `docs/22-encryption.md`, `docs/README.md`, `docs/09-security.md`, `CONTEXT.md`

---

## 2026-09-19 · Session 019b · P4.1 — the inbox UI

**Built the first thing worth opening in a browser.** `apps/web`, a Next.js 15 App Router app,
per the decision already recorded in `docs/04-architecture.md:92`. Kushal's call was explicit:
stick to the documented stack, and *"better to be steady"* than to hit today's deadline with a
throwaway static page.

**What it does.** Conversation list, thread view with decrypted bodies and per-message delivery
status, and a composer. Polls every five seconds via `router.refresh()` — real-time over SSE is
a later P4 slice, and polling keeps connection state off the server entirely.

**The key never reaches the browser.** Every call goes through `lib/crm.ts`, which runs server
side only, and sending is a server action. Nothing is prefixed `NEXT_PUBLIC_`.

**Vulnerability triage, asked for first.** Nine advisories, **none reachable**. The only
production dependency affected is `drizzle-orm` (HIGH, SQL injection via unescaped identifiers)
and its attack surface — `sql.raw` / `sql.identifier` — appears nowhere in the codebase; every
`${}` inside a `sql` tag is a bind parameter. The CRITICAL is `vitest`, a devDependency whose
advisory needs the Vitest **UI server**, which `vitest run` never starts. The rest is dev
tooling, some of it Windows-only. Both real fixes are breaking major bumps, so they were
deliberately **not** applied hours before a demo. Adding Next pulled in one more — a transitive
PostCSS path traversal via `sourceMappingURL`, in CSS we author ourselves. Also not reachable.

**Two defects caught by checking rather than assuming:**

1. The sidebar first read "1 number linked" off `sender_identity.status`, which is `'active'`
   from the moment a row is created. **No number has ever been linked.** The honest signal is
   `channel_session.connection_state = 'open'`, which is null until a QR is actually scanned —
   the senders route's own comment says a sender "is not connected until it has been linked".
   It now reads "Not connected" and says what to run.
2. `/inbox` came out of the production build marked **○ Static**. The build reached a running
   API, succeeded, and baked the conversation list in — so production would have served the
   inbox as it looked at deploy time. Fixed with `export const dynamic = 'force-dynamic'` and
   verified it flips to ƒ.

**One API change:** the conversations endpoint now returns `contactPhone`. Without it a reply
has no address, because `POST /messages` addresses by phone, not conversation id. Deliberately a
correlated subquery rather than a join — a contact can hold several phone identities, and a join
would silently duplicate the conversation row. Two tests cover it, including that case.

**Verified in a real browser**, not just by typecheck: list renders, thread renders with the
queued message decrypted, composer queues a message that appears in the thread and updates the
sidebar count. Enter-to-send needed a properly-formed keydown to prove out — the automation's
synthetic key event does not reach React, the handler is fine.

**Two test messages created and deleted by id.** The database is back to exactly the one
original queued message, `a90a2922`, so the pending live test is untouched.

**Housekeeping:** `next build <dir>` breaks on Next's internal `/_not-found`, so `web:build`
runs through the workspace instead. `NEXT_TELEMETRY_DISABLED=1` on both web scripts, because
`docs/19-capacity.md` says telemetry is off by default and Next phones home otherwise.
`apps/web` is excluded from the root tsconfig — it needs DOM, JSX and React types that do not
belong in the Node server config — and `npm run check` now runs `typecheck:web` as its own step.
`next-env.d.ts` is gitignored: it references a file inside `.next/`, so committing it would
break a fresh clone's typecheck. Verified typecheck passes with both generated files absent.

**117 tests, exit code 0.** Servers killed, ports 3000 and 3001 free.

**Still true and still the blocker:** no number is linked, so nothing can actually send. The
live test needs a human with a phone. And there is still **no rate limiting, warmup or pacing** —
P6 — so this is safe for a handful of messages to people who reply, and unsafe pointed at a list.

**Next:** link a number and watch `queued → sent → delivered → read` through the UI. Then P4's
real exit criterion — two agents on one inbox — which needs login, sessions and `api_key`.

**Files:** `apps/web/**`, `apps/api/src/routes/messages.ts`, `tests/integration/api.test.ts`,
`package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example`
