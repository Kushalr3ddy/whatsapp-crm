# Changelog & Backlog

A running ledger of **what is done** and **what is left**. Separate from
[`HANDOFF.md`](HANDOFF.md) on purpose: the handoff is a point-in-time *state snapshot* (defects,
gotchas, how to run it); this is the *ledger of work* — a checklist you can track against.

- **Done** is grouped by build phase (P0–P8), newest work called out at the top.
- **To do** is one prioritised list, top = do next.
- Full evidence for defects and blockers stays in `HANDOFF.md`; this file points at it rather
  than copying it.

---

## Latest

### 2026-09-29 — Reframe compliance as the operator's responsibility (jurisdiction-neutral)
- This is a generic, self-hostable tool used worldwide, so it now **bakes in no single
  jurisdiction's compliance regime** (Kushal's call). The India-DPDP-specific framing that read as
  a baked product requirement is reframed to "compliance is the operator's, for their own region"
  across `09-security.md` (the compliance section rewritten), `02-requirements.md` (CON-5, FR-8/9),
  `05-data-model.md` (`consent_record` now optional + operator-defined purposes), `F11-admin.md`
  and `README.md` (DSAR → neutral per-contact export/delete), and the deferred pins **D-2**
  (jurisdiction-specific compliance) and **D-16** (legal front door).
- **Kept, because they are anti-ban, not merely legal:** `do_not_contact` (built), opt-out handling
  (**D-27**, reframed anti-ban-first), not blasting non-opted-in purchased lists, and the
  Baileys-ban-risk disclosure (README, 08-antiban, GETTING_STARTED, link screen). A number that
  ignores these gets banned whatever the law, so they stay as engineering discipline.
- Almost entirely a docs/scope change — the only compliance code was `do_not_contact`, which stays.

### 2026-09-29 — Pin the campaign safety/compliance items (closed alpha)
- The alpha and beta are **closed** (invited recipients, small volumes), so the two campaign items
  that only bite with real external audiences are pinned and deferred until wider release:
  **D-26 · body variation** (spintax / per-recipient + the anti-ban identical-body rule — a known
  soft spot, not yet enforced) and **D-27 · opt-out keyword handling** (auto-honour a `STOP` reply;
  the manual `do_not_contact` gate already exists). Both come back on the first non-team recipient.
- **Templates** stay pinned as **D-19** (rich templates) — body variation lands with them.

### 2026-09-29 — Pin outbound media (D-25, high priority); move getting-started to repo root
- **Outbound media pinned as D-25 and flagged HIGH PRIORITY** — sending files is the top of the
  queue (inbound media is fully built; the send path is text-only). The pin records exactly what it
  takes so it can be picked up cold. Inbox **search stays pinned as D-23** (deprioritised, for later).
- **`docs/27-getting-started.md` moved to `GETTING_STARTED.md` at the repo root** — a run guide
  belongs beside `README.md`, not inside the numbered design docs. Internal links and both indexes
  updated; the numbered-docs sequence resumes at the next number after 26.

### 2026-09-29 — Getting-started doc (clone → running)
- New **[GETTING_STARTED.md](GETTING_STARTED.md)** at the repo root: a from-zero runbook (prereqs,
  install, the five `.env` secrets, `db:setup`, provisioning the first org/admin, `dev:all`, sign
  in + link, verify, stop/start, troubleshooting) so anyone can clone and run it. Linked from the
  README and the docs index.
- Records the thing that trips people up: **`dev:all` runs the stack but does not do the one-time
  setup** — it starts the db + migrates the dev database and starts all three processes, but does
  not `npm install`, create `.env`, provision the org/admin, or migrate the test database.

### 2026-09-29 — Sender-health panel in the Numbers page
- Surfaces what the anti-ban engine is doing to each number, so an operator sees *why* it was
  degraded or quarantined instead of a bare status. On each card on `/link`: a colour-coded band
  badge (Healthy / Degraded / Quarantined), the `risk_score`, the scorer's evidence (delivery %,
  sent and failed in the last 24h), and the relationship breakdown (contacts who replied vs. those
  we have only messaged, plus a reply rate).
