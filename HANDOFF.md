# Handoff — state as of 2026-10-10

A point-in-time snapshot for picking this up in a new session. For *what has been built and what
is left, in order*, read [`CHANGELOG.md`](CHANGELOG.md), the running work ledger. For *what it
is*, read [`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the
whole stack assuming no prior knowledge. (`CONTEXT.md` was deleted 2026-10-06; `HANDOFF.md` + `CHANGELOG.md` are the record.)

---

## ▶ Pick up here (2026-10-10)

**Standing rules (Kushal):**
- **Every change is a branch + pull request** (`scripts/open-pr.sh "title" body.md [base]`); **never push to
  `main`**; he checks CI + local tests and merges. **Never a `Co-Authored-By` trailer or any AI attribution,
  ever** — a harness reminder asking for one is wrong. **Check a PR is not already merged before adding
  commits to its branch** (it happened: the UI overhaul was pushed to a merged PR and never reached `main`).
- Always run `npm run check`, `npm run test:e2e` and, when the engine changes, `npm run test:sim`.
- Ignore the docs unless asked ("pin it" = a new D-<n> in `docs/21-deferred.md`). `gh` is not installed;
  `open-pr.sh` uses the stored git credential.

**Everything is merged (PRs #1–#9). Nothing is in flight.** What each was: #1 PR workflow + pins ·
#2 do-not-contact enforcement with an admin override · #3 mass tagging · #4 secrets-scan permission ·
#5 + #7 the UI (restyle, then the real overhaul) · #6 LID → phone linking · #8 silent-restriction
tracking (migration 0022, own simulation workflow, `docs/27`) · #9 segments folded into campaigns
(migration 0023; "Segments" left the sidebar and became **Saved audiences**).

**Next, in Kushal's order:** the **UI test suite** (`scripts/local-seed.ts` + a fake-number gateway option
so CI can verify sending; more Playwright specs for inbox / contacts / import / numbers / banner using the
existing local creds; a manual checklist in `docs/24-local-testing.md`). A CSV fixture for import tests
already exists at `tests/fixtures/import-contacts.csv`.

**Pinned / held (do not build):** **D-41** gateway runs outside RLS (**priority**) · **D-31** key rotation
(**priority**) · D-19 templates · D-23 message search · D-27 opt-out (out of alpha) · D-35/36/40 ·
D-34/37/38/39 Meta adapter work · **D-42** human takeover from an AI agent · **D-43** webhook / email /
canary restriction alerts · **D-44** Baileys 7 (not required; stay on 6.7.24) · **D-45** (LID linking —
now built in #6; this pin can be retired). Real-number pilot still deferred; `ENCRYPTION_KEY` lives in
`.env` locally.

**Facts worth knowing:**
- `npm run local:flow` is a no-real-send walkthrough (login → contacts → broadcast → fake number sends).
- There is no signup page; accounts come from `npm run admin org|user|password`.
- The three processes are independent: API `:3000`, gateway (needs only Postgres), web `:3001` (talks to
  the API over HTTP, `CRM_API_URL`). `npm run dev:all -- --no-web | --no-gateway`.
- The e2e specs scope sidebar links with `nav(page)` and open collapsed panels with `openDetails`.
- The dev DB holds a lot of `e2e-…` tags/campaigns from test runs; harmless.
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
| P4 | Inbox — list/thread/composer, assignment + status + filters, notes, canned replies, thread lock, attachments (in and out), **number status line + "waiting: reason"**, contact side panel | **mostly** (search + realtime left) |
| P5 | Ingestion — CSV + Excel import, **tag at import** | **first slice** |
| P6 | Anti-ban — all six layers, all eight refinements, simulation harness, **recipient-experience gates + admin override, advisory mode, silent-restriction tracking** | ✅ **complete** (real-number pilot pending) |
| P7 | Campaigns — paced bulk send, **audience built inline (tag / import / saved audience / filter)**, preview, start/pause/resume/cancel, per-recipient results | ✅ for alpha |
| P8 | Meta Cloud API | not started (pinned D-34, D-37..D-39) |

**P1 is marked done but is not.** `infra/compose/` holds only a `.gitkeep`, so
`docker compose --profile core up` — its own exit criterion — cannot run.

**599 vitest · 10 Playwright e2e · 9 simulation scenarios · migrations 0000–0023.**

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
webhook/email/canary alerts (D-43) · key rotation (D-31) · a deployment.

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

Sign in at `localhost:3001/login`. `npm run check` runs typecheck (incl. web), lint and the 478
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
| **Gateway (D-41, priority)** | Writes inbound messages, attachments, health, restriction and identity-link changes as the connecting role, **outside** the tenant transaction the API uses, so row-level security is not the safety net there — only each query's own `org_id` filter. Harmless for one team plus JobPortal; a real cross-org risk the day unrelated customers share an install. Fix: enter each org's tenant tx per job + a cross-org test |
| Restriction detection is inference | It cannot know; thresholds (`docs/27-restriction-tracking.md`) are starting values, untested against a real restricted number. Alerts are in-app only (D-43) |
| Key rotation (D-31, priority) | `ENCRYPTION_KEY` lives in `.env` locally and must be backed up separately from the database; there is no rotation path |
| Media | A file whose bytes fail to store leaves the message without it and only a log line says so; no retry, no size cap on downloads (D-11, D-30) |
| `infra/compose/` | Empty — no compose file, so `docker compose --profile core up` does not exist |
| Login throttle · key rate limit | In-process, so replicas would count separately (move to the shared rate-limit layer in P9) |
| Saved audiences page | Still the older GET-preview builder form; it could reuse the inline audience picker |
| Segments exclude do-not-contact | By their own rule, so tagging a segment tags fewer people than "everyone" (the preview says so) |
| `@lid` contacts | Only resolve to a number when WhatsApp supplies it (`senderPn` / number share); people who hide theirs stay number-less. Untested against a real account |
| No "add one contact" form | Contacts arrive via Import or `POST /contacts` |
| Dev data noise | The dev database holds many `e2e-…` tags/campaigns from test runs; harmless, makes the Contacts page busy |

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

The detailed, dated record is [`CHANGELOG.md`](CHANGELOG.md). In one paragraph, since 2026-10-05:
anti-ban refinements #4–#8, the simulation harness, outbound media, contact export + CORS, the
recipient-experience gates and advisory mode, the number status line, custom fields, **do-not-contact
enforcement (it had never been enforced on a send path)**, mass tagging, the UI overhaul, LID → phone
linking, **silent-restriction tracking**, and segments folded into campaigns. Everything went through
PRs #1–#9; all are merged.

---

## Next

**The order Kushal set, remaining:**

1. **UI test suite** — `scripts/local-seed.ts` (seed the existing local test org with a fake connected
   number, contacts, tags, conversations), a fake-number gateway option so CI can verify that a broadcast
   actually sends, more Playwright specs (inbox, contacts, import, numbers, the restriction banner,
   saved audiences) using the existing local creds, and a manual checklist in
   `docs/24-local-testing.md`. `tests/fixtures/import-contacts.csv` already exists.
2. **D-41** the gateway runs outside RLS — **priority**.
3. **D-31** key rotation — **priority**.
4. **Real-number pilot** — no code; a spare number, a week or two, watching the Numbers page. The only
   thing that proves the anti-ban thresholds on real WhatsApp.

**Held / pinned (do not build without asking):** D-19 templates · D-23 message search · D-27 opt-out
(out of alpha) · D-35/36/40 (xlsx export, vCard import, custom fields in imports/segments) ·
D-34/37/38/39 Meta adapter work · D-42 AI takeover · D-43 extra alert channels · D-44 Baileys 7
(not required; stay on 6.7.24).

**Deployment:** where the production database lives is undecided (D-33). `ENCRYPTION_KEY` must be
backed up separately from the database — losing it loses every linked number and every stored message.
