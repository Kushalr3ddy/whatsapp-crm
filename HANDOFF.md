# Handoff — state as of 2026-09-18

A point-in-time snapshot for picking this up in a new session. For *how the project got here*
read [`CONTEXT.md`](CONTEXT.md), the append-only session log. For *what it is*, read
[`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the whole
stack assuming no prior knowledge.

---

## What this is

A generic, self-hostable WhatsApp CRM: shared inbox, contacts, bulk outreach, pluggable data
ingestion, public API. **Not** recruitment software — it has no `candidate` or `job` tables, and
that is deliberate. The sibling project `Mikhil31/JobPortal` will consume it over HTTP as one
module among others.

Two WhatsApp transports, chosen per message by intent: **Baileys** (free, unofficial, bannable)
for bulk outreach, and the **Meta Cloud API** (paid, official) for anything the business depends
on. The Meta side is not built yet.

Repo: **`github.com/Kushalr3ddy/whatsapp-crm`** (private) · local: `/home/kushal/everything/whatsapp-crm`

---

## Where the build is

**P3 complete.** Phases are in [`docs/17-roadmap.md`](docs/17-roadmap.md).

| | | |
|---|---|---|
| P0 | Docs — 40 files, ~4,900 lines | ✅ |
| P1 | Skeleton — Express, config gate, migrations, CI | ✅ |
| P2 | Core domain — orgs, contacts, identities, RLS | partial |
| **P3** | **Channels — Baileys adapter, gateway, HTTP API** | **✅** |
| P4 | Inbox UI | **next** |
| P5 | Data ingestion (Excel/CSV first, then Sheets, portal API, job boards) | |
| P6 | Anti-ban engine | |
| P7+ | Campaigns, Meta adapter, automation, hardening, release | |

**115 tests, 35 source files (~3,600 lines), 7 migrations, 20 commits.**

### What actually works right now

- Server boots with a **gated startup**: config validated → schema verified → isolation checked → listen
- Postgres with RLS forced on every tenant table
- Baileys adapter: link by QR **or pairing code**, send, receive, typed disconnect handling
- WhatsApp credentials encrypted in Postgres, so **sessions survive a restart**
- Gateway as its own process, commanded through a durable table + `NOTIFY`
- HTTP API: senders, async linking, queue a message, read conversations
- **Verified against real WhatsApp servers**: a genuine QR (`2@CNOPVOBB…`) delivered over HTTP

### What does not exist

No UI. No campaigns. No **anti-ban engine** — so there is no rate limiting, warmup or pacing
anywhere in the send path yet. No Meta adapter. No Excel import. No per-org API keys. No
deployment anywhere.

---

## The pending live test

A message is **queued in the database right now**, waiting for a number to be linked:

| | |
|---|---|
| Recipient | **+919380727007** — unrelated phone, for this test only |
| Number to link | **9035524447** — Kushal's own |
| Message id | `a90a2922-e63a-4dcb-8e68-3e9c2bb2a396` |
| Status | `queued` |

Nothing sent it because linking needs a human to scan a QR. **The moment a number is linked,
the gateway's boot sweep sends it** — which makes this one test cover the send path *and*
durability at once.

```bash
npm run gateway     # terminal 1 — will report pendingSends: 1
npm run wa:link     # terminal 2 — scan the QR from Settings > Linked Devices
npm run db:query "SELECT direction, status, sent_at, delivered_at, read_at FROM message;"
```

Expect `queued → sent → delivered → read`. Replying exercises the inbound path; the thread
should then hold two rows.

Kushal is also testing the API with **Insomnia**. Key is `API_KEY` in `.env`, sent as
`Authorization: Bearer <key>`.

---

## Running it

```bash
npm install
cp .env.example .env         # then fill in the required values
npm run db:setup             # container + migrate BOTH databases
npm run dev                  # API on :3000
npm run gateway              # separate process — owns the WhatsApp sockets
npm run check                # typecheck + lint + 115 tests
```

`npm run` lists every script. `docs/20-orientation.md` explains how npm scripts work, and every
term used in the docs.

Two databases in one container, and the distinction matters: `whatsapp_crm_dev` holds real data
**including WhatsApp session credentials**; `whatsapp_crm_test` is where the suite truncates.
Data persists in a named Docker volume.

---

## Decisions that would be expensive to re-litigate

| | Decision | Where |
|---|---|---|
| ADR-0002 | Baileys pinned **exactly** to `6.7.24`, not 7.x — RC churn, not the Rust dependency (that is WASM and harmless) | `docs/adr/` |
| ADR-0003/4 | **Express 5**, not NestJS, not Fastify — fewest new frameworks while learning, matches JobPortal | `docs/adr/` |
| — | Drizzle for **schema + migrations only**; queries are raw SQL through the `sql` tag | D-1b in `docs/21-deferred.md` |
| — | Single-tenant deploy on a **multi-tenant-ready** schema: `org_id` + RLS from migration 1 | `docs/05-data-model.md` |
| — | Everything behind a driver port with a **free self-hosted default** | `docs/18-providers.md` |
| — | Presets: `lean` (~1 GB, the default) / `standard` / `scale`. Telemetry, LLM, SMS, antivirus **off by default** | `docs/19-capacity.md` |
| — | **In-house beta only.** India data residency, DPDP enforcement and DLT parked | D-2 in `docs/21-deferred.md` |

Parked decisions with their trigger conditions live in [`docs/21-deferred.md`](docs/21-deferred.md).

---

## Gotchas already paid for — do not rediscover these

- **`SET LOCAL` cannot take a bind parameter.** `SET LOCAL app.org_id = $1` is a syntax error.
  Use `setTenant()` (`set_config(..., true)`), which binds safely. Interpolating into `SET`
  would make the setting that decides tenant visibility an injection point.
- **`set_config(..., true)` and `SET LOCAL` are transaction-scoped.** Pasted into psql line by
  line they silently do nothing and you get the superuser answer. Run
  `npm run db:rls-demo` instead.
- **Superusers and table owners bypass RLS**, and `pg_tables.rowsecurity` still reports `true`.
  The policies look enabled while enforcing nothing. `inspectDatabaseSecurity()` warns at boot.
- **Drizzle's `sql` tag cannot bind a `Date`** through `db.execute` on postgres.js. Pass
  `.toISOString()`.
- **`text → jsonb` needs `USING`**, and the column **DEFAULT must be dropped first** — the
  error names the column, not the default.
- **Vitest runs test files in parallel**; these integration tests share one database, so
  `fileParallelism: false` is set. Without it tests pass alone and fail in suite.
- **libphonenumber's default metadata accepts junk** (`1111111111` passes as an Indian number).
  The `max` bundle is used, which also distinguishes mobile from fixed-line — a landline cannot
  receive WhatsApp, so it is refused at the API boundary.
- **`pkill -f "<pattern>"` inside a compound shell command kills the shell running it**, because
  the pattern matches its own command string. Use `pgrep` then `kill` by pid.
- **Postgres roles are cluster-wide, not per-database** — which invalidates a role-permission
  test run against a second database in the same cluster.

---

## Working preferences

- **Commit and push straight to `main`. Never create branches.**
- **Never add a `Co-Authored-By` trailer** or any AI attribution to commits. Casual lowercase
  subject line, substantive body.
- **Step by step, feature by feature**, with an explicit go-ahead before large work.
- **Append to `CONTEXT.md` every session.** No exceptions — it is how intent survives.
- Every class, function, exported constant and type carries a 1–4 line comment saying what it
  is and *why* — lint-enforced (`docs/11-conventions.md`).
- **Run a command as written before handing it over.** Two were handed over broken.
- **Verify the exit code before committing.** Two commits went out with failing tests because
  `npm run check && git commit` in one command does not gate the commit.
- Kill child processes and clean up test fixtures when finished.

---

## The honest risk

Baileys is unofficial and violates WhatsApp's Terms of Service. A banned number is gone with no
appeal. **There is currently no rate limiting, warmup or pacing anywhere in the send path** —
that is P6. Until then this is safe for a handful of messages to people who reply, and unsafe
pointed at a list. Anything the business depends on should go through the paid Meta API.

---

## Next

1. **P4 — a minimal inbox UI.** The first thing worth opening in a browser.
2. Finish P2: contact custom fields, tags, segments, dedup/merge.
3. **P6 anti-ban before any bulk send.** Not optional.
4. Deployment, which is also when the production database gets decided — the trigger is the
   recruiter and the other dev needing to link their own numbers, which they cannot do against
   a laptop. Note: **`ENCRYPTION_KEY` must be backed up separately from the database**; losing
   it means losing every linked number and every stored message.
