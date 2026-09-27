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
1. **Media in the inbox UI** — the API serves attachments; the thread UI still says "not
   downloaded" ([inbox/[id]/page.tsx](apps/web/app/inbox/[id]/page.tsx) comment is stale). Render
   the `media` object as a download link + filename. No backend work.
2. **Outbound media** — send path must carry a file; `OutboundContent` must stop being text-only.
3. **P4 chunk 2 — notes + canned replies.** *New tables:* `conversation_note`, `canned_reply`.
   Endpoints `POST /conversations/:id/notes`, `GET /canned-replies`. Notes never reach a provider
   (AC-4). Canned replies substitute contact variables (AC-5).
4. **P4 chunk 3 — realtime (WS `/realtime`).** Live inbound (< 1 s, AC-2), presence + typing /
   collision detection (AC-3). *New table:* `conversation_participant`. Live assignment push.
5. **P4 chunk 4 — search** over message bodies + contact fields (AC-7). Needs the blind-index /
   trigram decision on encrypted columns.
6. **P4 leftovers** — snooze (*new column* `snooze_until` + a scheduler, AC-6), priority (*new
   column*), Meta 24-hour window countdown + template-only composer (AC-9), keyboard shortcuts
   (AC-10).

### Other feature work
7. **`POST /contacts`** — `contacts:write` is an enforceable scope with nothing behind it; a
   contact can only be created by an inbound message, a one-off send, or a CSV import.
8. **Close out P1** — a compose file, plus `email` and `secrets` drivers, each with a contract
   suite like storage has.
9. **P6 layers 3–6** — typing simulation, circadian pacing, contact-graph gates, health scoring.
10. **P8 — Meta Cloud API adapter** (official, paid transport for business-critical messages).

### Hardening / deployment
11. **Deployment** — staging/prod config; decide the production database. **`ENCRYPTION_KEY` must
    be backed up separately from the database** — losing it loses every linked number and message.
12. **P9 shared rate-limit layer** — login throttle and per-key limit are in-process today, so
    replicas each count separately.
13. **Media hardening (D-11)** — encryption at rest for files, retention job, antivirus, size cap.

---

## Blockers (detail in `HANDOFF.md`)

- **Inbound messages dead since 2026-09-20** (`Bad MAC` on every frame) — parked as **D-14**.
  Blocks the only end-to-end proof that media works against a real WhatsApp file. Needs a re-link,
  which needs the phone.
- **Test data in the dev DB** (`[TEST DATA - DO NOT TOUCH] …`) — left in place until D-14 closes.
