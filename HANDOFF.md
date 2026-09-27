# Handoff — state as of 2026-09-27

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
| P4 | Inbox — list/thread/composer, **assignment + status + filters** | **partial** |
| P5 | Ingestion — CSV import | **first slice** |
| P6 | Anti-ban — warmup, rate ceilings, jitter | **layers 1–2 of 6** |
| P7 | Campaigns — bulk send, paced | **first slice** |
| P8 | Meta Cloud API | not started |

**P1 is marked done but is not.** `infra/compose/` holds only a `.gitkeep`, so
`docker compose --profile core up` — its own exit criterion — cannot run. Of the four drivers
it called for (`storage` `email` `kms` `secrets`) only **kms** and now **storage** exist.

**364 tests in 28 files · 83 source files · 22 of 35 specced tables · 14 migrations · 75 commits.**

See [`CHANGELOG.md`](CHANGELOG.md) for the full done/todo ledger — this snapshot covers state,
defects and gotchas; the changelog covers what has been built and what is left, in order.

### What actually works

- **A real message was sent and delivered** on 19 September, end to end, to a real phone.
- Gated startup: config validated → schema verified → isolation checked → listen.
- Postgres with RLS forced on every tenant table.
- Baileys: link by **QR or pairing code**, send, receive, delivery receipts, **automatic
  reconnect**, and **unlink/re-link** — `POST /senders/:id/unlink` has the gateway log out and
  clear the stored credentials so a re-link issues a fresh QR (a web Unlink button drives it).
  This is the recovery path a corrupt session needs; there was none before. Credentials encrypted
  in Postgres, so sessions survive a restart.
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
- **Inbox collaboration (P4, chunk 1)**: `PATCH /conversations/:id` sets status (open/closed)
  and assignee (or unassigns with an explicit null); `GET /conversations` filters by status and
  by assignee (`me` / `unassigned` / a user id); `GET /users` lists org members for the picker.
  An assignee must belong to the org — `assignee_user_id` points at `app_user`, which has no
  tenancy of its own — so a foreign user is refused, a cross-org thread is a 404, and each field
  that actually moves writes its own audit row (`conversation.assigned`,
  `conversation.status_changed`). The web list has mine/unassigned/all + open/closed/any tabs,
  and the thread header an assignee dropdown and resolve/reopen. **No new tables** — reused
  columns already on `conversation`.
- **Notes and canned replies (P4, chunk 2)**: `internal_note` and `canned_reply` tables (migration
  0012, RLS forced, granted to `crm_app`). `POST/GET /conversations/:id/notes` — a note lives in
  `internal_note`, never `message`, so it cannot enter the send path the gateway reads; that is
  what makes "a note is never transmitted" (AC-4) true by construction, proved by a test.
  `GET/POST /canned-replies` — saved replies, unique shortcut per org. The thread interleaves
  notes with messages on one timeline; the composer has a Reply/Note toggle and a saved-reply
  picker that substitutes `{{name}}`. **Attachments also now render** in the thread as a download
  link, served through a web-side `/media/:id` proxy that forwards the session.
- **Thread lock (P4)**: a thread assigned to one agent can only be replied to by that agent until
  they resolve or reassign it — replying otherwise is `409 THREAD_ASSIGNED`. Signed-in agents only:
  an **admin overrides**, an **API key is exempt** (an integration is not a person claiming a
  thread). Server-enforced in `POST /messages`; the composer mirrors it and still allows a note. A
  deliberately simple stand-in for presence/collision, which is **pinned as D-17**; snooze, the
  Meta-window UI and keyboard shortcuts are **pinned as D-18**.
- **Mark-read and open-any-thread (P4)**: opening a thread now clears its unread badge —
  `unread_count` was incremented on every inbound and reset nowhere, so it only grew; the messages
  fetch zeroes it, and `POST /conversations/:id/read` is the explicit form. `GET /conversations/:id`
  fetches one conversation by id, so a thread past the recent-100 list cap can be opened (the thread
  page loads its details from it now, not from the capped list).
- **Read auditing (D-13)**: `conversation.read` and `media.downloaded`, written before the
  transfer starts so an abandoned download still counts. Inbox listing is deliberately not
  audited.
- **Campaigns (P7, first slice)**: create a draft, freeze the audience at start, and the
  gateway converts recipients into messages **only as fast as the anti-ban ceiling allows**.
  Recipients are the queue, so pausing is instant and a campaign cannot bury an agent's reply.
  The start response forecasts how many days it will take. Cancelled recipients are marked
  skipped with a reason, never dropped.
- **CSV import (P5, first slice)**: upload → dry run → commit. **Content-hash dedup**, so the
  same file cannot import twice whatever it is named; a deliberate re-import supersedes the
  old run. Ordered identity rules, phone normalisation on the way in, a per-row ledger, and a
  dry run that is the default. A sparse file cannot overwrite a name that is already there.
