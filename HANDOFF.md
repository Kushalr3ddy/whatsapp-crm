# Handoff — state as of 2026-09-29

A point-in-time snapshot for picking this up in a new session. For *what has been built and what
is left, in order*, read [`CHANGELOG.md`](CHANGELOG.md), the running work ledger. For *what it
is*, read [`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the
whole stack assuming no prior knowledge. (`CONTEXT.md` is a **historical session log**, updated on
request; `HANDOFF.md` + `CHANGELOG.md` are the primary, always-current record.)

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
| P2 | Core domain — orgs, users, sessions, API keys, RLS; contacts (create, **list + search**), **tags** | **mostly** |
| P3 | Channels — Baileys adapter, gateway, HTTP API | ✅ |
| P4 | Inbox — list/thread/composer, assignment + status + filters, notes, canned replies, thread lock, attachments | **partial** (search + realtime left) |
| P5 | Ingestion — CSV **+ Excel** import | **first slice** |
| P6 | Anti-ban — warmup, ceilings, jitter, circadian, contact-graph, health scoring, typing sim, **recovery orchestration** | **✅ complete** (all six layers + Layer 6 recovery) |
| P7 | Campaigns — bulk send, paced; **Broadcast UI complete** (create by tag/import/hand-pick · dry-run preview · start/pause/resume/cancel · per-recipient results) | **first slice** |
| P8 | Meta Cloud API | not started |

**D-14 is CLOSED (2026-09-28).** Inbound is alive again after a re-link, and media was verified
end to end against a real WhatsApp file for the first time — see *What landed most recently*.

**P1 is marked done but is not.** `infra/compose/` holds only a `.gitkeep`, so
`docker compose --profile core up` — its own exit criterion — cannot run. Of the four drivers
it called for (`storage` `email` `kms` `secrets`) only **kms** and now **storage** exist.

**458 tests · 24 of 35 specced tables · 17 migrations (through 0016).**

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
  skipped with a reason, never dropped. **Targeting: an import run, an explicit contact list, or a
  tag** (`from_tag_id`, migration 0015, resolved at snapshot) — all three now reachable from the UI.
  A **Broadcast web page** lists campaigns, **creates** one (name, message, sender, audience by
  **tag / import / hand-picked contacts**), shows a **pre-start dry-run preview**
  (`GET /campaigns/:id/preview`), runs **start/pause/resume/cancel**, and shows **per-recipient
  results** (status filter + name/number search, progress tiles, forecast, message body) via
  `GET /campaigns/:id/recipients`. Hand-pick is on the Contacts page (row checkboxes → "campaign
  from checked"); the audience-by-import list is `GET /imports`.
- **Import — CSV and Excel (P5, first slice)**: upload → dry run → commit, now with a web
  **Import tab** and **.xlsx** support (exceljs, cells read as displayed text so a numeric phone
  survives; converted to CSV and fed the one pipeline). **Content-hash dedup**, so the same file
  cannot import twice whatever it is named; a deliberate re-import supersedes the old run. Ordered
  identity rules, phone normalisation on the way in, a per-row ledger, and a dry run that is the
  default. A sparse file cannot overwrite a name that is already there. The UI does the **simple**
  mapping (pick phone/name/email); the full wizard is **D-21**, row-level dedup **D-22**.
- **Contact creation over HTTP**: `POST /contacts` (`contacts:write`) — the single-person route
  the host app uses. Phone/email (at least one), optional `customFields` and `externalRef` (the
  candidate-id hook). Phone through the one normaliser; an identity that already names someone is
  a `409 CONTACT_EXISTS`, never a silent merge; identities scoped per org.
- **Anti-ban engine (P6, all six layers)** — enforced at the one send chokepoint, counted from
  the `message` table (restart-safe), a paced message left queued not failed:
  **warmup** ramp (20/36/65/117/210/378/680 then steady), per minute/hour/day **ceilings**,
  Gaussian **jitter**, **circadian pacing** (day/night cosine curve, silent overnight,
  `SEND_TIMEZONE`), **contact-graph gates** (relationship delay 1.0/1.8/2.5×, new-stranger cap
  5/hr · 20/day), and **health scoring** (per-sender risk from delivery/failure/disconnect →
  auto-degrade → quarantine, and **recovers both directions** with hysteresis). A **sender-health
  panel** on the Numbers page shows the band, risk score, delivery %, and reply breakdown per
  number. **Typing simulation (D-24)** — `composing` presence + a length-proportional beat
  (0.7–8 s) before each send, opt-in via `SEND_TYPING_SIMULATION`. **Recovery orchestration (Layer
  6)** — a typed incident (463 → 24 h/10 %/+15 %; 429 → 4 h/25 %/+25 %; delivery-collapse soft ban →
  48 h/5 %/+10 %) starts a timed pause then a weekly-ramping cap, stored in three `sender_identity`
  columns (migration 0016) and derived by `recoveryState`; the Numbers page shows a cooling-off /
  at-risk banner per number. **All six layers are now complete.**
- **Contacts list, search & tags (P2)**: `GET /contacts` lists and searches by name/phone/email
  (plain `ILIKE` — contact fields aren't encrypted, so no blind-index decision); `tag` +
  `contact_tag` tables with `GET/POST /tags`, `DELETE /tags/:id`, attach/detach on
  `/contacts/:id/tags`, and a `?tag=` filter on the list. A **Contacts** web page: search box, tag
  filter bar with counts, chips (click to remove), add-tag picker, new-tag form (server actions).
  This is how an operator finds and labels specific imported people to hand-pick a campaign audience.
- **Row-level security on the request path**: every tenant query runs in a transaction with
  `app.org_id` set, and — because the app connects as a role that would otherwise bypass
  policies entirely — drops to the restricted `crm_app` role for the length of that
  transaction. The data routers hold no pool handle, so a new route cannot query around it.
  Proved by tests that query with **no `org_id` filter** and watch Postgres withhold the rows.

### What does not exist

No **outbound** media — receiving and serving work; sending a file does not · no encryption at
rest for files, no retention job, no antivirus (all D-11) · no self-service password reset ·
no message templates (a campaign carries a plain body) · **anti-ban: warmup, ceilings, jitter,
circadian pacing, contact-graph gates and health scoring are built; per-incident recovery
schedules are not (typing simulation, D-24, is now built)** · no Meta adapter · no deployment.

---

## The honest risk

Baileys is unofficial and violates WhatsApp's Terms of Service. A banned number is gone with no
appeal. **Pacing now exists** — warmup, per minute/hour/day ceilings and jitter, enforced at the
one point every send passes through — so a burst is capped rather than sent.

That is now well past a floor. **Circadian pacing** (day/night curve, silent overnight),
**contact-graph gates** (stranger sends paced 2.5×, new-stranger volume capped at 5/hour · 20/day)
and **health scoring** (a per-sender risk score that auto-degrades → quarantines a number on bad
delivery/failure/disconnect signals, and recovers it both ways when they clear) are all built and
enforced at the one send chokepoint, and **typing simulation** (D-24) now makes each send look
human rather than instant. What is still unbuilt: the **per-incident recovery schedules**
(Layer 6 timed pause/resume ramps — status recovery works, the timed schedules do not). So a
campaign is capped, timed like a human, cautious with strangers,
and a struggling number now brakes and recovers itself — but bulk from a fresh number is still
inherently risky, since no engine removes the underlying ToS violation.

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

**The `[TEST DATA]` fixtures are gone (deleted 2026-09-29).** There was one contact,
`[TEST DATA - DO NOT TOUCH] media demo +919999000001` (`source = 'test_fixture'`), with a
conversation, two messages, two `media_asset` rows named `[TEST] …` and their stub files under
`./storage`, kept so the media endpoint could be exercised without a live WhatsApp file. D-14
closed and media is proven against a real attachment, so they were removed (rows in FK order +
the blobs and their `.meta` sidecars). The only file left under `storage/.../media/` is the
genuine D-14 JPEG (`0c764e48-…`, 49,408 bytes). `npm run admin -- whoami` lists
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
| — | Baileys pinned **exactly** to `6.7.24`, not 7.x (`docs/10-stack.md`, D-5) |
| — | **Express 5**, not NestJS, not Fastify (`docs/10-stack.md`) |
| — | **Next.js 15** App Router for the UI (`docs/04-architecture.md`) |
| — | Drizzle for **schema + migrations only**; queries are raw SQL through the `sql` tag |
| — | Single-tenant deploy on a **multi-tenant-ready** schema: `org_id` + RLS from migration 1 |
| — | Everything behind a driver port with a **free self-hosted default** |
| — | **Authorisation is never delegated** — an IdP may authenticate; roles stay local |
| — | **Email is optional**; every flow using it keeps a non-email path |
| — | The `.env` `API_KEY` is a **bootstrap credential**: provisioning only, refused on data |
| — | The UI **forwards the user's session**; it holds no machine credential |

Parked decisions with trigger conditions: **D-1 … D-24** in [`docs/21-deferred.md`](docs/21-deferred.md).
**D-14 (dead inbound) is now closed** — media has been verified end to end against a real
WhatsApp file. Typing simulation was set aside as **D-24** on 2026-09-28.

---

## Known defects, not yet fixed

| Where | Problem |
|---|---|
| **Gateway** | Writes inbound messages and attachments as the connecting role, outside the tenant transaction the API now uses. Not a leak — it is not serving anyone's request — but it is the remaining place where a forgotten `org_id` would not be caught by the database |
| ~~The linked number receives nothing~~ | **RESOLVED 2026-09-28 (D-14).** Inbound was dead 2026-09-20 → 2026-09-28 (`Bad MAC` on every frame — a corrupt companion session, not our code). The unlink→re-link recovery fixed it: after a fresh QR scan, 5 inbound rows landed, zero decrypt failures, and media was verified end to end against a real JPEG. Kept in the table as a signpost; the recovery path (`POST /senders/:id/unlink` + a web Unlink button) and the gateway/DB/phone sync are written up in [`docs/26-linking-lifecycle.md`](docs/26-linking-lifecycle.md). |
| Pacing has no window (partly addressed) | A message held back by the anti-ban gate still sits at `queued` like a disconnected sender's. **Now partly surfaced:** the Numbers page shows a per-number at-risk / cooling-off banner (recovery pause + resume time, degraded/quarantined reason), and a campaign's per-recipient view shows pending/skipped states — so "why has this not gone?" is answerable at the number and campaign level. What's still missing is a per-*message* "held by pacing vs sender down" indicator in the thread |
| Media | A file whose bytes fail to store leaves the message without it and **only a log line says so** — there is no retry and nothing surfaces it for an operator. Also: no size cap on a download yet (D-11 records the quota question) |
| `infra/compose/` | **Empty.** There is no compose file, so the documented `docker compose --profile core up` does not exist |
| Login throttle · key rate limit | Both are **in-process**, so several replicas would each count separately and a key's effective ceiling becomes the limit times the replica count. Stated rather than hidden; both move into the shared rate-limit layer in P9 |
| ~~**Campaigns UI**~~ **— feature-complete for the alpha** (2026-09-29) | The **Broadcast** tab is a real, operable page: list → **create** (name, message, sender, audience by **tag / import / hand-picked contacts**) → **pre-start dry-run preview** → **start / pause / resume / cancel** → **per-recipient results** (status filter + name/number search, progress tiles, forecast, message body). Endpoints: `GET /campaigns/:id/recipients`, `GET /campaigns/:id/preview`, `GET /imports` (audience list), and `from_tag_id` targeting (migration 0015, resolved at snapshot). Hand-pick is on the Contacts page (row checkboxes → "campaign from checked", `form=` association so no nested forms). The old placeholder and its **false warning** are gone. **Only enhancement left:** **D-26** body variation (spintax) in the compose step, pinned separately. |

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
- **Step by step, feature by feature**, with an explicit go-ahead before large work. **Always
  ask** before building, deleting, or making a scope call.
- **Keep `CHANGELOG.md` (work ledger) and `HANDOFF.md` (state snapshot) current each session.**
  `CONTEXT.md` is retired — do not append to it.
- Every class, function, exported constant and type carries a 1–4 line comment saying what it
  is and *why* — lint-enforced.
- **Run a command as written before handing it over.**
- **Verify the exit code before committing.**
- **Do not change the runtime floor** (`engines`) to make something work. A dependency is
  smaller and more reversible than a Node version bump; that would be a much bigger decision.
- Kill child processes and clean up test fixtures when finished.

---

## What landed most recently, and what it cost

**Most recent (2026-09-29): P6 recovery orchestration (Layer 6) — the anti-ban engine is now
complete.** A typed incident starts a **timed** response beyond the scorer's status recovery: a
**463** timelock → 24 h pause then 10 % of cap, +15 %/week; a **429** → 4 h then 25 %, +25 %/week; a
delivery-collapse **soft ban** → 48 h then 5 %, +10 %/week. State is three `sender_identity` columns
(migration 0016); `recoveryState` in `@crm/core` derives the phase and cap fraction from them, so
nothing is kept in sync. The **pause** is a full hold at the send chokepoint (queued, never failed),
the **ramp** scales the daily ceiling and can only lower it, and detection is wired where the signals
already surface: 463/429 in `applyConnectionEvent`, soft ban in the health sweep. A guard makes a
storm of the same signal a no-op so the pause never perpetually resets. The **Numbers page** shows a
per-number at-risk / cooling-off banner (pause + resume time, or the reduced-cap ramp, or a plain
degraded/quarantined reason) — the frontend warning Kushal asked for. `GET /senders` derives the
state server-side and hides the raw columns. 401 hard ban deliberately stays on the unlink→re-link
path, not auto-retire (a ban and a user unlink look identical at the socket). 11 new tests → **458
total**; typecheck/lint/suite/`web:build` green. **Next: D-26 body variation.**

**Before that (2026-09-29): Broadcast UI — the last two targeting modes, feature-complete for the
alpha.** **By import:** `GET /imports` lists committed, non-superseded
runs with a `contactCount`, and the new-campaign form offers audience by **tag OR import** (two
selects, exactly one). **Hand-picked:** the Contacts page grew a checkbox per row (disabled for
do-not-contact) and a "Campaign from checked contacts" panel that creates a draft with
`explicitContactIds` and jumps to it — the checkboxes belong to the panel's form by the HTML
`form=` attribute, so nothing nests (rows already carry tag forms). 2 API tests (imports list:
committed-only + counts, superseded hidden) → **447 total**; typecheck/lint/suite/`web:build`
green. The whole Broadcast loop now works from the browser: create (tag/import/hand-pick) → dry-run
preview → start/pause/resume/cancel → per-recipient results. Only **D-26** body variation is left,
pinned. Next: **P6 recovery orchestration** (+ at-risk frontend warnings).

**Before that (2026-09-29): Broadcast UI — pre-start dry-run preview (F5 AC-1).** A draft's page now
shows what starting *would* do before you commit: "would message N · K skipped (no number) · T in
the audience", plus the forecast, computed with **no writes**. New `GET /campaigns/:id/preview` +
core `previewAudience()`, which reuses `snapshotAudience`'s exact audience rule as a reachability
COUNT — so the preview can't drift from what start freezes (a test pins
`preview.reachable === progress.pending`). If the audience has no reachable numbers it says so in
red rather than letting a send-to-nobody start. 3 API tests → **445 total**; typecheck/lint/suite
green. Next: the remaining UI targeting modes (import/hand-pick), or on to P6 recovery.

**Before that (2026-09-29): Broadcast UI, slice 2 — create a campaign, and operate it.**
The Broadcast tab can now run a campaign end to end from the browser: **`/broadcast/new`** creates a
draft (name, message, sender, **audience by tag**), the detail page carries **Start / Pause / Resume
/ Cancel** controls (server actions over the existing endpoints), and starting freezes the audience
and shows the forecast + per-recipient results. New targeting mode **`from_tag_id`** (migration
0015, a nullable FK to `tag`, resolved in `snapshotAudience` like an import run — so tagging someone
*after* launch never changes a running audience); the create endpoint now accepts exactly one of
`fromImportRunId` / `explicitContactIds` / `fromTagId`, with a 404 for an unknown tag. 4 API tests
(freeze-the-tagged, post-launch-tag-ignored, unknown-tag-404, exactly-one-of-three) → **442 total**;
root+web typecheck, lint, full suite and `web:build` green. **Not** eye-verified signed-in (dev
password). **Still to add:** import/hand-pick targeting *in the UI*, and a pre-start dry-run preview.

**Before that (2026-09-29): Broadcast UI, slice 1 — the campaigns list + per-recipient results.**
The Broadcast tab was a `ComingSoon` placeholder whose warning was **false** (it claimed "no rate
limiting anywhere" while the whole engine exists). It is now a real, read-only page: a **campaign
list** (`/broadcast`) and a **campaign detail** (`/broadcast/[id]`) with progress tiles that double
as status filters, the forecast, the message body, and the **per-recipient results** — every
recipient with its status (`sent`/`queued`/`pending`/`skipped`/`failed`), the reason for a skip, and
the message's own delivery state, filterable by status and searchable by name or number. Backed by a
new **`GET /campaigns/:id/recipients`** (`?status=`, `?q=`, keyset on the row id; 404 for an unknown
campaign, never an empty list) — F5 AC-5. 5 API tests → **438 total**; root+web typecheck, lint,
full suite and `web:build` all green. **Not** eye-verified in a signed-in browser (needs the dev
account password). **Still to build:** slice 2 (create → target → forecast → start) and slice 3
(pause/resume/cancel controls) — those campaign actions are API-only today.

**Before that (2026-09-29): typing simulation (D-24) + a fixture/export cleanup.** Before each
send the gateway now shows a `composing` "typing…" presence, pauses a beat proportional to the
message length (`typingDelayMs` in `@crm/core` — Gaussian on the per-char rate, clamped 0.7–8 s),
then clears it — so a send looks human rather than instant. The `ChannelProvider` port gained an
optional `typing(sender, to, state)`, implemented by Baileys (`sendPresenceUpdate`) and the fake
(records calls for tests). Opt-in via `SEND_TYPING_SIMULATION` (default on), cosmetic and
best-effort — a failed presence never fails the send. The beat is deliberately **compressed**, not
literal 45-WPM typing time: a 30-second bubble before every send would stall the paced queue for no
gain (the tell being removed is the *instant* send, not a fast one). 6 new tests (3 unit on the
delay bounds/variation, 3 in the send path) → **433 total**. Also: the `[TEST DATA]` dev-DB
fixtures deleted and the stray Insomnia export removed (commit `288c361`). **Next in P6:
per-incident recovery orchestration** (Layer 6 timed pause/resume ramps + a frontend at-risk
warning), then D-10 / D-26 / D-28.

**Before that (2026-09-29): P6 anti-ban engine completed + the contacts/tags foundation.**
Three anti-ban layers landed at the one send chokepoint, each opt-in and tested: **circadian
pacing** (day/night cosine curve, silent overnight, `SEND_TIMEZONE`), **contact-graph gates**
(relationship delay 1.0/1.8/2.5× + new-stranger cap 5/hr·20/day), and **health scoring**
(per-sender risk from delivery/failure/disconnect → auto-degrade → quarantine, recovering both
directions with hysteresis). A **sender-health panel** surfaces them on the Numbers page. Then the
contacts side: **contact list + search** (`GET /contacts`, plain `ILIKE`) and **tags** (`tag` +
`contact_tag`, migration 0014, attach/detach, `?tag=` filter, a Contacts page with filter bar +
chips + new-tag form). Also: **compliance reframed** as the operator's responsibility
(jurisdiction-neutral, keeping the anti-ban-crucial `do_not_contact`/opt-out/no-purchased-lists);
**plain-terms explanations** added to `20-orientation.md`; **`GETTING_STARTED.md`** runbook at the
repo root. 427 tests. Everything eye-verified against the real dev DB where it had a UI.

**Before that (2026-09-28): D-14 closed + a documentation-consistency pass.** The `kushal test
number` was re-linked from a fresh QR and inbound came back to life — 5 rows landed, **zero**
`Bad MAC` failures (was 17 frames failing), and an inbound image stored as a genuine JPEG
(1126×600, 49,408 bytes, `image/jpeg` from magic bytes, sha256 set, bytes-on-disk matching): the
first end-to-end proof that media works against a real WhatsApp file. Then four doc contradictions
were fixed — `ENCRYPTION_KEK`→`ENCRYPTION_KEY` typo in `13-deployment.md`; the Git conventions in
`11-conventions.md` rewritten to match reality (straight to main, no branches, no AI attribution,
CONTEXT.md retired); `sender_identity.status` standardised on
`linking/active/degraded/quarantined/retired`; and the feature index de-overclaimed
(F2/F4/F5/F6/F7/F8 → ⚠️ partial). Typing simulation was parked as **D-24**.

Before that, all P4 inbox: **thread lock** (assignment-based, admin override) → **notes +
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

**Now finished:** verifying media end to end against a real WhatsApp file — the thing D-14
blocked. Inbound was dead 20–28 September (`Bad MAC` on every frame, not our bug); the
unlink→re-link recovery cleared the corrupt session and a fresh QR brought it back. Proven, not
assumed: 5 rows in, zero decrypt failures, a real JPEG stored and byte-matched.

---

## Next

**The plan Kushal set, updated 2026-09-29:**

1. ~~Close D-14~~ — **done.** Inbound alive, media verified end to end.
2. ~~Circadian pacing~~ — **done** (day/night send curve, silent overnight; `SEND_TIMEZONE`).
3. ~~Contact-graph gates~~ — **done** (relationship delay multipliers + new-stranger throttle).
4. ~~Health scoring~~ — **done.** Per-sender `risk_score` from delivery/failure/disconnect
   signals, written to `risk_score` + `health` jsonb, with status auto-degrading → quarantining
   and **recovering both ways**. Enforced in `handleSend` (quarantine holds sends, degraded halves
   speed), scored in the gateway sweep.
5. ~~Typing simulation (D-24)~~ — **done (2026-09-29).** `composing` presence + a
   length-proportional beat (0.7–8 s, Gaussian, clamped) before each send, at the `handleSend`
   chokepoint; opt-in via `SEND_TYPING_SIMULATION`, best-effort. **P6 now has one piece left:** the
   **per-incident recovery orchestration** (Layer 6 timed pause/resume/ramp schedules — status
   recovery works, the timed incident schedules do not). Next up, and it ships **with a frontend
   at-risk warning + recovery-state display** on the Numbers page (Kushal, 2026-09-29). Then D-10,
   D-26, D-28 in that order.
6. ~~Sender-health UI panel~~ — **done.** Each card on `/link` shows the band badge, risk score,
   delivery/sent/failed evidence and the replied-vs-no-reply breakdown; `GET /senders` carries the
   `health` jsonb + relationship counts. Data eye-verified against the real dev DB; the logged-in
   visual is still worth a glance (needs the dev password to sign in).
7. **Build queue (Kushal, 2026-09-29)** — all P2–P7 alpha core:
   - ~~**Contact list + search**~~ — **done.** `GET /contacts` (name/phone/email substring, plain
     `ILIKE`, keyset-paginated) + a `/contacts` web page and nav tab. Finds specific imported people.
   - ~~**Tags**~~ — **done.** `tag` + `contact_tag` (migration 0014, RLS forced), `GET/POST /tags`,
     `DELETE /tags/:id`, attach/detach on `/contacts/:id/tags`, `?tag=` filter on the contact list,
     and a Contacts-page filter bar + chips + add/remove + new-tag form (server actions).
   - ~~**Per-recipient results**~~ — **done (2026-09-29), as Broadcast UI slice 1.**
     `GET /campaigns/:id/recipients` + the `/broadcast` list and `/broadcast/[id]` results view.
   - ~~**Broadcast UI**~~ — **feature-complete for the alpha (Kushal, 2026-09-29).** list · create
     (tag / import / hand-picked) · dry-run preview · start/pause/resume/cancel · per-recipient
     results; the false-warning placeholder is gone. **D-10** (broadcast output vs the inbox) is
     settled by the separate Broadcast surface.
   - ~~**P6 recovery orchestration**~~ — **done (2026-09-29).** Layer 6 timed pause/ramp schedules
     (463/429/soft-ban) + the Numbers-page at-risk / cooling-off banner. The anti-ban engine is now
     complete (all six layers).
   - **Now on to:** **D-26 body variation** (spintax + per-recipient vars on the campaign body;
     unpinned + decoupled from D-19), then **D-28**.
   - **Pinned, priority:** **D-19** templates; **D-25** outbound media (high).
   - **Pinned, later:** **D-23** chat/message-body search (encrypted-body decision; something
     simpler first); **D-28** dynamic segments ("segregation" — criteria-based audiences).
   Legal/compliance reframed as the operator's job (jurisdiction-neutral); opt-out is **D-27**.

**Deferred / parked (not now):**
- **P8 Meta Cloud API adapter** — beyond the alpha core.
- **P1 close-out** (compose file, `email`/`secrets` drivers) — deliberately left for now.
- ~~**`[TEST DATA]` fixtures**~~ — **deleted 2026-09-29.** Rows and stub files gone; only the real D-14 JPEG remains.
- **D-17** live inbound + presence/collision (WebSocket) · **D-18** snooze/Meta-window/keyboard ·
  **D-19** rich templates · **D-20** SQLite · **D-21** full import wizard · **D-22** row-level
  dedup. (**D-24** typing simulation is now **built** — no longer parked.)
- **Deployment** — where the production database is decided. **`ENCRYPTION_KEY` must be backed up
  separately from the database** — losing it loses every linked number and every stored message.

**Both loose ends closed 2026-09-29:** the `[TEST DATA]` fixtures were deleted (above), and the
stray Insomnia workspace export at the repo root (`whatsapp-crm (local)-wrk_*.yaml`) was removed
— it was tracked, not untracked as previously noted — with a `.gitignore` rule added so per-workspace
Insomnia exports can't be committed again (the curated collection stays at
`tools/insomnia-collection.json`). Committed straight to main (`288c361`).