- `GET /senders` now also returns the `health` jsonb evidence and per-sender `knownContacts` /
  `contactedContacts` counts. No new endpoint, no new table — the Numbers page already fetched
  `/senders`. Added a `--color-warning` theme token (light + dark) for the degraded badge.
- Verified end to end against the real dev DB: the live response shows the `kushal test number`
  as `active`, risk 0, delivery 100%, **7 replied · 2 no reply**, with `health.computedAt` proving
  the gateway sweep scored it. Server + web typecheck clean, 412 tests green, web build serves.

### 2026-09-29 — P6 health scoring (the closed loop) — anti-ban engine layers built
- The other layers are open-loop rules; this watches the **outcomes** and acts on them
  (`packages/core/src/health.ts`, run in the gateway sweep). It reads delivery ratio, failure
  rate, typed disconnect codes and reconnect churn from the `message` / `channel_session` rows
  already there, rolls them into a **0–100 `risk_score`**, and stores the *evidence* (not just the
  number) in `sender_identity.health`.
- **It acts, both directions.** `high` band → the number is **degraded** (sends at half speed);
  `critical` → **quarantined** (sends held and left queued, its running campaigns skipped, but the
  socket stays up so it can still receive). Crucially it **recovers** — a quarantined number climbs
  back through the bands to `active` once the signals clear, with hysteresis (a `medium` reading
  holds, full recovery needs `low`) so a score near a threshold does not flap. That both-directions
  property is the exact trap this project has hit three times (a status that only ever moved one
  way), so it has a dedicated test.
- Enforced at the one send chokepoint (`handleSend`): quarantine short-circuits the send, degraded
  doubles the pause. **No migration** — the score and evidence use the `risk_score` / `health`
  columns that already exist; the normalised `send_risk_event` table is a later refinement.
- Pure scoring maths (`computeRiskScore`, `riskBand`, `nextStatus`, `deliveryRatio`) plus the
  DB-backed `scoreSenderHealth` / `scoreConnectedSenders`, with tests for each band, the volume
  floor, "a bad disconnect only counts while the socket is down", the full active↔degraded↔
  quarantined transitions, recovery, and the send-path gate. 18 new tests (**412 total**).
- **P6 is now essentially complete:** warmup, ceilings, jitter, circadian pacing, contact-graph
  gates and health scoring are all built. Left: typing simulation (D-24) and the per-incident
  recovery *schedules* (Layer 6 — status recovery works, the timed pause/resume ramps do not).

### 2026-09-29 — P6 contact-graph gates (the relationship layer)
- Messaging strangers who have never interacted with you is, by WhatsApp's own detection, one of
  the two strongest ban signals. Layers 1–2 cap total volume and circadian shapes the time of day;
  this gates by **who** the message is going to, read from real message history
  (`packages/core/src/contact-graph.ts`, called from `handleSend`).
- **Relationship delay multiplier:** `known` (they have replied) 1.0× · `contacted` (we messaged,
  no reply) 1.8× · `stranger` (no contact either way) 2.5× — a cold send is paced more cautiously
  than a live conversation.
- **New-contact throttle:** a hard cap on how many brand-new strangers one number may *start*
  messaging (`NEW_CONTACTS_PER_HOUR` / `_PER_DAY`, default 5 / 20). A stranger over the cap is left
  queued (reason `new_contact_throttle`); known and already-contacted recipients are never
  throttled — the cap is on new conversations, not replies. This is the gate that actually stops a
  fresh list being blasted, which no per-minute rate limit does on its own.
- **Opt-in and backward-compatible** (`CONTACT_GRAPH_GATES=false` disables it): with no config the
  send path is layers 1–2 alone, so the existing suites pass unchanged. Counts come from the
  `message` table (restart-safe, like the other layers); campaigns are gated for free since their
  sends flow through the same point. No migration — relationship is derived, not stored.
- Pure classification + multiplier functions and the DB-backed `checkContactGraph`, with tests for
  each relationship, the hourly and daily throttle, "a known contact still gets through when the
  stranger cap is hit", and the send-path integration. 11 new tests (**394 total**).
