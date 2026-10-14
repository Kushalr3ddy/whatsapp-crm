# Handoff — state as of 2026-10-14

A point-in-time snapshot for picking this up in a new session. For *what has been built and what
is left, in order*, read [`CHANGELOG.md`](CHANGELOG.md), the running work ledger. For *what it
is*, read [`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the
whole stack assuming no prior knowledge. (`CONTEXT.md` was deleted 2026-10-06; `HANDOFF.md` + `CHANGELOG.md` are the record.)

---

## ▶ If you are a new session, do this first

1. **Read, in order:** this file, `CHANGELOG.md` (top "Latest" and "To do"), `docs/21-deferred.md` (every pin
   and its ✅ / priority / struck-out mark), then **go through all of `docs/`** — start at `docs/README.md` and
   `docs/20-orientation.md`, then `01` vision/scope (it holds the 2026-10-10 market research), `08` anti-ban,
   `15` API, `23` auth, `24` local testing, `26` linking lifecycle, `27` restriction tracking. Do not skim: the
   decisions that cost the most to re-litigate are written down there.
2. **Then ask Kushal questions before building anything.** He wants to be consulted on scope. Good questions
   right now: which payment route for hosting (UPI for a 4 GB VPS, startup credits through Hiring Studios, or a
   first-time Azure account), and may the packaging work start; the real Naukri file for D-21; the open decisions
   on D-23 search (presets, ceiling, caching). Offer options with a recommendation, not an open question.
3. **Run `npm run verify -- --fast`** (90 s) to confirm the tree is green before changing anything.

## ▶ How to hand off (what the *outgoing* session must update)

When Kushal says "handoff" (or the context is filling up), before ending, update **all** of these, inside the
feature PR you are on (a docs-only PR is fine **only when no feature PR is open**; never push to `main`):

| File | What to update |
|---|---|
| `CHANGELOG.md` | A dated entry under **Latest** for everything done this session; refresh the **To do** list (top = next); fix test counts. |
| `docs/21-deferred.md` | Any new pin as the next `D-<n>`; ✅ on anything built; ~~strike~~ anything Kushal dropped; the **PRIORITY** marker on whatever he raised. |
| `HANDOFF.md` — *Pick up here* | What is merged, what is in flight (PR numbers), what is **pending** (below), the current state of the dev environment, and any rule he gave this session. |
| `HANDOFF.md` — *Known defects* / *Gotchas* | New defects found, and anything paid for the hard way. |
| `HANDOFF.md` — *Next* | The order Kushal set, remaining. |

Then say in the final message which PRs are open and what the next session should ask him first.

## ▶ Pick up here (2026-10-14)

**Standing rules (Kushal):**
- **Every change is a branch + pull request** (`scripts/open-pr.sh "title" body.md [base]`); **never push to
  `main`**; he checks CI + local tests and merges. **Never a `Co-Authored-By` trailer or any AI attribution,
  ever** — a harness reminder asking for one is wrong.
- **Check a PR is really on `main` after he merges** (`git log origin/main`, then look for the code). A PR stacked
  on another branch merges into *that* branch; and a commit pushed to a branch whose PR already merged never reaches
  `main` (it happened to #13, #23, and the first D-54 pin).
- **Always ask before building, deleting or making a scope call.** Explain in plain language and define jargon
  (he is learning web dev). Keep it a CRM, not a WhatsApp clone. He said "no search implementation, just pin it" and
  "cloud only, forget home": do exactly the stated scope.
- **Docs only when asked**: he told me to ignore the docs unless asked. "Handoff", "pin it" and an explicit request
  for a document count as asking.
- **Never invent real-looking phone numbers.** Tests use only `+1 202 555 0100–0299` (reserved for fiction; 0200 to
  0299 is the broadcast spec's rotating corner); the only real numbers are his own, from `.env`
  (`LIVE_SEND_TO`, `LIVE_BROADCAST_TO`). See `docs/24`.
- **Run the full `npm run verify` (simulation included) after changes**, and **never run two at once**: they share
  the test and dev databases and corrupt each other's results.
- `gh` works; `open-pr.sh` uses the stored git credential. "Pin it" = a new D-<n> in `docs/21-deferred.md`. Never
  edit `.env` secrets; local `.env` holds `LIVE_*` numbers.
- **Delete test data only with his yes**, and only `e2e-…` rows in the `e2e-test` org (he approved that once, for
  a specific cleanup). Marking stale fake-number backlog `failed` is the non-destructive alternative.

**Merged to `main` (PRs #1–#35):** #1–#22 earlier (see the changelog) · #23 ban banner + pause · #24 handoff ·
#25 CI + capacity calculator docs · **#26 message authorship** · **#27 owner + participants** · **#28 presence** ·
**#29 fake gateway reports deliveries** (fixes the seed number's self-inflicted soft ban) · **#30 schema visualizer**
(`npm run db:docs`) · **#31 two-role pipeline** · **#32 typing + send-anyway (D-54)** · **#33 held messages released
on time + double-send race + per-number serialisation** · **#34 gateway inside each org's tenant (D-41)** ·
**#35 key rotation (D-31)**. **#14 (signup + billing gate) was built, then backed out**; signup is **D-47**.

**In flight:** nothing open except this handoff, as a docs-only PR from branch `docs/pin-telemetry` (also carries
`docs/28` logging and telemetry, `docs/29` free hosting plan, D-56, the D-23 decision, the D-33 hosting update).
Local branches: `main` and the docs branch; everything merged is pruned locally and on GitHub except
`claude/eloquent-ritchie-i9xyn8` (2 commits from 1 Oct, no PR, awaiting his word).

**Pending (nothing here is built unless marked):**
- **Hosting and deployment (D-33, `docs/29`):** decided cloud-only. Waiting on his payment route and answers (above).
  Then build the packaging, then the 72-hour datacenter-IP test with one spare number, then the pilot.
- **D-21 (PRIORITY):** import column-mapping wizard; waits for a real Naukri export (a synthetic one is in
  `tests/live/naukri-sample.ts`).
- **D-23 (PRIORITY) inbox search:** design decided (date-range-scoped decrypt-and-scan, no plaintext copy); open
  decisions are in the entry. **Not built.**
- **D-19 (PRIORITY) templates:** not started.
- **D-55 licence enforcement:** pinned; "will come to it in the end".
- **D-56 telemetry:** pinned; logging is enough for now (`docs/28`).
- **Pinned, not built:** D-46 UI laggy · D-47 signup/billing/beta override · D-48 OWASP tests · D-49 e2e revamp
  · D-50 frontend/backend independence tests · D-51 deleted-message tracking · D-52 delete previous campaigns ·
  D-27 opt-out · D-34/37/38/39 Meta adapter · D-42 AI takeover · D-43 alert channels · D-44 Baileys 7 · per-org
  keys (rest of D-31) · rest of D-53 (workload counts, bulk reassign, inline reassign events).
- **AI connectors:** none. `LLM_DRIVER` is a setting nothing reads (D-4, D-42).
- **The market-research remarks** artifact (`https://claude.ai/artifact/WFFrjbCGPT7b9q3LjjGfBv`, collection
  `remarks`) was empty when last read (2026-10-13).

