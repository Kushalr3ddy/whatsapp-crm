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
