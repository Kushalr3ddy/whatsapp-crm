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
- 42 design docs (`docs/`), ADRs, prior-art mistake catalogue (M1–M31), roadmap, orientation.

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
6. **P6 layers 3–6** — typing simulation, circadian pacing, contact-graph gates, health scoring.
7. **P8 — Meta Cloud API adapter** (official, paid transport for business-critical messages).

### Hardening / deployment
8. **Deployment** — staging/prod config; decide the production database. **`ENCRYPTION_KEY` must
   be backed up separately from the database** — losing it loses every linked number and message.
9. **P9 shared rate-limit layer** — login throttle and per-key limit are in-process today, so
   replicas each count separately.
10. **Media hardening (D-11)** — encryption at rest for files, retention job, antivirus, size cap.

---

## Blockers (detail in `HANDOFF.md`)

- **Inbound messages dead since 2026-09-20** (`Bad MAC` on every frame) — parked as **D-14**.
  Blocks the only end-to-end proof that media works against a real WhatsApp file. Needs a re-link,
  which needs the phone.
- **Test data in the dev DB** (`[TEST DATA - DO NOT TOUCH] …`) — left in place until D-14 closes.