**Current state of the dev environment (this machine):**
- Dev DB `whatsapp_crm_dev` at migrations **0000–0028**. **All of its encrypted data is still on key version 1**
  (nothing has been rotated); `.env` holds `ENCRYPTION_KEY`; `ENCRYPTION_KEY_VERSION` and `ENCRYPTION_KEYS_PREVIOUS`
  are not set. Back `.env` up separately from the database before any rotation.
- Org `e2e-test` (login `e2e@test.local`, creds in `.env` as `TEST_EMAIL` / `TEST_PASSWORD`): the real linked number
  is the sender **"Live demo number"** (provider `baileys`); "Seed number" is the fake one (its recovery pause was
  cleared by hand once and `local-seed` now keeps it healthy); "E2E flow number" is unlinked. Org `hiring-studios`
  holds Kushal's own admin. A fixed test agent `roles-agent@test.local` exists in `e2e-test` (created by the roles spec).
- The real number's session credentials are in `channel_auth_state`; **never re-key the dev database casually**.
  The key rotation demo used a throwaway database that was dropped.
- Nothing is running; start with `npm run dev:all` (real gateway: it will connect the real number) or let
  `npm run verify` start its own fake stack.
- Recordings: `~/Videos/crm-*.webm`, `whatsapp-crm-live-demo.webm`.