- The **timezone warning** also landed: `SEND_TIMEZONE` is set explicitly, not inferred from the
  host/cloud region — documented in `.env.example` and `13-deployment.md` so a region move does not
  silently point the overnight quiet window at the wrong hours.

### 2026-09-28 — P6 circadian pacing (the daily-rhythm layer)
- Layers 1–2 cap *how much* a number sends; this shapes *when*. A number sending at a steady rate
  at 3 a.m. is a clear bot signal, so the send cadence now follows a daily cosine curve: full speed
  09:00–22:00, tapering to dead 02:00–06:00, ramping back by 09:00, read against the number's
  timezone.
- It is the **last gate** in `checkSendAllowance` (`packages/core/src/pacing.ts`): once a send is
  within every layer 1–2 ceiling, overnight it is **deferred** (reason `circadian`, left queued
  like any paced message, with a retry hint for when the number "wakes up"); through the day the
  jittered pause is **stretched** so the shoulders of the day send more slowly than midday.
- **Opt-in and backward-compatible:** applies only when a timezone is set, so layers 1–2 behave
  exactly as before for every other caller — proved by a test, and by the existing pacing suite
  passing unchanged. New config: `SEND_TIMEZONE` (default `Asia/Kolkata`, IANA-validated at boot)
  and `SEND_CIRCADIAN` (default on). Local hour comes from the platform `Intl` database — **no new
  dependency**. Campaigns are gated automatically, since their sends still pass through this gate.
- Pure, unit-tested curve (`circadianActivity`), delay stretch (`circadianDelayMs`) and timezone
  reader (`localHour`), plus integration tests that a 3 a.m. send defers and a 2 p.m. send goes.
  8 new tests (**383 total**). No migration — the timezone is config, not schema (per-org
  timezone via `org_setting` is a later refinement).

### 2026-09-28 — Docs: retire the ADRs, fold the reasoning inline
- The four `docs/adr/` files (licence, Baileys version, Fastify-over-NestJS, Express-over-Fastify)
  were formal decision records whose reasoning already lived, in plain language, in the docs they
  belong to. `ADR` read as unexplained jargon scattered across HANDOFF, the stack doc, the roadmap
  and more, so: **the four files are deleted and every `ADR` reference stripped from the active docs.**
- The *why* is preserved where it belongs: the Express-over-Fastify-over-NestJS reasoning stays in
  `10-stack.md`; the Baileys `6.7.24` pin (incl. the "use the unscoped package" note) in `10-stack.md`
  + D-5; the licence question in D-3 + the roadmap. `11-conventions.md` now says decisions are
  recorded in the doc they belong to, not in a separate ADR file.
- **`CONTEXT.md` left untouched** — it is the retired, append-only session log, and its ADR
  mentions are accurate history of when those files existed. Rewriting it would falsify the record.

### 2026-09-28 — Docs: sync stale "not built / broken" claims to current reality
- A full read-through of `docs/` (46 files) against the code turned up a batch of claims that
  were true when written and have since been overtaken. Fixed:
  - **README** status banner ("P1 complete, no WhatsApp yet") and test count (169 → ~375);
    now points at `HANDOFF.md`/`CHANGELOG.md`, not the retired `CONTEXT.md`.
  - **STRUCTURE.md** "as of P1, only shared/db/api carry code" → lists what actually carries code.
  - **20-orientation** phase table (P3 done, P4 mostly, P5/P7 first slices, P6 layers 1–2), the
    "prototype = finish P3" note, and the `npm run dev` "only /health" line.
  - **23-auth** "Not built" table — removed `audit_log` (built), corrected rate-limiting (per-key
    now enforced, in-process caveat remains) and assignment (`assignee_user_id` now populated).
  - **15-api** "Known rough edges" — both bugs (malformed-UUID 500, `status: 0`) are fixed.
  - **24-local-testing** — attachments render, pacing exists, and D-14 is closed (media verified
    end to end against a real file).
  - **08-antiban** — the "capped harder / D-14" caveat now reflects D-14 closed and the rule
    unblocked.
  - **10-stack** — Baileys "TBD" → `6.7.24` pinned, with the reasoning kept inline.
- **Group C:** `25-ingestion-guide.md` said Excel was **built** in its top box but **not built**
  in the diagram, §3.2, the summary table and "build next" — reconciled all four to built; same
  for `07-ingestion`'s dedup table.
