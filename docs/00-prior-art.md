# 00 · Prior art — what the previous system got wrong

**Source:** `github.com/Mikhil31/WhatsAppCRM` (private) @ `36c3fd4`, last commit 2026-08-03.
`/home/kushal/everything/WhatsAppCRMBailey` is an abandoned near-identical copy.
~6,600 lines of JavaScript, 23 Postgres tables, no tests.

This is not a criticism of that project — it was a working prototype that validated the
idea and taught expensive lessons in production. This document exists so those lessons are
paid for once. **Every row below is a defect that actually occurred, and the rule it becomes
is binding on the new build.** It doubles as the architecture's acceptance checklist.

## The three disqualifying facts

**1. It does not use Baileys.** Despite the repository name and `package.json`'s
`"whatsapp-crm-baileys"`, there is no Baileys import anywhere. All WhatsApp I/O is HTTP to a
separate **OpenWA gateway** — a *private fork* of a third-party project, kept as a git
submodule (`.gitmodules` → `Mikhil31/OpenWA-gateway`) that is not even checked out. Roughly
40% of `server/openwa.js`, `server/webhooks.js` and the reconnect paths in
`routes/whatsapp.js` and `routes/sessions.js` exist solely to compensate for that gateway's
defects: silent engine death (5xx on a session reporting `ready`), orphaned Chromium profile
locks, sessions auto-started with no webhook registered, double-fired `message.received`,
`@lid` privacy ids, an `@IsUrl()` DTO that rejects single-label hostnames, an SSRF guard that
blocks loopback. Embedding Baileys directly deletes essentially all of that code.

**2. It is an ATS with messaging bolted on, not a CRM.** 14 of 23 tables are
recruitment-only. There is no generic contact entity — `candidate` *is* the contact entity,
and `whatsapp_contact.candidateid` foreign-keys straight into it. "Campaign" is not an
entity; it is `outreach_round.jobid`, and "no campaign" is literally `jobid IS NULL`. The
pipeline is a `CHECK` constraint duplicated in five places. The AI prompt opens
`"You are a recruiter for Hiring Studios"`. Branding is hardcoded in every `<title>`.

**3. No async work model at all.** No queue, no workers, no retries, no scheduling. Bulk
sends and Excel imports both run to completion inside a single HTTP request — a
100-candidate AI batch holds the connection open for minutes and loses the whole batch on
any disconnect, with no persistence of intent.

## The catalogue