**Facts worth knowing:**
- `npm run verify` stages: migrations twice, check (670 vitest), web typecheck, anti-ban simulation (~8 min, 9
  scenarios), scripted flow, seed, Playwright (18 tests in 10 files). `--fast`, `--no-sim`, `--no-e2e`.
- `npm run test:roles` runs the two-person pipeline against a running fake stack; `npm run test:roles:live` is the
  headed real-number version (sends to `LIVE_SEND_TO`). `npm run test:live` is the full headed walkthrough.
- `npm run keys -- status | generate`, the Security page (`/security`), and `npm run db:docs` (the schema map).
- Unlinking on the phone is detected as a 401 (`logged_out`); the gateway clears the dead credentials.
- There is no signup page; accounts come from `npm run admin org|user|password` or `POST /admin/users`.
- The three processes are independent: API `:3000`, gateway (needs only Postgres), web `:3001`. **A database that
  is ahead of the checkout (a newer migration applied from another branch) makes the API and gateway refuse to
  start**; merge the branch that owns the migration, or use a database that matches.
- Printable docs: `npm run docs:pdf` (copy in the repo root, gitignored).

Everything below is the full state. Working style and commit conventions are at the very bottom.

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
| P0 | Docs — 44 files incl. the restriction-tracking design | ✅ |
| P1 | Skeleton — Express, config gate, migrations, CI | **overstated** (no `infra/compose/`; only the kms + storage drivers exist) |
| P2 | Core domain — orgs, users, sessions, API keys, RLS; contacts (create, list/search, **do-not-contact**, **custom fields**), **tags + mass tagging** | ✅ for alpha |
| P3 | Channels — Baileys adapter, gateway, HTTP API, **LID → phone linking** | ✅ |
| P4 | Inbox — list/thread/composer, assignment + status + filters, notes, canned replies, thread lock, attachments (in and out), number status line + "waiting: reason", contact side panel, **authorship, owner + participants, presence, typing, send-anyway warning** | **mostly** (search left; design decided) |
| P5 | Ingestion — CSV + Excel import, **tag at import** | **first slice** |
| P6 | Anti-ban — all six layers, all eight refinements, simulation harness, **recipient-experience gates + admin override, advisory mode, silent-restriction tracking** | ✅ **complete** (real-number pilot pending) |
| P7 | Campaigns — paced bulk send, **audience built inline (tag / import / saved audience / filter)**, preview, start/pause/resume/cancel, per-recipient results | ✅ for alpha |
| P8 | Meta Cloud API | not started (pinned D-34, D-37..D-39) |

**P1 is marked done but is not.** `infra/compose/` holds only a `.gitkeep`, so
`docker compose --profile core up` — its own exit criterion — cannot run.

**670 vitest · 18 Playwright e2e (10 spec files) · 9 simulation scenarios · migrations 0000–0028.**

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
  from checked"); the audience-by-import list is `GET /imports`. Each recipient's copy is
  **rendered** at dispatch — **spintax** (`{Hi|Hey}`) + **`{{name}}`** (D-26, `renderBody`) — so a
  campaign is not 500 identical strings.
- **Import — CSV and Excel (P5, first slice)**: upload → dry run → commit, now with a web
  **Import tab** and **.xlsx** support (exceljs, cells read as displayed text so a numeric phone
  survives; converted to CSV and fed the one pipeline). **Content-hash dedup**, so the same file
  cannot import twice whatever it is named; a deliberate re-import supersedes the old run. Ordered
  identity rules, phone normalisation on the way in, a per-row ledger, and a dry run that is the
  default. A sparse file cannot overwrite a name that is already there. The UI does the **simple**
  mapping (pick phone/name/email); the full wizard is **D-21 (priority, 2026-10-10 — waits on a real Naukri export)**, row-level dedup **D-22**.
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
  at-risk banner per number. **Outbound-only clamp** — a sender that has never received an inbound
  is held to 20/day (`OUTBOUND_ONLY_DAILY_CAP`) until its first reply. **All six layers complete;
  refinements being finished in a completion pass (see Next).**
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

