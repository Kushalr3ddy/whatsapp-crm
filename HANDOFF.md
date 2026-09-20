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
| P1 | Skeleton — Express, config gate, migrations, CI | ✅ |
| P2 | Core domain — orgs, users, sessions, API keys, RLS | **mostly** |
| P3 | Channels — Baileys adapter, gateway, HTTP API | ✅ |
| P4 | Inbox | **partial** |
| P5 | Ingestion · P6 Anti-ban · P7 Campaigns · P8 Meta | not started |

**169 tests · 72 source files · 12 of 35 specced tables · 8 migrations.**

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

### What does not exist

No media/file handling · no `audit_log` · no self-service password reset · no campaigns or
broadcast · **no rate limiting, warmup or pacing in the send path** · no Meta adapter · no
Excel import · no deployment.

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

Three processes, separate so restarting the API never drops a WhatsApp socket:

```bash
npm run dev       # API      :3000
npm run gateway   # owns the WhatsApp sockets — nothing sends without this
npm run web       # UI       :3001
```

Sign in at `localhost:3001/login`. `npm run check` runs typecheck, lint and 169 tests.

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

Parked decisions with trigger conditions: **D-1 … D-12** in [`docs/21-deferred.md`](docs/21-deferred.md).

---

## Known defects, not yet fixed

| Where | Problem |
|---|---|
| `routes/messages.ts` | A **malformed UUID returns 500** — `conversations/not-a-uuid/messages` reaches Postgres, the cast throws (22P02), and it surfaces as `INTERNAL_ERROR`. Wants a 422, or 404 to match the "404 not 403" rule. Path params are not validated; bodies are |
| `routes/*.ts` | `problem()` hardcodes **`"status": 0`** in the body while the real code goes in the status line. `auth.ts` builds its own correctly with the real number, so `body.status` disagrees between routes |
| `docs/05-data-model.md` | The ✅/⬜ markers are **stale** — 7 marked built, 12 actually exist |
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
- **`SET LOCAL` cannot take a bind parameter.** Use `setTenant()` (`set_config(..., true)`).
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

1. **`audit_log`** — "who did this" is still unanswerable, and it is worth having *before*
   there are CVs to read rather than retrofitted after.
2. **Finish P4** — assignment, collision detection, notes, canned replies, search, realtime.
   The role columns exist and nothing populates them; an agent and an admin see the same inbox.
3. **Media** — a filesystem `StorageDriver`, a media reference on `message`, download in the
   gateway, a streaming endpoint. See **D-11**, and note that serving safely is the part that
   must not be deferred.
4. **P6 anti-ban before any bulk send.** Not optional.
5. **Deployment**, which is also when the production database gets decided. Note:
   **`ENCRYPTION_KEY` must be backed up separately from the database** — losing it means losing
   every linked number and every stored message.