- **Send pacing (P6 layers 1–2)**: warmup ramp (20/36/65/117/210/378/680 then steady), per
  minute · hour · day ceilings, and a Gaussian-jittered 1.5–4 s pause before each send. Counted
  from the `message` table, so it survives restarts and replicas. A paced message is left
  queued, never failed. An override may only *lower* a ceiling.
- **Row-level security on the request path**: every tenant query runs in a transaction with
  `app.org_id` set, and — because the app connects as a role that would otherwise bypass
  policies entirely — drops to the restricted `crm_app` role for the length of that
  transaction. The data routers hold no pool handle, so a new route cannot query around it.
  Proved by tests that query with **no `org_id` filter** and watch Postgres withhold the rows.

### What does not exist

No **outbound** media — receiving and serving work; sending a file does not · no encryption at
rest for files, no retention job, no antivirus (all D-11) · no self-service password reset ·
**no way to create a contact except an inbound message or a CSV import** — `contacts:write` is
an enforceable scope with nothing behind it · no message templates (a campaign carries a plain
body) · **no anti-ban layers 3–6** — no typing simulation, circadian pacing, contact-graph
gates or health scoring · no Meta adapter · no Excel import · no deployment.

---

## The honest risk

Baileys is unofficial and violates WhatsApp's Terms of Service. A banned number is gone with no
appeal. **Pacing now exists** — warmup, per minute/hour/day ceilings and jitter, enforced at the
one point every send passes through — so a burst is capped rather than sent.

That is a floor, not safety. Layers 3–6 are unbuilt (typing simulation, circadian pacing,
contact-graph gates, health scoring, recovery), and the rule capping a number that has never
*received* anything is deliberately deferred with **D-14** — which means **bulk from a number
with no inbound is still the riskiest thing this system can do**, and that is exactly the
number we have.

---

## Running it

See [`README.md`](README.md) for the full verified setup. Short version:

```bash
npm install && [ -f .env ] || cp .env.example .env    # then fill the five secrets
npm run db:setup
npm run admin -- org --name "Hiring Studios" --slug hiring-studios --email you@example.com
```

**On this machine that is already done.** The org is **Hiring Studios** (`hiring-studios`,
`5f82ad62-…`) with one admin, `developer@hiringstudios.com`.

**There is deliberate test data in the dev database.** One contact,
`[TEST DATA - DO NOT TOUCH] media demo +919999000001` (`source = 'test_fixture'`), with two
messages and two `media_asset` rows named `[TEST] …`, plus their files under `./storage`. They
exist so the media endpoint can be exercised without a live WhatsApp file, which D-14 currently
prevents. Left in place on purpose — delete them only when D-14 is closed and media has been
verified against a real attachment. `npm run admin -- whoami` lists
organisations; `npm run admin -- password --email developer@hiringstudios.com` sets a new
password and ends every session on the account.

All of it in one terminal — database, migrations, three processes, Ctrl-C stops them:

```bash
npm run dev:all             # --no-web and --no-gateway if you want less
```

Or separately, which is what `dev:all` is running. They are separate processes so that
restarting the API never drops a WhatsApp socket:

```bash
npm run dev       # API      :3000
npm run gateway   # owns the WhatsApp sockets — nothing sends without this
npm run web       # UI       :3001
```

**[`docs/24-local-testing.md`](docs/24-local-testing.md)** is the by-hand testing recipe:
getting a key, exercising the API, checking the attachment headers, reading the audit trail.

Sign in at `localhost:3001/login`. `npm run check` runs typecheck, lint and 330 tests.

**Two documents are written for picking this up cold**, and are worth more than re-reading the
code: [`docs/24-local-testing.md`](docs/24-local-testing.md) — start the stack, get a key,
exercise every endpoint by hand, and what the attachment headers must say — and
[`docs/25-ingestion-guide.md`](docs/25-ingestion-guide.md) — every ingestion source, how
deduping works at both layers, and a walkthrough. `tools/insomnia-collection.json` imports the
whole API surface including the refusals that must stay refused.

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

Parked decisions with trigger conditions: **D-1 … D-16** in [`docs/21-deferred.md`](docs/21-deferred.md).
**D-14 blocks the only end-to-end proof that media works** — everything downstream of the
download is tested; the download itself has never met a real WhatsApp file.

---

## Known defects, not yet fixed