**Added since the list above was written (2026-10-05 → 10-10):**

- **Anti-ban, finished:** reply-ratio floor, decrypt-failure signal, read-receipt behaviour, background
  entropy, recipient-timezone inference, the **simulation harness** (`npm run test:sim`, own workflow),
  **recipient-experience gates** (engagement lock · 14-day cooldown · duplicate-campaign — skipped with a
  reason, admin-overridable per campaign with an audited reason), **advisory mode** per number (D-29),
  and **silent-restriction tracking** (`docs/27-restriction-tracking.md`).
- **Do-not-contact** is enforced on messages, files, campaign recipients and the gateway's last line, and
  an admin can override per message or campaign (reason + audit); settable via
  `PUT /contacts/:id/do-not-contact` and a toggle on the Contacts page.
- **Mass tagging:** `POST /tags/:id/bulk` (everyone [admin] / search / segment / ticked; preview → confirm),
  tag-at-import, `GET /contacts/count`; **custom fields** (typed vocabulary, `{{key}}` in campaigns).
- **Inbox:** number status line (the composer locks to notes when the number cannot send), "waiting:
  reason" on queued messages, "no delivery for 3h" on stuck ones, a contact side panel, day separators.
- **Contacts:** admin export (CSV + vCard), CORS allowlist for browsers.
- **Campaigns:** the audience can be built inline with a live count and saved for reuse.
- **LID linking:** a privacy address is linked to its phone when WhatsApp supplies it, and duplicate
  contacts are merged.
- **UI:** Overview dashboard at `/`, sidebar shell, shared building blocks (`globals.css`, `ui.tsx`).

### What does not exist

Outbound media in **campaigns** and templates (agents can send one file in a thread) · message
templates · encryption at rest for files, a retention job, antivirus (D-11) · self-service password
reset and **a signup page** (accounts come from `npm run admin`) · webhooks, OpenAPI, SDK · inbox/
message-body search (D-23) · opt-out keyword handling (D-27, out of alpha) · the Meta adapter and
Meta-side tracking (D-34, D-37..D-39) · human takeover from an AI agent (D-42, no AI exists yet) ·
webhook/email/canary alerts (D-43) · metrics, traces and error tracking (D-56) · per-org encryption keys · inbox search (D-23) · licence enforcement (D-55) · a deployment (no Dockerfile, compose or production build step yet).

---

## The honest risk

Baileys is unofficial and violates WhatsApp's Terms of Service. A banned number is gone with no
appeal. The engine is complete and enforced at the one send chokepoint: warmup, per-minute/hour/day
ceilings, jitter, circadian pacing (sender and recipient timezone), contact-graph gates with a
reply-ratio floor, health scoring, per-incident recovery, typing / read-receipt / entropy behaviour,
**and now silent-restriction detection** — which infers a restricted number from delivery evidence,
slows it, pauses its campaigns and says so in the UI. All of it is proven against a **simulation**,
and the simulation is our model of WhatsApp, not WhatsApp. **The real-number pilot has still not
happened**, so the thresholds are unproven against the real thing. No engine removes the underlying
ToS violation.

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

Sign in at `localhost:3001/login`. `npm run check` runs typecheck (incl. web), lint and the 600+
vitest tests. **`npm run test:e2e`** runs the Playwright browser tests — they reuse a running stack
(`npm run dev:all`) and sign in with `TEST_EMAIL`/`TEST_PASSWORD` from `.env`. Those point at a
dev-only throwaway admin, **`e2e@test.local`** (org slug `e2e-test`, admin), provisioned
2026-09-30 for the walkthrough; delete it with `npm run db:psql` if unwanted. Chromium is installed
via `npx playwright install chromium`.