- **`ENCRYPTION_KEK` typo** in `13-deployment.md` → `ENCRYPTION_KEY` (a deploy following the doc
  would set the wrong var and crash at boot). Confirmed `APP_SECRET` / `PUBLIC_URL` /
  `DATABASE_URL` all match `packages/shared/src/config.ts`.
- **`11-conventions.md` Git section rewritten to match reality** — straight to `main`, no feature
  branches, plain lowercase commit lines (no Conventional-Commits prefix), no AI attribution, and
  `CONTEXT.md` marked retired in favour of `HANDOFF.md` + `CHANGELOG.md`.
- **`sender_identity.status` standardised** on `linking / active / degraded / quarantined /
  retired` (matches the anti-ban engine + audit action `sender.quarantined`); fixed the stray
  `disabled` in `26-linking-lifecycle.md` and noted that `app_user.status` (`active / disabled`)
  is a separate table, not a conflict.
- **Feature index (`06-features/README.md`) de-overclaimed** — F2/F4/F5/F6/F7/F8 were ✅ but are
  first-slices; marked ⚠️ partial with the deferred remainder noted, and added a status legend.
  F6 anti-ban in particular is layers 1–2 of 6.

### 2026-09-28 — D-14 closed: inbound alive, media verified end to end
- The `kushal test number` was re-linked (fresh QR) and a message sent **to** it from another
  phone. **Inbound works again** — dead since 2026-09-20, it was a corrupt companion session, not
  our code, and the unlink→re-link recovery fixed it exactly as designed.
- Verified three ways, not by trusting the UI: 5 inbound rows landed right after the re-link;
  **zero** `Bad MAC` / decrypt failures in the gateway log (was 17 frames failing before);
  `messages.upsert` fired and logged `inbound message stored` ×5.
- **Media proven against a real WhatsApp file for the first time** — the thing D-14 blocked. An
  inbound image stored as a genuine JPEG (1126×600, 49,408 bytes), `image/jpeg` typed from magic
  bytes, sha256 set, under an unguessable org-scoped key; bytes-on-disk matched bytes-in. Only gap
  is `scanned_at` (antivirus = D-11, out of scope).
- **Not yet done** (deliberately held): the `[TEST DATA]` fixtures are still in the dev DB — they
  can be deleted now that real media is proven, pending the call. No commit yet.

### 2026-09-28 — Numbers page: archive unlinked numbers, DB-driven unlink button
- **No delete** (a number with conversations can't be safely removed — FK `restrict`, and it
  would lose history). Instead, an unlinked number that was connected before is kept at the
  bottom under **"Previously linked numbers"**, so its conversations stay reachable in the inbox;
  it can be linked again to reconnect.
- **The unlink button now reads its state from the database.** `GET /senders` returns a `linked`
  flag (are credentials stored?); when false the button greys out to **"Already unlinked"**.
  After clicking unlink the panel re-fetches the server so the button reflects the gateway having
  cleared the credentials — no more stale "still there after clicking". No new table.
- 1 test for the flag (**375 total**). Verified in the browser.

### 2026-09-28 — `POST /contacts`
- The one way to add a single person over HTTP — until now a contact could only appear from an
  inbound message, a one-off send, or an import, so `contacts:write` was an enforceable scope with
  nothing behind it. This is what it now guards.
- Body: `displayName?`, `phone?`, `email?`, `customFields?`, and **`externalRef?`** — the hook the
  job portal uses to carry its candidate id, so the two systems join without this one knowing
  anything about candidates. At least one of phone/email required.
- Phone goes through the one normaliser (a number written any way is one contact, M8; a landline
  is stored but not required to be WhatsApp-reachable). A create never silently merges: if an
  identity already names someone it's **409 `CONTACT_EXISTS`** with the existing id. Identities
  scoped per org. No new table. 7 tests (**374 total**).

### 2026-09-28 — Unlink button fixes + linking-lifecycle doc
- The Unlink control was easy to miss (styled as grey fine print) and was **hidden exactly when
  a number was connected** — the D-14 case where you most need it. Now it's a visible bordered
  button, shown even on a connected number, and after unlinking the panel flips to the link
  controls (so "link it again above" points at a real QR). Verified end to end in the browser.