| Where | Problem |
|---|---|
| **Gateway** | Writes inbound messages and attachments as the connecting role, outside the tenant transaction the API now uses. Not a leak — it is not serving anyone's request — but it is the remaining place where a forgotten `org_id` would not be caught by the database |
| **The linked number receives nothing** | Sends work; inbound has been dead since 2026-09-20 09:12 UTC. Every delivered frame fails to decrypt with `Bad MAC`, and Baileys discards them before `messages.upsert`, so the application sees silence rather than an error. Nothing in our code is at fault. Parked as **D-14**, which carries the full evidence and the triggers — the first being any attempt to verify media end to end. **A recovery path now exists** — the Unlink button (or `POST /senders/:id/unlink`) clears the corrupt credentials so a fresh QR can be scanned; closing D-14 is now a re-link away, but still needs the phone. |
| Pacing has no window | A message held back by the anti-ban gate is indistinguishable from one whose sender is disconnected — both sit at `queued`, and only the gateway log says which. Fine for one operator, wrong for campaigns, where "why has this not gone?" is the first question asked |
| Media | A file whose bytes fail to store leaves the message without it and **only a log line says so** — there is no retry and nothing surfaces it for an operator. Also: no size cap on a download yet (D-11 records the quota question) |
| `infra/compose/` | **Empty.** There is no compose file, so the documented `docker compose --profile core up` does not exist |
| Login throttle · key rate limit | Both are **in-process**, so several replicas would each count separately and a key's effective ceiling becomes the limit times the replica count. Stated rather than hidden; both move into the shared rate-limit layer in P9 |

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
- **`docker exec` needs `-i` to accept a heredoc.** Without it psql gets no stdin, reports
  nothing, and changes nothing — it looks like it worked. Verify the rows, not the exit code.
- **A unique index and an escape hatch will contradict each other.** `import_run` has
  `UNIQUE (org_id, sha256)` and the API has `?force=true`; the database refused the upload the
  API had just allowed. Fixed with a **partial** index (`WHERE superseded_at IS NULL`) and a
  forced re-import superseding the old run. Expect the same shape wherever a constraint meets
  a deliberate override.
- **`Bad MAC` means messages arrive and vanish, while sending still works.** An outbound send
  establishes its own session, so a corrupt companion session looks like a half-working link
  rather than a broken one. Baileys drops what it cannot decrypt *before* `messages.upsert`,
  so the application sees silence, not an error. Check the gateway log for
  `failed to decrypt message` before suspecting anything in our own code.
- **This gateway only sees traffic in reconnect flushes.** `markOnlineOnConnect: false` means
  WhatsApp notifies the phone and queues for the companion; messages sent while it was
  connected only appeared after a restart. Strongly indicated by the timestamps rather than
  proven, but assume nothing arrives in real time until that is settled.
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

## What landed most recently, and what it cost

Most recent first, all P4 inbox: **thread lock** (assignment-based, admin override) → **notes +
canned replies** (migration 0012, tables `internal_note` and `canned_reply`) → **attachments in
the thread UI** (a web-side `/media/:id` proxy) → **assignment, status and list filters** (commit
`4474697`). The whole P4 UI was finally **eye-verified in the browser** this round — filters,
assignee + resolve, attachments as download links, the Reply/Note toggle and a note round-trip —
signing in as the dev admin account.

Before that, six pieces in order: **row-level security on the request path** → **media** →
**send pacing (P6 layers 1–2)** → **CSV import (P5)** → **campaigns (P7)**, plus two small defect
fixes (malformed UUID now 422 not 500; `problem()` no longer emits `"status": 0`) and per-key
rate limiting actually being enforced.

Three of those were verified by **deliberately breaking them** and watching tests fail, which
is worth repeating for anything safety-critical: disabling the RLS role switch fails five
tests, disabling the pacing gate fails two, and removing the campaign ceiling fails two more —
including the one that hands the gateway ten messages with a ceiling of four.

**What was tried and could not be finished:** verifying media end to end against a real
WhatsApp file. Inbound has been dead since 20 September (**D-14**) and the diagnosis is
complete — 17 frames delivered on reconnect, every one failing `Bad MAC`, `messages.upsert`
firing zero times. It is not our bug and it needs a re-link, which needs the phone.

---

## Next

1. **A `POST /contacts` route.** `contacts:write` is an enforceable scope with nothing behind
   it, so a contact can only be created by an inbound message, a one-off send, or a CSV
   import. Anything that wants to add one person over HTTP has no way to. Small, and it
   unblocks every other source.
2. **Show attachments in the inbox.** The API serves them and the UI does not yet render the
   `media` object on a message — a download link and a filename is the whole job. Then
   **outbound** media, which needs the send path to carry a file and `OutboundContent` to
   stop being text-only.
3. **Finish P4** — landed: assignment + status + filters, attachments in the thread, internal
   notes, canned replies, the thread lock, mark-read and open-any-thread. Remaining and still open:
   **search** (needs the blind-index decision) — the last substantial P4 piece. Deferred: **live
   inbound + presence/collision** is **D-17**
   (the big WebSocket lift, and live inbound is anyway blocked by D-14); snooze, the Meta-window
   countdown and keyboard shortcuts are **D-18**.
4. **Close out P1** — a compose file, and the `email` and `secrets` drivers, each with a
   contract suite like storage now has.
5. **P6 layers 3–6** — typing simulation, circadian pacing, contact-graph gates, health
   scoring. Layers 1–2 exist; a campaign is capped but still sends at a machine's rhythm.
6. **Deployment**, which is also when the production database gets decided. Note:
   **`ENCRYPTION_KEY` must be backed up separately from the database** — losing it means losing
   every linked number and every stored message, permanently.