| # | Defect | Where | Rule for the new build |
|---|---|---|---|
| M1 | Transport client imported directly by 5 modules | `openwa.js` ← `routes/whatsapp.js`, `routes/outreach.js`, `routes/sessions.js`, `webhooks.js`, `ai/outreach-agent.js` | One `ChannelProvider` port. Nothing outside `packages/channels/*` imports a transport SDK. Enforced by an ESLint `no-restricted-imports` rule. |
| M2 | Work done inside HTTP handlers | `routes/outreach.js:245-379` | Handlers validate, enqueue, return. Anything touching a third party runs in a worker. |
| M3 | Excel round-trips through the browser | `uploads.js:702` → `public/js/upload.js:78`, forcing `express.json({limit:'50mb'})` | The file never leaves the server. Upload returns a handle; the browser sends only a mapping. |
| M4 | Whole import in one transaction — one bad row rolls back 5,000 | `uploads.js:719-867` | Batched transactions with a per-row error ledger. A run always completes and always reports per-row outcomes. |
| M5 | Two schema sources of truth, no migrations | `schema.sql` (manual `pg_dump`) vs `server/db.js` (274 lines of `CREATE TABLE IF NOT EXISTS` on every boot) | One migration tool, versioned, forward-only, in CI. Zero DDL at runtime. |
| M6 | Fire-and-forget bootstrap — server listens even if it failed | `server.js:87-104` | Startup is a gated sequence: migrations verified, dependencies health-checked, *then* listen. Fail fast and loud. |
| M7 | Dedup matches on empty string | `uploads.js:760-763` — `lower(email) = lower('')` matches every blank-email row, merging unrelated people | Identity resolution is an explicit, ordered, testable strategy. Empty values never match. |
| M8 | Phone never normalised on import, though the normaliser exists | `store.normalizePhone` at `whatsapp-store.js:29`, never called by `uploads.js` | One canonical E.164 normaliser at every boundary, backed by a generated column + unique index. |
| M9 | Blind overwrite on re-import — a sparse file destroys richer data | `uploads.js:769-775` | Per-field merge policy: `overwrite` / `fill_if_empty` / `never` / `append`. Default `fill_if_empty`. |
| M10 | Flat 1000 ms spacing, no jitter — a perfect 1 Hz send pattern | `SEND_SPACING_MS`, `outreach.js:13,334` | A random gap between sends (`08-antiban.md`). Never a fixed interval. |
| M11 | Daily cap counts *rounds*, not messages; AI replies uncapped | `antispam.js:65-72` | Caps count **messages**, per sender identity, in a shared token bucket every producer passes through. |
| M12 | `POST /whatsapp/send` bypasses every anti-spam gate and the daily cap | `whatsapp.js:259` | Exactly one send path. No route, job or agent reaches a provider except through `OutboundDispatcher`. |
| M13 | In-process state blocks horizontal scaling | `inboundLocks` Map at `whatsapp.js:23`; `runtimeConfig` at `recruiter.js:18` mutated by an admin endpoint | No mutable module state. Locks in the cache driver, config in the DB with pub/sub invalidation. |
| M14 | Dynamic SQL identifier interpolation | `uploads.js:770,783` — `UPDATE candidate SET ${assignments}` | No string-built SQL. Identifier allowlists where dynamic shape is unavoidable. |
| M15 | Full DB schema leaked to any logged-in user | `GET /schema/tables`, `uploads.js:943` | No introspection endpoints. Admin surfaces separately authorised and audited. |
| M16 | Weak auth hygiene: no CSRF, no login rate limit, no lockout, no password reset, bcrypt cost 10 | `routes/auth.js:9`, `auth-store.js:6` | Argon2id, rate limiting + progressive lockout, CSRF on cookie routes, full account lifecycle. |
| M17 | `SESSION_SECRET` silently falls back to a random per-boot value | `auth.js:14` | Config schema-validated at boot. A missing required secret is a hard crash, never a warning. |
| M18 | `cors()` with no origin allowlist | `server.js:22` | Explicit origin allowlist from config. |
| M19 | Real PII committed to the repository | `scripts/create-sample.js:4-37` — name, mobile, DOB, street address, salary | Fixtures are synthetic and generated. `gitleaks` + a PII-pattern scan in CI. |
| M20 | Zero tests; "verified live against the real OpenWA session" | `package.json:9` | Full test pyramid (`12-testing.md`). A fake provider makes the whole pipeline testable with no real WhatsApp. |
| M21 | No test/lint CI. The only two workflows are deploy and "backup", neither of which validates anything | `.github/workflows/` | CI from commit #1: lint, typecheck, test, security scan on every PR. |
| M21a | Deploy is `git pull && docker compose down && docker compose up -d --build` over SSH **with a password in GitHub secrets**, `workflow_dispatch` only — full downtime, no migration step, no health gate, no rollback | `deploy_to_server.yml` | SSH keys or OIDC, never a password. Migrate → health-gate → rolling restart → auto-rollback. |
| M21b | **There are no backups.** `daily_backups.yml` has no schedule despite the name, dumps Postgres→SQLite onto the ephemeral runner, then `echo "s3 not yet setup, so skipping"` — the artifact dies with the runner | `daily_backups.yml` | Scheduled `pg_dump` + WAL archiving to object storage, retention policy, and a **restore drill in CI**. A backup never restored is not a backup. |
| M22 | Docs contradict code in both directions | `README.md:3` claims "Baileys, no Chromium" while the code force-kills Chromium locks; `README.md:425` claims no auth long after auth landed | Docs generated from code where possible (OpenAPI, schema, config table); doc-drift is a CI check. |
| M23 | Business rules duplicated across layers | Gate 3 in `antispam.js:36` *and* `db.js:141`; `READY_STATES` in 4 places; `findOrCreateCompany` implemented twice | Each rule has one home. DB constraints are backstops, not duplicates of logic. |
| M24 | Single encryption key, no rotation path — losing it makes all data unrecoverable | `WHATSAPP_DB_KEY`, `.env.example` | Envelope encryption: per-org DEK wrapped by a KEK, versioned key ids, online rotation. |
| M25 | Non-standard logging — timestamps hand-shifted to IST by adding 5.5h and relabelling the `Z` | `logger.js:6-11` | UTC RFC3339 everywhere; localise only in the UI. |
| M26 | **One bad recipient killed the entire engine.** Sending to a synthesized `@c.us` for a privacy-mode (`@lid`) contact made the gateway dereference `undefined`, throwing and taking down the whole session. Watchdog restarts, recruiter retries, it dies again — a permanent crash loop for that one candidate | `openwa.js:152-162`, commit `5b326f5` | Per-recipient failure isolation is structural: every send is a job with its own error boundary, retry policy and dead-letter. A poison message is quarantined after N attempts and never touches the socket again. Session health is independent of any single send. |
| M27 | Bulk `/save` had to be batched to survive **Cloudflare's 524 timeout** — M2 biting in production | commit `b0bcfc8` | Nothing long-running behind a proxy. Imports and sends are jobs with a progress endpoint; the HTTP call returns in milliseconds. |
| M28 | A Postgres **advisory lock** serialises concurrent `/save` runs — a mutex standing in for a queue | `uploads.js:12-15`, commit `43654f4` | Concurrency is the queue's job: named queues, per-org concurrency limits, idempotent jobs. No app-level global mutex. |
| M29 | Gateway has no supervisor — sessions reset to `disconnected` on every restart and need a manual `POST /sessions/{id}/start` | `README.md` Known Limitations | Sessions auto-restore from the Postgres auth store on boot, exponential-backoff reconnect, alert if a number is down > 5 min. Zero manual steps. |
| M30 | Uploads written to local disk, lost on any ephemeral filesystem | `README.md` Known Limitations | Blobs go through the storage driver from day one. No local filesystem state in `standard`+. |
| M31 | AI context bleed: `listMessages()` returns *all* of a contact's messages, not the current round's — two concurrent campaigns to one person mix contexts | `ROADMAP.md` open item | Conversation is a first-class scope. History is fetched per conversation, never per contact. |
| M32 | Reply classification is a couple of hardcoded English phrases — no Hinglish, no "call me", no manual override, no indication of which rule matched | `classifyReply()` in `whatsapp.js`; `ROADMAP.md` backlog | Configurable rules + locale packs, always with a human override, and the matched rule surfaced in the UI so "classified confidently" is distinguishable from "defaulted". |

## What the old system got right — and we keep

Not everything needs replacing. These were good calls:

- **Encryption at rest with an HMAC blind index.** `whatsapp_contact.phone_hmac` allows
  lookup without decryption. The right pattern; we keep it and add key versioning (M24).
- **Webhook HMAC verified over the *raw* body**, length-checked before `timingSafeEqual`
  (`whatsapp.js:338-341`). Correct, including the subtle part — verifying over a
  re-serialised JSON object would silently fail.
- **Status scoped per outreach round, not one lifetime field on the contact.** Re-contacting
  someone months later for a different reason isn't blocked. Generalised here as
  conversations + campaign membership.
- **`last_message_at` maintained by a DB trigger**, so it cannot drift from application code.
- **A partial unique index closing the check-then-insert race** (`outreach_round_open_job_uidx`,
  `db.js:141`) rather than trusting a read-then-write. Right instinct: constraints as backstops.
- **Structured JSON logs with a per-request correlation id**, and one choke point logging
  every outbound API call. Good bones; we fix the timestamps (M25) and add trace propagation.
- **`DATABASE_URL` reworked so one compose file targets either the bundled Postgres or a
  managed one** (commit `f9fd751`). Exactly the right instinct — `18-providers.md`
  generalises it to every resource.