- New **[docs/26-linking-lifecycle.md](docs/26-linking-lifecycle.md)**: how the gateway, database
  and phone stay in sync on link status; the command channel; why "connected" ≠ "receiving".
- **Note:** the dev `kushal test number` is now genuinely **unlinked** (credentials cleared) from
  exercising this — it needs a fresh QR scan with the phone to work again. That is the D-14
  recovery state, not damage.

### 2026-09-27 — P5: Excel import + an Import tab in the UI
- **Excel (.xlsx) is now supported**, alongside CSV. The upload endpoint detects a spreadsheet by
  its bytes, reads it with exceljs taking every cell as its **displayed text** (so a phone stored
  as a number survives as its digits, not `9.8e9`), converts to CSV, and feeds the exact same
  dry-run/commit/dedup pipeline. New dependency: `exceljs`.
- **New Import tab** (`/import`): upload a CSV or .xlsx → the columns are auto-guessed with
  dropdowns to pick Phone (required) / Name / Email → **Preview** (dry run, writes nothing) →
  **Import** (commit). File-hash dedup still refuses the same bytes twice.
- This is the **simple** mapping; the full wizard (transforms, multiple identities, saved
  mappings) is pinned **D-21**, and row-level dedup with a diff-style review is **D-22**.
- 3 new tests (**367 total**), including a numeric phone cell surviving intact and a corrupt
  sheet → 422.

### 2026-09-27 — Unlink / re-link recovery (unblocks D-14)
- A number can now be **unlinked**: `POST /senders/:id/unlink` signals the gateway (via the same
  durable-row + NOTIFY channel as linking), which calls `logout()` — logging out on WhatsApp's
  side and **clearing the stored credentials** — then resets the session and returns the sender to
  awaiting-link. A web **Unlink / reset** button on the Numbers page drives it.
- Why it matters: Baileys only issues a fresh QR when there are *no* stored credentials, so a
  corrupt or logged-out session (which still looks "linked" because sending works) could never be
  re-linked — there was no code path that cleared creds. This is the recovery path **D-14** needs:
  unlink → link → scan a fresh QR.
- Migration `0013` (a column + trigger, no new table). 5 tests (**364 total**), including the
  gateway clearing real credentials from `channel_auth_state`.

### 2026-09-27 — P4: mark-read + open any thread
- **Unread count now resets.** It was incremented on every inbound and cleared nowhere, so the
  badge only ever grew. Opening a thread (fetching its messages) now zeroes it, and there is an
  explicit `POST /conversations/:id/read` too.
- **`GET /conversations/:id`** — a single conversation by id, so a thread past the recent-100 list
  cap can be opened. The thread page now loads its details from this instead of scanning the list.
- 6 new tests (**359 total**). Browser-verified: the media-demo thread's unread badge cleared on
  open while the others kept theirs.

### 2026-09-27 — P4: thread lock (assignment-based, admin override)
- Replying into a thread assigned to another agent → **409 `THREAD_ASSIGNED`**. The assignee
  replies fine, an **admin overrides**, and an **API key is exempt** (an integration is not a
  person claiming a thread). Server-enforced in `POST /messages`; the composer mirrors it
  (Reply disabled, "reassign to reply", note still allowed).
- A deliberately simple stand-in for presence/collision (**D-17**) — no new table, reuses
  `assignee_user_id`.
- 5 new tests (**353 total**). Browser-verified the whole P4 UI end to end (filters, assignee +
  resolve, attachments as download links, Reply/Note toggle, note round-trip).
- Docs: testing doc ([docs/24-local-testing.md](docs/24-local-testing.md)) gained an inbox section
  covering every P4 endpoint + refusals; Insomnia collection gained notes/canned-reply requests
  and `conversations:write` on the minted key. Pinned **D-17** (presence/typing) and **D-18**
  (snooze, Meta-window UI, keyboard shortcuts).

### 2026-09-27 — P4 chunk 2: internal notes + canned replies
- **New tables** `internal_note` and `canned_reply` (migration `0012`, RLS forced + granted to
  `crm_app`, verified on both databases).