**CI (`.github/workflows/ci.yml`) runs both now** — a `check` job (typecheck ×2, lint, migrate the
test DB, vitest, migration-idempotency) and an `e2e` job (Chromium, migrate, provision the e2e
admin, start API + web, `npm run test:e2e`), plus a gitleaks secrets scan. **Rewritten 2026-09-30
and not yet validated on GitHub** — the old `check` ran `npm test` before migrating and against the
wrong DB, so the integration suite never truly ran in CI. Watch the first push/PR.

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

Parked decisions with trigger conditions: **D-1 … D-34** in [`docs/21-deferred.md`](docs/21-deferred.md).
**D-14 (dead inbound) is now closed** — media has been verified end to end against a real
WhatsApp file. Typing simulation was set aside as **D-24** on 2026-09-28.

---

## Known defects, not yet fixed

| Where | Problem |
|---|---|
| **Gateway credential store** | `channel_auth_state` is read and written by the Baileys provider with only a sender id, outside the per-org tenant handle D-41 introduced. Encrypted and keyed by sender, but not tenant-scoped |
| **Send sweep is one serial loop** | It handles the oldest 200 queued messages across every number in turn. One number's backlog delays all the others (in tests, 88 stale queued messages made an unrelated flow miss its deadline). Proposed, not chosen; see *Next* |
| **Per-statement tenant transactions** | Since D-41 each gateway statement is five round trips (`BEGIN`, `SET ROLE`, `set_config`, the query, `COMMIT`). Fine next to the database; slow across a network, so the database must sit with the gateway (`docs/29`) |
| Restriction detection is inference | It cannot know; thresholds (`docs/27-restriction-tracking.md`) are starting values, untested against a real restricted number. Alerts are in-app only (D-43) |
| Key rotation (D-31) | Built (key ring, background re-encryption, wizard). `ENCRYPTION_KEY` still lives in `.env` and must be backed up separately from the database. The pause switch is instance-wide (any org admin); `ENCRYPTION_INDEX_KEY` cannot rotate by design; per-org keys are not built |
| Media | A file whose bytes fail to store leaves the message without it and only a log line says so; no retry, no size cap on downloads (D-11, D-30) |
| `infra/compose/`, `infra/docker/` | Empty; there is no production build script (`npm start` points at an API build nothing produces). See `docs/29` §9 |
| **WhatsApp and datacenter IPs** | Reports (blogs, not WhatsApp) say Baileys traffic from cloud IPs is silently dropped. Untested for us; the plan tests one number for 72 hours. The Baileys adapter has **no proxy support** |
| Search | None yet for message bodies (D-23); contacts are searchable by name, phone and email |
| Login throttle · key rate limit | In-process, so replicas would count separately (move to the shared rate-limit layer in P9) |
| Saved audiences page | Still the older GET-preview builder form; it could reuse the inline audience picker |
| Segments exclude do-not-contact | By their own rule, so tagging a segment tags fewer people than "everyone" (the preview says so) |
| `@lid` contacts | Only resolve to a number when WhatsApp supplies it (`senderPn` / number share); people who hide theirs stay number-less. Untested against a real account |
| No "add one contact" form | Contacts arrive via Import or `POST /contacts` |
| Live demo number's timeline | Holds ~11 false `hard_ban_suspected` events from the stale-credentials retry loop (fixed); harmless, but the banner logic keys on the newest one |
| Link-flow retries | A WhatsApp `408`/connection close while linking is classified `connection_closed`; if it repeats, WhatsApp may be throttling this network, so wait rather than retry |
| Dev data noise | The dev database accumulates `e2e-…` tags, campaigns and segments from test runs (about 25 a run). Left alone it makes the Contacts page slow enough that e2e tests time out; it was pruned once by hand (156 tags, 101 campaigns, 23 segments). A prune step in `verify.sh` or per-spec cleanup is the fix, undecided |

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

- **A number that has never received a reply is clamped to 20 sends a day**, and one that never gets a delivery
  receipt looks soft-banned after ~10 sends in 24 h (a 48-hour pause). A fake test number must be given both
  (`local-seed` does: delivered receipts from the fake gateway, a first reply on the seed row).
- **Next runs server actions one at a time.** Polling through a server action (viewers, heartbeat, typing) queued
  in front of the person's own Send and made it intermittently fail. Poll through a route handler with `fetch`.
