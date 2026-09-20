# Handoff — state as of 2026-09-20

A point-in-time snapshot for picking this up in a new session. For *how the project got here*
read [`CONTEXT.md`](CONTEXT.md), the append-only session log. For *what it is*, read
[`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the whole
stack assuming no prior knowledge.

---

## What this is

A generic, self-hostable WhatsApp CRM: shared inbox, contacts, bulk outreach, pluggable data
ingestion, public API. **Not** recruitment software — it has no `candidate` or `job` tables, and
that is deliberate. The sibling project `Mikhil31/JobPortal` will consume it over HTTP.

Two WhatsApp transports, chosen per message by intent: **Baileys** (free, unofficial, bannable)
for bulk outreach, and the **Meta Cloud API** (paid, official) for anything the business depends
on. The Meta side is not built.

Repo: **`github.com/Kushalr3ddy/whatsapp-crm`** (private) · local: `/home/kushal/everything/whatsapp-crm`

---

## Where the build is

| | | |
|---|---|---|
| P0 | Docs — 42 files | ✅ |
| P1 | Skeleton — Express, config gate, migrations, CI | **overstated** |
| P2 | Core domain — orgs, users, sessions, API keys, RLS | **mostly** |
| P3 | Channels — Baileys adapter, gateway, HTTP API | ✅ |
| P4 | Inbox | **partial** |
| P5 | Ingestion · P6 Anti-ban · P7 Campaigns · P8 Meta | not started |

**P1 is marked done but is not.** `infra/compose/` holds only a `.gitkeep`, so
`docker compose --profile core up` — its own exit criterion — cannot run. Of the four drivers
it called for (`storage` `email` `kms` `secrets`) only **kms** and now **storage** exist.

**255 tests in 20 files · 70 source files · 14 of 35 specced tables · 10 migrations · 53 commits.**

### What actually works

- **A real message was sent and delivered** on 19 September, end to end, to a real phone.
- Gated startup: config validated → schema verified → isolation checked → listen.
- Postgres with RLS forced on every tenant table.
- Baileys: link by **QR or pairing code**, send, receive, delivery receipts, **automatic
  reconnect**. Credentials encrypted in Postgres, so sessions survive a restart.
- Gateway as its own process, commanded through a durable table + `NOTIFY`.
- **Authentication**: argon2id passwords, server-side sessions, per-org API keys with scopes,
  CSRF, login throttling, `npm run admin` for provisioning and support.
- **Web UI**: sign-in, inbox (list · thread · composer), link screen with live QR and
  countdown, light/dark, Broadcast and Billing placeholders.
- **`audit_log`**: append-only, RLS'd, `UPDATE`/`DELETE` revoked from the app role, written in
  the same transaction as the change it describes. Covers authentication and admin actions.
- **Storage**: `StorageDriver` port + filesystem driver + a **contract suite** (25 tests) that
  every future backend must pass.
- **Media**: attachments are downloaded by the gateway, typed from **magic bytes**, stored
  under unguessable keys, deduplicated per org by `sha256`, and served by
  `GET /api/v1/media/:id` — always `Content-Disposition: attachment`, never inline, `nosniff`,
  `private, no-store`, resolved file → message → conversation → org on every request. A
  message whose file could not be fetched is kept and marked `mediaUnavailable`.
- **Read auditing (D-13)**: `conversation.read` and `media.downloaded`, written before the
  transfer starts so an abandoned download still counts. Inbox listing is deliberately not
  audited.
- **Row-level security on the request path**: every tenant query runs in a transaction with
  `app.org_id` set, and — because the app connects as a role that would otherwise bypass
  policies entirely — drops to the restricted `crm_app` role for the length of that
  transaction. The data routers hold no pool handle, so a new route cannot query around it.
  Proved by tests that query with **no `org_id` filter** and watch Postgres withhold the rows.

### What does not exist

No **outbound** media — receiving and serving work; sending a file does not · no encryption at
rest for files, no retention job, no antivirus (all D-11) · no self-service password reset ·
no campaigns or broadcast · **no rate limiting, warmup or pacing in the send path** · no Meta
adapter · no Excel import · no deployment.

---

## The honest risk

Baileys is unofficial and violates WhatsApp's Terms of Service. A banned number is gone with no
appeal. **There is still no rate limiting, warmup or pacing anywhere in the send path** — that
is P6. Safe for a handful of messages to people who reply; unsafe pointed at a list.

---

## Running it

See [`README.md`](README.md) for the full verified setup. Short version:

```bash
npm install && [ -f .env ] || cp .env.example .env    # then fill the five secrets
npm run db:setup
npm run admin -- org --name "Hiring Studios" --slug hiring-studios --email you@example.com
```

**On this machine that is already done.** The org is **Hiring Studios** (`hiring-studios`,
`5f82ad62-…`) with one admin, `developer@hiringstudios.com`. `npm run admin -- whoami` lists
organisations; `npm run admin -- password --email developer@hiringstudios.com` sets a new
password and ends every session on the account.

Three processes, separate so restarting the API never drops a WhatsApp socket:

```bash
npm run dev       # API      :3000
npm run gateway   # owns the WhatsApp sockets — nothing sends without this
npm run web       # UI       :3001
```

Sign in at `localhost:3001/login`. `npm run check` runs typecheck, lint and 255 tests.

---

## Decisions that would be expensive to re-litigate

| | Decision |
|---|---|
| ADR-0002 | Baileys pinned **exactly** to `6.7.24`, not 7.x |
| ADR-0003/4 | **Express 5**, not NestJS, not Fastify |
| — | **Next.js 15** App Router for the UI (`docs/04-architecture.md`) |
| — | Drizzle for **schema + migrations only**; queries are raw SQL through the `sql` tag |
| — | Single-tenant deploy on a **multi-tenant-ready** schema: `org_id` + RLS from migration 1 |
| — | Everything behind a driver port with a **free self-hosted default** |
| — | **Authorisation is never delegated** — an IdP may authenticate; roles stay local |
| — | **Email is optional**; every flow using it keeps a non-email path |
| — | The `.env` `API_KEY` is a **bootstrap credential**: provisioning only, refused on data |
| — | The UI **forwards the user's session**; it holds no machine credential |

Parked decisions with trigger conditions: **D-1 … D-13** in [`docs/21-deferred.md`](docs/21-deferred.md).

---

## Known defects, not yet fixed

| Where | Problem |
|---|---|
| `routes/messages.ts` | A **malformed UUID returns 500** — `conversations/not-a-uuid/messages` reaches Postgres, the cast throws (22P02), and it surfaces as `INTERNAL_ERROR`. Wants a 422, or 404 to match the "404 not 403" rule. Path params are not validated; bodies are |
| `routes/*.ts` | `problem()` hardcodes **`"status": 0`** in the body while the real code goes in the status line. `auth.ts` builds its own correctly with the real number, so `body.status` disagrees between routes |
| **Gateway** | Writes inbound messages and attachments as the connecting role, outside the tenant transaction the API now uses. Not a leak — it is not serving anyone's request — but it is the remaining place where a forgotten `org_id` would not be caught by the database |
| Media | A file whose bytes fail to store leaves the message without it and **only a log line says so** — there is no retry and nothing surfaces it for an operator. Also: no size cap on a download yet (D-11 records the quota question) |
| `infra/compose/` | **Empty.** There is no compose file, so the documented `docker compose --profile core up` does not exist |
| Login throttle | **In-process**, so several replicas would each count separately (P9) |
| `api_key.rate_limit_per_min` | Stored and **enforced nowhere** |

---

## Gotchas already paid for — do not rediscover these

- **WhatsApp closes the socket with 515 `restart_required` immediately after a QR scan.** That
  is the *normal* last step of pairing, and the client must reconnect at once with the
  credentials it was just issued. Nothing reconnected, so every scan in this project's history
  stored credentials and left the number offline. An unfinished pairing then goes stale and the
  next attempt gets 401 `logged_out`.
- **A column describing live state must be written in both directions.** This project got it
  wrong three times: `sender_identity.status` went `active` and never came back;
  `channel_session.connection_state` went `open` and never came back; and neither was cleared
  when the gateway stopped. P6 will score sender health on exactly these columns.
- **Helper scripts must not invent tenants.** `wa-link.ts` used to `INSERT INTO org ... ON
  CONFLICT (slug) DO UPDATE` against a hardcoded `dev` slug, which is how an org row nobody
  could account for ended up in the database — and it cost two separate misdiagnoses before
  anyone traced it. It now refuses when there is no org, or more than one, and points at
  `npm run admin -- org`.
- **`SET LOCAL` cannot take a bind parameter.** Use `setTenant()` (`set_config(..., true)`).
- **A file's type must come from its bytes, never its name.** `detectMediaType` in
  `@crm/shared` is the only thing that decides it, and there is deliberately no signature for
  HTML or SVG — both are script execution contexts when served from our own origin, so they
  fall through to `application/octet-stream` and download instead.
- **Setting the tenant is only half of it — the *role* has to be one policies apply to.** A
  superuser, a BYPASSRLS role, or the owner of the table is not subject to RLS at all, and the
  default deployment connects as the owner. `dev` on this machine is a superuser, so every
  policy in the schema sat inert until the request path started issuing
  `SET LOCAL ROLE crm_app`. Measure with `resolveTenantRole()`; never conclude from `pg_roles`
  that a role will work, because it can exist and lack the grants.
- **`set_config(..., true)` and `SET LOCAL` are transaction-scoped.** Pasted into psql line by
  line they silently do nothing. Run `npm run db:rls-demo`.
- **Superusers and table owners bypass RLS**, and `pg_tables.rowsecurity` still reports `true`.
- **A policy with no `WITH CHECK` reuses its `USING` clause for inserts.** This is why
  `createOrgWithAdmin` must set `app.org_id` to the new org's id *before* inserting it —
  backwards, it fails under a correct role while appearing to work as the table owner.
- **`app_user`, `session` and `api_key` deliberately have no RLS**: resolving a credential is
  what establishes which org a request acts in, so a policy reading `app.org_id` cannot match.
- **Drizzle's `sql` tag cannot bind a `Date`** through `db.execute`. Pass `.toISOString()`.
- **`text → jsonb` needs `USING`**, and the column DEFAULT must be dropped first.
- **Vitest runs test files in parallel**; `fileParallelism: false` is set.
- **libphonenumber's default metadata accepts junk**; the `max` bundle is used.
- **`pkill -f` AND `pgrep -f` self-match** when the pattern appears in the compound command
  running them — killing the shell, exit 144. Use the bracket trick: `pgrep -f "next[ ]dev"`.
- **Postgres roles are cluster-wide, not per-database.**
- **`npm run web:build` fails while `npm run web` is running** — both write `apps/web/.next`.
- **A Next build regenerates `next-env.d.ts`**, which eslint lints even though git ignores it;
  it uses triple-slash references the rules forbid. It is in the eslint ignores.
- **`cp .env.example .env` over a working install destroys `ENCRYPTION_KEY`.** The README now
  guards it: `[ -f .env ] || cp …`.
- **`.env.*` does not match a backup named `.og_env` or `prod.env`.** `.*env` and `*.env` do.
- **There is a second Postgres on `127.0.0.1:5432`** on this machine. The project uses **5434**.
  A half-edited `DATABASE_URL` lands migrations in the other database.

---

## Working preferences

- **Commit and push straight to `main`. Never create branches.**
- **Never add a `Co-Authored-By` trailer** or any AI attribution. Casual lowercase subject,
  substantive body.
- **Step by step, feature by feature**, with an explicit go-ahead before large work.
- **Append to `CONTEXT.md` every session.** No exceptions.
- Every class, function, exported constant and type carries a 1–4 line comment saying what it
  is and *why* — lint-enforced.
- **Run a command as written before handing it over.**
- **Verify the exit code before committing.**
- **Do not change the runtime floor** (`engines`) to make something work. A dependency is
  smaller and more reversible than a Node version bump; that would be an ADR.
- Kill child processes and clean up test fixtures when finished.

---

## Next

1. **Show attachments in the inbox.** The API serves them and the UI does not yet render the
   `media` object on a message — a download link and a filename is the whole job. Then
   **outbound** media, which needs the send path to carry a file and `OutboundContent` to
   stop being text-only.
2. **Finish P4** — assignment, collision detection, notes, canned replies, search, realtime.
   `conversation.assignee_user_id` exists and nothing populates it, so an agent and an admin
   see the same inbox. `conversation_participant` (`docs/05-data-model.md`) is what powers
   collision detection: knowing someone else is already in a thread, so two people do not
   answer the same candidate fifteen seconds apart.
3. **Close out P1** — a compose file, and the `email` and `secrets` drivers, each with a
   contract suite like storage now has.
4. **P6 anti-ban before any bulk send.** Not optional.
5. **Deployment**, which is also when the production database gets decided. Note:
   **`ENCRYPTION_KEY` must be backed up separately from the database** — losing it means losing
   every linked number and every stored message, permanently.