- `POST` / `GET /conversations/:id/notes` — team-only notes. A note lives in `internal_note`,
  never `message`, so it can't enter the send path — "a note is never transmitted" (AC-4) is true
  by construction, with a test asserting it. Optional `mentions` (uuid[]) stored for later.
- `GET` / `POST /canned-replies` — saved replies, `shortcut` unique per org (duplicate → 409).
- Web: notes interleave with messages on one timeline (distinct styling); composer has a
  Reply/Note toggle and a saved-reply picker that substitutes `{{name}}` from the contact.
- 7 new tests (348 total); verified live against the dev DB, including AC-4.

### 2026-09-27 — P4: attachments in the thread UI
- Received attachments now render in the thread as a download link (filename + type + size)
  instead of the old "not downloaded" placeholder; a media message whose bytes never arrived says
  "attachment could not be fetched".
- New web-side proxy route `GET /media/:id` ([apps/web/app/media/[id]/route.ts](apps/web/app/media/[id]/route.ts))
  forwards the signed-in session to the API and streams the file back, preserving the API's
  `Content-Disposition: attachment` + `nosniff` headers. The browser can't reach the API's media
  route directly (different port in dev; the UI never holds a machine credential), so this is the
  bridge.
- **No new tables** — the API already served the `media` object; only the UI ignored it.
- Verified: proxy forward path proven end-to-end (web → API → passthrough); full suite still 341.
  A *successful authenticated* download + the visual bubble not yet eye-verified (needs a login).

### 2026-09-25 — P4 chunk 1: assignment + status + filters
- `PATCH /conversations/:id` — set `status` (open/closed) and/or `assigneeUserId` (null unassigns).
  Cross-org conversation → 404; assignee from another org → 422 `NOT_A_MEMBER`; empty body → 422.
  Writes a per-field audit row (`conversation.assigned`, `conversation.status_changed`); a no-op
  change writes nothing.
- `GET /conversations` — `status` and `assignee` (`me` / `unassigned` / UUID) filters; now returns
  `assigneeUserId` + `assigneeName`. `assignee=me` on an API key → 422.
- `GET /users` — org members for the assignee picker.
- Web: filter tabs (Mine/Unassigned/All + Open/Closed/Any) filtering client-side; assignee dropdown
  + Resolve/Reopen in the thread header; assignee shown on each list row.
- **No new tables** — reused existing `conversation.assignee_user_id` and `conversation.status`.
- 11 new integration tests (341 total). Typecheck + lint clean. API verified end-to-end via
  supertest; authenticated browser click-through not yet done (needs a login).

---

## Done, by phase

### P0 · Design — ✅
- 42 design docs (`docs/`), prior-art mistake catalogue (M1–M31), roadmap, orientation. (The
  four decision records that lived in `docs/adr/` were later folded into the relevant docs — the
  stack choices into `10-stack.md`, licence + Baileys version into `21-deferred.md` — and the
  `ADR` jargon dropped, 2026-09-28.)

### P1 · Skeleton — ⚠️ partial (marked done, is not)
- Express 5 app, boot-time Zod config gate, forward-only migrations, CI.
- Gated startup: config validated → schema verified → tenant isolation checked → listen.
- **Missing:** `infra/compose/` is empty (no `docker compose --profile core up`); `email` and
  `secrets` drivers not built (only `kms` and `storage` exist).

### P2 · Core domain — ✅ mostly
- Orgs, users, `org_membership`, server-side sessions (argon2id), per-org API keys with scopes.
- Row-level security forced on every tenant table from migration 1.
- `audit_log`: append-only, RLS'd, `UPDATE`/`DELETE` revoked, written in the change's transaction.
- `npm run admin` CLI for provisioning and support.

### P3 · Channels — ✅
- Baileys adapter: link by QR **or** pairing code, send, receive, delivery receipts, auto-reconnect.
- Credentials encrypted in Postgres — sessions survive a restart.
- Gateway as its own process, commanded through a durable table + `NOTIFY`.
- HTTP API for conversations/messages/senders; web UI (sign-in, inbox list/thread/composer, link
  screen with live QR + countdown, light/dark).