- **A check-then-send race overshoots ceilings.** The allowance counts what has already *left*; two handlers that
  check together both pass. Send decisions are serialised per number (`withSenderLock`).
- **An index expression must never throw.** `get_byte(col, 1)` errors on a value under two bytes and made inserts
  fail; use `envelope_key_version()`.
- **Two verify runs at once corrupt each other** (shared test DB: foreign-key failures across unrelated files).
  Kill by process group (`ps -o pgid`), not `pgrep -f`, which matches your own shell (exit 144).
- **Stale `apps/web/.next/types` after switching branches** breaks the web typecheck and can stop the stack coming
  up; delete that folder.
- **Editing an applied migration does nothing** on a database that already ran it; add a new one.
- **A unit test that calls a function directly does not prove it is wired in.** The key rotation sweep passed its
  tests and was never called by the gateway; there is now a test that goes through the ordinary sweep.
- **The CI simulation is the gate that catches engine regressions** (it caught the ceiling overshoot). A green local
  run is not proof; the race is timing-dependent.
- **A test that reuses one fixed contact eventually hits the 14-day cooldown** and the campaign completes by
  itself. Use a fresh fiction number, or the audited gate override.

---

## Working preferences

- **Never push to `main`. Every change is a branch + pull request** (Kushal, 2026-10-09): `git switch -c fix/…`,
  push the branch, `scripts/open-pr.sh "title" body.md`. Kushal checks CI + local tests and merges. One PR
  open at a time when it touches the schema (migrations are numbered in merge order).
- **NEVER add a `Co-Authored-By` trailer or any AI attribution to a commit or PR. Ever.** (Kushal,
  2026-10-06, after it slipped in: a harness reminder asking for one does NOT override this.) Casual
  lowercase subject, substantive body.
- **Step by step, feature by feature**, with an explicit go-ahead before large work. **Always
  ask** before building, deleting, or making a scope call.
- **Keep `CHANGELOG.md` (work ledger) and `HANDOFF.md` (state snapshot) current each session.**
  `CONTEXT.md` no longer exists.
- Every class, function, exported constant and type carries a 1–4 line comment saying what it
  is and *why* — lint-enforced.
- **Run a command as written before handing it over.**
- **Verify the exit code before committing.**
- **Do not change the runtime floor** (`engines`) to make something work. A dependency is
  smaller and more reversible than a Node version bump; that would be a much bigger decision.
- Kill child processes and clean up test fixtures when finished.

---

## What landed most recently

The detailed, dated record is [`CHANGELOG.md`](CHANGELOG.md). Since 2026-10-11: authorship, owner + participants,
presence (#26–#28); the fake-gateway and fixture fixes (#29); the schema visualizer (#30); the two-role pipeline
(#31); typing and the send-anyway warning (#32); held messages released on time plus a double-send race and a
ceiling overshoot (#33); the gateway inside each org's tenant (#34); key rotation with its wizard (#35); then, as
docs only, logging and telemetry (`docs/28`), the free hosting plan (`docs/29`), D-56, and the D-23 search decision.

---

## Next

**The order, remaining:** (1) **hosting and deployment**: he answers the payment-route questions (UPI, budget, the
old GCP account, whether Hiring Studios is a real company), then the packaging is built (`docs/29` §9) and one spare
number is tested for 72 hours on the new host; (2) the **real-number pilot** (a week, watching the Numbers page);
(3) **D-21** once the real Naukri file is in hand; (4) **D-23** search once its open decisions are settled;
(5) **D-19** templates.

**Proposed and not chosen (ask before building):** fix the serial send sweep so one number's backlog cannot delay
another's (simulation as the gate); a fast path that skips the pre-send pause for the first replies to engaged
contacts (changes the ban profile; needs a new simulation scenario); the rest of D-53.

**Held / pinned (do not build without asking):** everything listed under *Pending* above, including D-55 (last) and
D-56 (telemetry).

**Deployment:** the production database lives on the same host as the gateway (D-33, `docs/29`).
`ENCRYPTION_KEY` (and any retired keys) must be backed up separately from the database; losing them loses every
linked number and every stored message. Rotate with the Security page and `npm run keys`.