### P4 · Inbox — ⚠️ partial
- ✅ Conversation list, thread view, composer; message bodies encrypted at rest.
- ✅ **Chunk 1 (2026-09-25):** assignment, status, list filters (see *Latest*).
- ❌ Notes, canned replies, realtime/presence, search, snooze, priority, Meta window countdown,
  keyboard shortcuts, attachments in the thread UI. (See *To do*.)

### P5 · Ingestion — ✅ first slice
- CSV import: upload → dry run → commit. Content-hash dedup; partial unique index + `?force=true`
  re-import supersedes the old run. Per-row ledger, phone normalisation, sparse-file guard.
- ❌ Excel, Google Sheets, REST puller, schedules, mapping UI.

### P6 · Anti-ban — ⚠️ layers 1–2 of 6
- ✅ Warmup ramp, per minute/hour/day ceilings, Gaussian jitter, counted from the `message` table
  (survives restarts); an override may only *lower* a ceiling.
- ❌ Layers 3–6: typing simulation, circadian pacing, contact-graph gates, health scoring, recovery.

### P7 · Campaigns — ✅ first slice
- Create draft, freeze the audience at start, gateway paces recipients to the anti-ban ceiling,
  instant pause, day-count forecast, cancelled recipients marked skipped with a reason.
- ❌ Templates (a campaign carries a plain body).

### P8 · Meta Cloud API — ❌ not started

### Cross-cutting — ✅
- RLS on the request path: tenant transaction + `SET LOCAL ROLE crm_app`, proven by no-filter tests.
- Storage: `StorageDriver` port + filesystem driver + 25-test contract suite.
- Media: download, magic-byte typing, per-org sha256 dedup, unguessable keys, `GET /media/:id`
  (attachment-only headers), `mediaUnavailable` marking; read auditing (D-13).
- Small fixes: malformed UUID → 422 not 500; `problem()` no longer emits `"status": 0`; per-key
  rate limiting enforced.

---

## To do (top = next)

### Quick wins / P4 continuation
1. **Outbound media** — send path must carry a file; `OutboundContent` must stop being text-only.
2. **P4 realtime (WS `/realtime`).** Live inbound (< 1 s, AC-2) — blocked by **D-14** (inbound
   dead). Presence + typing / collision detection (AC-3) is **pinned as D-17** — do it in the
   same slice as live inbound so the transport is paid for once. *New table:* `conversation_participant`.
3. **P4 search — PINNED as D-23** (message bodies + contact fields, AC-7). The last substantial
   P4 piece; parked because it needs the blind-index vs trigram decision on encrypted bodies.
4. **P4 leftovers — PINNED as D-18** (not required now): snooze (AC-6), Meta 24-hour window UI
   (AC-9, needs P8), keyboard shortcuts (AC-10). Priority flag also deferred.

> Presence/typing/collision → **D-17**. Snooze/Meta-window/keyboard → **D-18**.

### Other feature work
5. **Close out P1** — a compose file, plus `email` and `secrets` drivers, each with a contract
   suite like storage has.
6. **P6 layers 3–6** — circadian pacing, contact-graph gates, health scoring. (Typing simulation
   is now **pinned as D-24** — set aside 2026-09-28.)
7. **P8 — Meta Cloud API adapter** (official, paid transport for business-critical messages).

### Hardening / deployment
8. **Deployment** — staging/prod config; decide the production database. **`ENCRYPTION_KEY` must
   be backed up separately from the database** — losing it loses every linked number and message.
9. **P9 shared rate-limit layer** — login throttle and per-key limit are in-process today, so
   replicas each count separately.
10. **Media hardening (D-11)** — encryption at rest for files, retention job, antivirus, size cap.

---

## Blockers (detail in `HANDOFF.md`)

- ~~**Inbound messages dead since 2026-09-20**~~ — **CLOSED 2026-09-28 (D-14).** Re-linked, inbound
  verified, media proven end to end against a real WhatsApp file. See *Latest*.
- **Test data in the dev DB** (`[TEST DATA - DO NOT TOUCH] …`) — D-14 is now closed, so these are
  safe to delete; still present pending the call.
