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

### 2026-10-21 (afternoon and evening) — The "AI speedrun": an AI assistant that runs chats and campaigns; tutorial PDF; a WhatsApp session breakage
- **Merged #84 to #93** (all AI PRs are titled `ai-speedrun:` so they can be searched; Kushal's rule): contacts page (#84), import page notice,
  finished imports clear, wider wizard (#85), the model layer **`@crm/llm`** (#86), AI settings, consent and a bot user (#87, migration 0031),
  **auto-reply** on chats assigned to the assistant (#88), anti-ban warnings in the thread with an admin do-not-contact override (#89),
  **campaign tools** and Write with AI (#90, migration 0032), click feedback and a faster layout (#91), `send_message` (#92), and the **AI request
  queue** with its panel, spinner and Cancel, `npm run dev:fast` and the **tutorial PDF** (#93, a `[checkpoint]`, migration 0033).
- **Merged #94** (`npm run llm:check`: compares models for speed, steadiness and tool calling) and **#95** (the lead-the-conversation prompt and the docs below). **#96 merged too** (resend hook, non-text reply, `send_message` name fix, D-59 priority, handoff).
- **The assistant now runs on Groq** (`openai/gpt-oss-20b`, 0.5 to 0.9 s a call) instead of Gemini (8 to 30 s, one 503): `LLM_DRIVER=compatible` with
  `LLM_BASE_URL=https://api.groq.com/openai/v1`. The Gemini key is kept in `.env` as `GEMINI_API_KEY`; both keys live only in the git-ignored `.env`.
- **Proven live on his real linked number** (`kushal_test`, to the other dev's number): the assistant opened a chat, answered the replies within
  a second, and the sent/delivered/read ticks came back. Before that the first live tries failed (below).
- **Prompt change (this PR):** "no guardrails for now, make it just work" (Kushal). The assistant now **leads** the conversation (answer, then one
  question toward the goal written in its instructions) and hands over only when asked or when the goal is done, with a summary. A "never invent
  facts, hand over if unsure" rule was written and **removed** at his request. Seen: it invented "2 to 5 years of experience" and a document list.
  Guardrails are pinned as **D-81**; leading whole conversations (goal field, auto-assign, follow-ups) as **D-84**.
- **Docs:** `docs/CRM-user-tutorial.pdf` (31 pages, real screenshots with numbered markers; rebuild with `npm run tutorial:shots -- <dir>` then
  `npm run tutorial:pdf -- <dir>`); F12 rewritten as built; API (`/ai/*`, `PATCH /campaigns/:id`), providers (LLM drivers and a measured comparison),
  runbook **RB-13**, codebase map, pins D-4 and D-42 updated and D-81 to D-84 added.
- **Found and pinned:** **D-82** a gateway restart can break the WhatsApp session. After many restarts (every saved edit restarts the gateway under
  `tsx watch`) the saved encryption sessions diverged: 213 decrypt failures, nothing received from 15:17 to 17:03, those messages are not in the
  CRM. Deleting one contact's sessions fixed sending only; **unlink and relink fixed it** (RB-13). **D-83** `dev:fast` (production build) leaves some
  screens stale after an action (6 browser specs fail there, all pass on `next dev`).
- **Tests:** unit `packages/providers/llm` 13, config +3; integration `ai-settings` 6, `ai-auto-reply` 10, `ai-notices` 7, `ai-commands` 17,
  `ai-queue` 9; browser `ai-assistant`, `ai-notice`, `import-notice-and-reset`. The whole browser suite passed on `next dev` (CI), six specs fail on `dev:fast`.
- **Next PR (retry fix and non-text reply):** the other dev's phone showed "Waiting for this message" on two of the assistant's replies. Cause: the gateway had no
  `getMessage` for Baileys, so when his phone asked us to resend, the log said `recv retry request, but message not available` and it never cleared. Fixed:
  `sentMessageText` (core) gives back the text of a message we sent, the Baileys provider passes it to Baileys, the gateway wires it up (text only; media is not
  resent). And a photo, voice note or file no longer gets silence: the assistant says once "I can only read text messages here, could you type that out?"
  (no model call; not repeated within 10 minutes; do-not-contact and the daily limit still apply). **Priority (Kushal): D-59, file support in campaigns first.**
- **Found after the restart for that fix:** the health scorer put `kushal_test` into **quarantine with a 48-hour soft-ban pause** (risk 100: a decrypt-failure burst after the restart, and
  delivery 5 of 11 because messages his phone could not decrypt count as undelivered). False signals from our own session trouble (D-82), but the pause held every send. **Kushal turned Advisory
  mode on for the number at 17:47** (anti-ban enforcement off for that number); after it, sends go out (`advisory mode: sending past an anti-ban hold`). **It is still on: switch it back when testing ends.**
- **Live bug found on Groq:** told "message Test Phone Two", `gpt-oss-20b` passed the number's id as the contact, so nothing was sent. Fixed in the tool text and instructions ("a NAME, never an id") with a test;
  re-run live, the message went out and was delivered (#96).
- **End of session:** the tutorial PDF was rebuilt (the assistant now asks for text on a photo, leads the conversation, and has no fact-checking yet). The dev stack was brought down; the handoff has the exact bring-up and live-test steps.
- **Mistakes to learn from:** I wrote the stack's output into `.dev-logs/`, which the stack's own script tails: a feedback loop made two logs
  1.1 GB and 345 MB and slowed his whole machine (moved the output elsewhere, deleted them); I appended a line to `.env` without a trailing newline
  and it glued onto the API key (fixed at once; always end the file's last line first); I restarted the gateway too often (D-82).
- **Created for the screenshots:** an org **"Demo Co"** (`demo-tutorial`, admin `demo@example.test`) with invented people in his dev database;
  `npm run local:seed -- --reset` removes the seeded rows (with `TEST_ORG_SLUG=demo-tutorial`), not the org.

### 2026-10-21 — Import wizard (D-21) built as previewed; branches tidied; handoff (#83 open)
- **Open #83:** the Match columns step is divided into sections with several phone columns (tried in order, a person with two
  numbers keeps both), first and last name joined as written (never shortened; a one-letter first name becomes `a.sharma`),
  personal-looking columns marked and protected, a scrolling columns box, bigger text, a preview of the chosen columns. Typecheck,
  lint and the unit and integration suites pass locally (`imports.test.ts` 32 tests); **the browser tests and a phone-width look
  are not run yet**.
- **Process:** previewed the design as mockups first (three rounds of changes by Kushal), as he asked for D-21.
- **Housekeeping:** deleted 22 old branches locally and 21 on the remote (kept `main` and the last three); `git worktree prune`.
- **Handoff written** (`HANDOFF.md`: standing rules, the full session, ask-him-first list; this ledger).

### 2026-10-19 to 2026-10-20 — Alpha feedback fixed, files in chat, number access planned, docs for signup and billing
- **Merged #54 to #82** (see `HANDOFF.md` for the table). Highlights: import keeps chosen columns as searchable contact fields (#56),
  "Upload anyway" for a repeated file (#57), **files in chat rounds 1 and 2** (types, dropped message kinds, failed-download reasons,
  safe image previews with `sharp`; migration 0030) (#60, #61), the whole **alpha-feedback list** from the other dev (#73 to #76, #80),
  newsletters and broadcast lists ignored (#81), and the **"Status at a glance"** table for the pins (#82).
- **Docs added:** 32 (setup, signup, teams, billing plan: invite-only beta, admin-created teammates, other products' flows, CRM and
  WhatsApp-tool prices, a placeholder price list), 33 (payment providers compared; recommendation: manual invoicing then Razorpay),
  34 (licensing and enforcement: proprietary licence, signed offline key, hosted by us). **No implementation until the alpha test ends.**
- **`@lid` investigation** on a real linked number: the mapping works when WhatsApp includes the number; contacts events carry no pair;
  newsletters leaked in (fixed in #81); `pushName` unused (optional, pinned).
- **New pins:** D-67 (decisions), D-69 (job-portal plug-in and pluggable front end), D-70, D-71, D-72, D-73, D-74 (built), D-75, D-76,
  D-77, D-78 (email); D-66 extended; priorities re-sorted three times (parked, work now, research first, pinned).
- **CI:** the e2e job was suspended then re-enabled (#61, #62); GitHub billing blocked every job; Kushal made the repo **public** to
  use free minutes; `CONTRIBUTING.md` says where checks run. Resource logs for every local run are in `verify-footprint.log`.
- **Mistakes to learn from:** stopped his running stack mid-import (never stop it without asking); two pins pushed just after he
  merged and so missed `main` (verify after "merged").
- **Test counts:** vitest 740 passed, 1 skipped (58 files) at #80; browser suite 32 tests on CI at #80.

### 2026-10-17 (end of day) — Team fix, Linked numbers, the new look (#53 open)
- **Merged:** #50 handoff, #51 market research moved to `docs/03`, #52 (admin may demote themselves while another admin
  remains; **Numbers renamed Linked numbers**; D-66 pinned).
- **Open #53:** direction A look (Inter, light/dark), animated sign-in with the lead scene (org + CRM, accept/decline/grey,
  clipboard service, cash stack and arrow), **front-end-only sign-up page**, Overview greeting/checklist/count-up, skeletons,
  signed-in label. First CI run: 25/26 browser tests green (the red one was a bug in the new sign-up test, fixed since).
- **Found:** the browser tests that fail on a loaded laptop (`bulk-tag-flow`, seeded inbox, `zz-roles-flow`) pass on CI.
- **Process:** CI runs typecheck, lint, vitest, the browser suite and the simulation; locally only the browser automation,
  when asked. New handoff procedure in `HANDOFF.md`.

### 2026-10-17 — Import fixes, Team tab, Add a number, banner, number fallback merged; VM test; look not done
- **Merged to `main`:** #46 import usability, #47 Team tab + Add a number + Security key button + Campaigns rename + phone
  recorded after linking, #48 `ENVIRONMENT_BANNER`, #49 number fallback (D-60, migration 0029). Details in `HANDOFF.md`.
- **Real-install test on a 2-core / 4 GB VM** (deleted afterwards): alpha container up, number linked from a
  datacenter IP, imports, Team and Numbers screens exercised, resource log kept. Findings: login needs HTTPS
  (Secure cookie), build peaks at 1.45 GB / 98% CPU for about 3 minutes, idle about 1 GB used. Unfixed bugs pinned as **D-65**.
- **Not done:** the visual refresh (local branch `feat/ui-look`, unpushed, unseen by Kushal); a full `verify` on `main`
  after the merges (started, stopped by Kushal); two browser failures on #47's run never reproduced.
- **Process:** local stacks and `verify` lag his laptop (load up to 66); do not start them without asking.

### 2026-10-16 (end of session) — Handoff, codebase map, database portability pinned
- **#43 and #44 merged and confirmed on `main`**; the full check passes there (701 tests, 1 skipped without an S3
  endpoint).
- **`docs/31-codebase-map.md`**: every directory and file in the repository (420 files) and what it is for, built from
  each file's own header comment with hand-written folder descriptions. `STRUCTURE.md` points to it.
- **Pinned D-64: database portability.** Asked whether the code is Postgres-only and whether the database-side logic
  could move into the app so SQLite would work. It is Postgres-only on purpose: 24 row-level-security policies and
  the role switch behind tenant isolation, `LISTEN`/`NOTIFY` with 1 function and 3 triggers, `SKIP LOCKED`, `jsonb`,
  arrays and raw SQL in 41 files. Moving it is a re-architecture, not a refactor; D-64 holds the measured inventory
  and the shape a portable layer would take, and D-20 now points to it.
- **Handoff:** the fallback branch can now get its PR (it was waiting on #43); first steps listed in `HANDOFF.md`.

### 2026-10-16 — Number fallback (D-60); lighter web tier and single executable pinned (D-61, D-62)
- **Built D-60:** for a contact with more than one phone number, the gateway asks WhatsApp (Baileys `onWhatsApp`, one
  lookup per number, cached 30 days if it has an account and 7 if not) before the first send and messages the first
  number that has an account, promoting it to primary and writing a `contact.number_switched` audit row. None has one:
  the message fails `no_whatsapp_number`. Unknown (lookup failed): the primary is kept. One-number contacts make no
  lookup. `SEND_VERIFY_FALLBACK_NUMBERS`, default on. Migration 0029 adds `wa_registered` and `wa_checked_at` to
  `contact_identity`. Tested with the fake channel only, **not on a real number**.
- **Pinned D-61** (plain React with refresh buttons instead of Next on most pages) and **D-62** (single executable),
  with what is in the way. Neither is started.

### 2026-10-16 — Handoff; local file storage confirmed as the existing barebones version
- **Checked the codebase and the deferred list for storage:** it already exists on `main` as the port plus a
  **local filesystem driver** (`./storage`, `/app/storage` in the container), wired end to end: inbound files stored
  by the gateway, outbound attachments, magic-byte typing, per-org sha256 dedup, authenticated attachment-only
  serving, audited reads (D-11, D-25). `main` had **no S3 or MinIO driver** (the factory threw "not implemented").
  #44 adds only that driver and the layout decision; nothing was duplicated.
- `HANDOFF.md` rewritten for 2026-10-16: merge order of #43 and #44, the unmerged fallback branch, the dev
  database at migration 0029, the environment problems, and the questions to ask first.

### 2026-10-16 — S3-compatible file storage alongside local (D-63); file layout decided (D-59)
- **Built D-63:** `STORAGE_DRIVER=s3` (or `minio`) now builds an S3-compatible `StorageDriver`
  (`packages/providers/storage/s3`) for AWS S3, Cloudflare R2, Backblaze B2 or MinIO. **Default stays
  `filesystem`.** Missing bucket or credentials stop the app at boot, never a silent fall back to disk. The shared
  contract suite (25 tests) passes against it using an S3 emulator (moto), which CI now runs as a service
  container; MinIO's images could no longer be pulled. Not tested on a real R2, B2 or AWS bucket. **Switching an
  existing install does not move its files** (no copy job yet).
- **Decided D-59:** chat files get a virtual per-chat folder (a Files tab built from the database), not a physical
  directory per chat, because it keeps per-org dedup and survives contact merges. D-11 now says to decide
  encryption at rest before pointing a real deployment at a bucket.
### 2026-10-16 — Import screen: columns chosen by their values, and a "rows to fix" box
- On upload the server scores every column by what its first 200 values look like and suggests the phone, email
  and name columns; the panel pre-selects them, shows how phone-like the chosen column is, and warns on a poor
  pick. After Preview or Import, a box lists rows that could not be imported (sheet row, value as typed, reason)
  and rows that lost a number. `GET /imports/:id` returns `warnings`; the summary has a `warnings` count.

### 2026-10-16 — Importer reads cells with several phone numbers; `NA` is blank
- A phone cell may hold several numbers (`98…, +91…`, as in 36% of a real Naukri sample): each valid, distinct
  number is imported as a phone identity on one contact, the first as primary. A bare `+91` is ignored; one good
  number is never lost to a bad neighbour; a cell with nothing usable still fails the row. `NA`, `N/A`, `-` and
  similar whole-cell markers count as blank. Tests added (unit and import integration).

### 2026-10-16 — Priorities reshuffled; sample headers for the import wizard (docs and a fixture)
- **D-19 templates withdrawn from the priority list** (Kushal); the entry now says how much templates matter for
  anti-ban: not a protection on the Baileys path (spintax and the identical-body cap already cover that signal),
  required on the Meta path.
- **D-59 file support in chat** added as a priority, with what exists, what is rough and what is missing. It
  records that web uploads over 1 MB failed until #39.
- **D-21:** a real Naukri recruiter export arrived (82 columns, 160 rows); its header row and an aggregate analysis
  are in the fixture and D-21, with no row values stored. **36% of its phone cells hold two numbers**
  (`9XXXXXXXXX, +...`), which the current normaliser rejects; `NA` stands for blank. Nine other public header sets
  are in the same fixture. Also found: a split first/last name keeps only the first name.

### 2026-10-15 — Alpha container, and hardening for a Cloudflare tunnel
- **Alpha container (#37, #38):** one image runs the API, gateway and web UI; compose adds Postgres. On first
  start it generates its secrets once, migrates, and creates a first admin; no `.env` needed. Works with
  `docker compose` v1 and v2 (`infra/scripts/compose.sh`). Full `verify` passed on it.
- **Cloudflare tunnel:** researched and written up in `docs/30-cloudflare-tunnel.md`. An optional
  `cloudflared` compose service (`npm run alpha:tunnel`, `TUNNEL_TOKEN`) routes only the web port.
- **Fixed:** imports and attachments over 1 MB failed in the web UI (Next.js server actions cap bodies at 1 MB);
  now `bodySizeLimit: 25mb`. The client's address is now passed to the API (`CF-Connecting-IP`), so audit rows
  stop recording 127.0.0.1.
- **Pinned D-57:** run the import commit as a background job (the 524 ceiling is about 40,000 rows).
- **Contacts page size, and the `bulk-tag-flow` e2e failure.** Each row rendered a `<select>` of every tag, so the
  page grew as people x tags (5.7 MB and about 10 s in `next dev` at 50 people and 129 tags), which is what pushed
  the spec past its 10 s limit. Now one shared `<datalist>`; the row input is resolved by tag name in the action.
  Spec passed 3 of 3 against the dev database. Production render was about 0.8 s even before.
- **Cleaned the dev database's e2e leftovers** (e2e-test org only): 74 `E2E` campaigns, 109 `e2e-` tags, 96 import
  runs, 6 custom fields and 4 contacts that existed only because of them. The real number's data and `Live
  broadcast` campaigns were not touched.
- **Docs:** cheapest 4 GB option per provider added to `docs/29` (section 1b); **D-58** pins Kushal's public-site
  checklist.
- Found while testing: a PR merged before its last commits were pushed, and a stale local `main`. See the
  handoff gotchas; check `git log origin/main` for the code after every merge.

### 2026-10-14 — Handoff; logging and telemetry documented; free hosting plan (docs only)
- **`docs/28-logging-and-telemetry.md`**: what is logged and where it goes, redaction, the request id, how to read
  it, health endpoints, the database state that doubles as a record, troubleshooting recipes, what is missing.
  Telemetry beyond logs is pinned as **D-56**; logging is enough for now.
- **`docs/29-free-hosting-plan.md`**: free and cheap hosting for about 10 users and 10 numbers. Decision
  (2026-10-14): **cloud only**. No free always-on host of 2 GB or more needs neither a card nor a first-time
  account; recommended is a 4 GB VPS paid by UPI after a 72-hour datacenter-IP test. Recorded on **D-33**.
- **D-23 (inbox search)** now records Kushal's decision: **date-range-scoped, decrypt-and-scan, no plaintext
  copy**, with the measurement (100,000 messages in ~0.8 s), the research, and the open decisions (presets, a
  ceiling, caching including empty results and overlapping ranges, substring, notes, audit). **Not built.**
- **D-55 (licence enforcement)** kept pinned, to be revisited last.

### 2026-10-13 — Key rotation, D-31 (#35)
- **Key ring** in `LocalKms`: `ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY`, `ENCRYPTION_KEYS_PREVIOUS`
  (`<version>:<hex>,…`). Decrypt picks the key named in each value's envelope; encrypt always uses the current
  one. Malformed rings fail at boot; a missing key says which version and how to add it.
- **Background re-encryption** (`packages/core/src/key-rotation.ts`, `sweepKeyRotation` in the gateway sweep):
  `message.body_enc` and `channel_auth_state.value_enc`, a batch per org per sweep, compare-and-swap, an unreadable
  row is counted and skipped; pausable (`key_rotation_state`, migration 0027), restart-safe.
- **Startup guard:** the API and the gateway refuse to start if the data holds a key version the ring cannot read.
- **`npm run keys -- status | generate`** prints rather than edits; the **Security page** (`/security`, admin only)
  is the five-step wizard with progress, pause/resume and a verify sample. Migration 0028 adds the safe
  `envelope_key_version()` function and its indexes. Audit rows for pause, resume and verify.
- Found by running it for real on a throwaway database: the sweep had not been wired into the gateway loop, and a
  bare `get_byte()` index threw on a value shorter than 2 bytes. Both fixed and tested.
- **Not built:** per-org data keys and crypto-shredding (still D-31); `ENCRYPTION_INDEX_KEY` deliberately does not
  rotate. The pause switch is instance-wide (any org admin).

### 2026-10-13 — The gateway runs inside each org's tenant, D-41 (#34)
- `apps/gateway/src/tenant.ts`: a handle where every statement drops to `crm_app` and sets `app.org_id`. Sweeps list
  org ids with one privileged query and fan out per org; work that starts from an id looks up its org first;
  startup resolves the tenant role like the API. The whole gateway suite now runs as `crm_app`.
- `tests/integration/gateway-tenancy.test.ts`: a message in org A whose conversation points at org B's number is not
  sent (with the role removed it goes out through B's number).
- **Still open:** the Baileys credential store (`channel_auth_state`) is accessed by the provider with only a
  sender id, outside this handle (encrypted, keyed by sender, not tenant-scoped).
- Three e2e specs made re-runnable (seeded inbox participants, broadcast cancel, bulk tag). **D-55 pinned.**

### 2026-10-13 — Held messages released on time, and a double-send race fixed (#33)
- A message held by a pacing, contact-graph or recovery gate is retried when the gate says it clears, not at the next
  60 s sweep; per-minute and per-hour retry times come from the oldest send in the window.
- **Found while doing it:** `handleSend` could run twice for one message (NOTIFY, sweep, retry), each sleeping a
  jittered pause then sending: the same message went out 3 times in a test. Now guarded per message.
- **Caught by the CI simulation:** parallel retries each passed the allowance check before any had sent and overshot
  the daily ceiling (601 against 600). Send decisions are now **serialised per number**.

### 2026-10-12/13 — Typing indicator and the send-anyway warning, D-54 (#32)
- See D-54 on the deferred list. Presence/typing/viewers polling moved from server actions to a route handler
  (`/inbox/[id]/live`) because Next serialises server actions and the polling starved the person's own Send.
  Migration 0026. Tests: typing-collision (11), and the roles pipeline now exercises both through the real composer.

### 2026-10-12 — Two-role pipeline (#31), schema visualizer (#30), fake gateway fixes (#29)
- **`npm run test:roles`** (and `test:roles:live`, headed, real number to `LIVE_SEND_TO`): an admin and an agent on
  one chat checked from both sides: authorship, presence both ways, the lock, five admin-only refusals,
  do-not-contact, participants, hand-over. File is `zz-roles-flow.spec.ts` so it runs last.
- **`npm run db:docs`** writes `docs/generated/schema.html`: a table diagram, per-table columns, keys, indexes,
  policies, triggers and a plain-English purpose from `packages/db/src/table-notes.ts` (a test fails if a table has
  none). 27 tables, 57 foreign keys, 24 policies, 3 triggers, 1 function at the time.
- **Fixture fixes:** the fake channel never reported "delivered", so after 10 sends in a day the scorer put the
  healthy seed number in a 48-hour soft-ban pause; a number that never received a reply is clamped to 20 sends a day;
  `send-flow` could only pass ~20 times per database (14-day cooldown on a 20-number pool). All fixed.

### 2026-10-11/12 — Authorship (#26), owner + participants (#27), presence (#28), D-53/D-17 first slices
- Every outbound message records its author; `conversation_participant` (admin-only add/remove, may reply, counts
  under Mine); `conversation_presence` heartbeat with a "viewing" line. Migrations 0024, 0025.

### 2026-10-10 — Live headed walkthrough (branch `test/live-headed-suite`)
- **`npm run test:live`** (`playwright.live.config.ts`, `tests/live/`): a visible, slowed-down Chromium run of the whole
  product against a running stack and a *real* linked number — sign in → link a number on screen if none is
  connected → import a synthetic Naukri-style `.xlsx` → one message to your own phone, then a reply typed in the
  inbox → mass-tag + hand-tag → broadcast to three numbers → sign out. Recipient numbers come from `.env`
  (`LIVE_SEND_TO`, `LIVE_BROADCAST_TO`), never the repo. `LIVE_OVERRIDE_GATES=1` re-runs inside the 14-day cooldown.
- The UI still has no "start a new conversation" button, so the first message goes via `POST /messages`.
- **D-21 (mapping wizard) raised to priority.**

### 2026-10-11 — Handoff, and a throttle fix for `verify`
- `HANDOFF.md` rewritten for pickup: read-everything-then-ask protocol for a new session, a handoff protocol for
  the outgoing one (which files to update), pending list, dev-environment state.
- `scripts/verify.sh`: the throwaway stack sets `NEW_CONTACTS_PER_HOUR=100` / `NEW_CONTACTS_PER_DAY=500` / `NEW_CONTACT_REPLY_FLOOR=false` (the reply floor otherwise holds a number that nobody has replied to at 5 new people a day). Repeated
  runs exhausted the seeded number's stranger allowance (5 an hour) and `send-flow` stayed `queued` with hold
  reason `paced:new_contact_throttle`, which is the engine working as designed, not a defect.
- Ban-suspected banner and pause re-landed (it was merged into a stacked branch and missed `main`).
- `send-flow` no longer asserts a contact name (the fiction range is small, so a number can be a reused contact).
- Full `verify` on `main` after #20–#22: migrations, check, web typecheck, simulation (444 s), scripted flow, seed
  all passed; the browser suite failed only on that throttle.

### 2026-10-11 — Ban-suspected banner and automatic pause
- A close with code **403** (WhatsApp refusing the number) now records one critical `forbidden_suspected` event
  (not repeated within 30 minutes) and **pauses the number's running campaigns** (`pause_reason = ban_suspected`).
  An unrequested 401 logout pauses them too. Nothing resumes on its own.
- The Numbers page shows a banner with three steps (open WhatsApp on the phone, look for a ban notice, relink only
  if there is none), shown until the number has connected again or three days pass. The campaign page says why it
  was paused. 2 new tests.

### 2026-10-11 — Link flow fixes and readable link errors (branch `fix/link-flow-and-errors`)
Found by running the live walkthrough against a real number, which stuck on "waiting for QR" for ten minutes.
- **Stale credentials:** after a logout from the phone the gateway kept the dead credentials and every re-link
  retried a login WhatsApp refused, so no QR ever came. They are now cleared on the logout (and before a link on a
  number that is not connected; never for a live one).
- **Link request flag:** a completed or failed link left `link_requested_at` set, so the sweep re-requested a link
  every minute and disturbed a live session. It is cleared on connect and on failure.
- **Wrong card:** the in-memory test channel ("fake") showed a Link button; it now says "nothing to link". The live
  suite targets its own sender's card.
- **Ban-suspected spam:** one `hard_ban_suspected` event per logout (not per failed re-login, nor within 30 minutes).
- **Readable errors:** a failed link is classified (`qr_timeout`, `stale_session`, `connection_closed`,
  `rate_limited`, `needs_phone`, `gateway_error`, `unknown`) with a title, one-line summary and next step, stored in
  `link_error` as JSON (legacy strings still decode), returned by `GET /senders/:id/link` as `state: "error"` and on
  `GET /senders`, and shown in the link panel and as a banner on the number's card. A close while waiting for a QR now
  fails at once instead of after the timeout, and the half-open socket is torn down.
- 10 new tests; 610 vitest.

### 2026-10-10 — UI test suite and the fake gateway (branch `test/ui-suite-and-fake-gateway`)
- **`npm run local:seed`** (`scripts/local-seed.ts`): into the `e2e-test` org, a fake connected number, 20 contacts,
  3 tags, a custom field, 3 conversations (unread · assigned · closed) and a saved audience. Fixed names,
  idempotent, `--reset`, local-database only.
- **`GATEWAY_CHANNEL=fake`**: the gateway runs the in-memory fake channel (connects `provider='fake'` senders),
  refused when `NODE_ENV=production`. `GATEWAY_SWEEP_SECONDS` makes the safety-net sweep configurable (default 60).
- **Specs:** `seeded-pages` (inbox filters/notes/resolve, contacts search, import preview, numbers, saved audiences) and
  `send-flow` (a started broadcast is really delivered through the engine on the fake number). CI's `e2e` job seeds and
  starts the fake gateway. Manual checklist in `docs/24-local-testing.md`.
- **Fixed:** the fake channel's message ids restarted at `fake-msg-1` on every gateway boot and hit the unique
  provider-id index, failing the send. 3 new config tests.
- **Pinned D-46:** the UI lags when used fast; measure on a production build first (Kushal's idea of plain React
  for non-live pages is the last step, not the first).
- Docs: the "To do" list below is brought current; test counts corrected.

### 2026-10-10 — Documentation refresh
- `HANDOFF.md` brought current end to end (build table, what works, what does not exist, honest risk,
  known defects, what is next); `docs/15-api.md` (new endpoints), `05-data-model.md` (migrations
  0016–0023), `24-local-testing.md` (`local:flow`, sample CSV, browser tests), `12-testing.md`,
  `21-deferred.md` (D-45 built, D-28 note), `README.md` (index + `27`); the printable PDF includes
  `27-restriction-tracking.md` (it was missing from the build manifest).

### 2026-10-10 — Silent-restriction tracking (#8, merged) and segments inside campaigns (#9, open)
- **#8 Silent restriction.** WhatsApp does not announce a restriction; the detector (`restriction.ts`) infers
  it from our own delivery records: stuck-at-sent ratio vs the number's baseline, median delivery time,
  whether people who normally reply are affected, whether only strangers are (reachout-timelock shape),
  inbound silence. Two independent signals → `suspected` (sending slowed ×3); a broad pattern → `likely`
  (soft-ban recovery + that number's running campaigns paused, `pause_reason`). Rises at once, falls slowly,
  one step at a time. Timeline in `sender_health_event`; surfaced as a Numbers banner + timeline, a sidebar
  count badge, a composer warning, "sent · no delivery for 3h", and "paused automatically" on the campaign.
  Found and fixed on the way: close code / reconnect count never written (dead score weights), delivery ERROR
  ack dropped, unrequested logout now `hard_ban_suspected`, sweep throttle stalled on a backwards clock.
  Simulation moved to `.github/workflows/simulation.yml` + three scenarios. Docs: `27-restriction-tracking.md`.
  Migration 0022. 597 vitest, 9 Playwright.
- **#9 Segments → campaigns.** The audience step offers tag / import / saved audience / **Build a filter** with a
  live count and "save for reuse"; a one-off filter is a hidden segment (`segment.saved`, migration 0023).
  "Segments" leaves the sidebar; the page is **Saved audiences**. 599 vitest, 10 Playwright.

### 2026-10-10 — UI overhaul, LID linking, mass tagging, CI fix (#3–#7, merged)
- **#7 UI overhaul** (after #5's restyle): Overview dashboard at `/`, structured Contacts, three-panel inbox
  (day separators + contact side panel), grouped Broadcast list, campaign page with progress meter and sticky
  message preview, three-step new-campaign form, Numbers cards with a risk meter, import step header,
  split-screen login. e2e specs scoped to the sidebar and updated for collapsed panels.
- **#6 LID → phone.** The Baileys adapter reads `key.senderPn` / `chats.phoneNumberShare`; the gateway links a
  privacy address to its phone before storing; `linkLidToPhone` adds the identity or merges two contacts
  (threads, notes, tags, recipients, import rows, custom fields; do-not-contact kept; audited).
- **#3 Mass tagging.** `POST /tags/:id/bulk` (all [admin] / search / segment / ids; preview-first, expectedCount
  guard, audited), tag-at-import, `GET /contacts/count`, Contacts bulk bar, `tests/fixtures/import-contacts.csv`,
  browser flow import → mass tag → hand tag → broadcast.
- **#4** secrets-scan job gets `pull-requests: read`.

### 2026-10-09 — PR workflow, do-not-contact enforcement (#1, #2, merged)
- **#1** every change is a PR (`scripts/open-pr.sh`); pins D-42 (AI takeover), D-43 (alert channels), D-44
  (Baileys 7), D-45 (LID).
- **#2 Do-not-contact was not enforced on any send path** (only segments honoured it, nothing could set it).
  Now enforced on messages, files, campaign recipients and the gateway's last-line check, with `dnc` as a
  fourth overridable gate: a signed-in admin can override per message or per campaign, with a reason, audited;
  agents, API keys and advisory mode cannot. `PUT /contacts/:id/do-not-contact` + UI toggle. Migration 0021.

### 2026-10-07 — Local walkthrough scripts
- `npm run local:flow` (`--keep` / `--reset`) and the browser `broadcast-flow` spec; no real sends.

### 2026-10-07 — Local walkthrough scripts
- **`npm run local:flow`** (`scripts/local-flow.ts`): local-only end-to-end walkthrough — real login route →
  5 contacts → draft a broadcast → dry-run preview → start → real gateway sweep against the fake number →
  per-recipient results, exits non-zero on a mismatch. `--keep` / `--reset`. Refuses a non-local database.
- **`tests/e2e/broadcast-flow.spec.ts`**: the same flow in the browser (UI create from a tag → Start → Cancel).
  Nothing can send: the number it creates is never linked. 7 Playwright tests total.
- Confirmed there is no signup page (accounts come from `npm run admin`).

### 2026-10-06 — Gates, advisory mode, status line, custom fields
- **Recipient-experience gates** (`policy-gates.ts`): engagement lock (owned thread active in 48 h),
  cooldown (another campaign within 14 d), duplicate-campaign. A blocked recipient is `skipped` with
  `engaged` / `cooldown` / `in_other_campaign`. An admin lifts them per campaign at start
  (`overrideGates` + a ≥10-char reason, audited as `campaign.gates_overridden`); never the number-protecting
  limits. Broadcast page: "Start with overrides…" (admin) and a banner on overridden campaigns.
- **Advisory mode (D-29)**, per number: `POST /senders/:id/enforcement` (admin, reason, audited). Lets a number
  past quarantine / recovery pause / pacing / new-contact throttle / recipient hours / identical-body cap,
  counting each bypass; DNC, consent and a dead socket stay hard. Persistent red banner on the Numbers page.
- **Number status line:** `GET /conversations/:id/sender-status`, a `senderStatusAction` server action, the
  composer polls it and locks reply mode (notes still allowed) when the number can't send; header shows
  connected / quarantined / not connected. `message.hold_reason` records why a queued message waits and the
  thread shows "waiting: …".
- **Custom fields:** `custom_field` table (text/number/date/select), admin-defined; values validated on write
  (`PUT /contacts/:id/custom-fields`, contact create); contact UI; `{{key}}` in campaign bodies. Migrations 0019
  and 0020. Follow-ups pinned (D-40).
- Pins: D-31 priority, D-37..D-39 (Meta), D-40, D-41 (gateway outside RLS, priority). `CONTEXT.md` deleted.
  Fresh docs PDF in the repo root (gitignored). 556 vitest, 7 Playwright, 6 simulation scenarios.

### 2026-10-06 — Contact export, CORS allowlist, CI fixed
- **Admin contact export.** `GET /contacts/export?format=csv|vcf`: admin-only (agents and API keys 403),
  keyset-streamed, audited (`contacts.exported`), 5 per hour (429 `EXPORT_RATE_LIMITED`). CSV has a BOM
  for Excel and defuses `= + - @` formula cells (phone lists left alone); vCard 3.0 for loading onto a
  phone, with tags / DNC in `NOTE`. Web: export links on `/contacts` via `contacts/export/route.ts`.
  Excel and vCard *import* are pinned (D-30..D-36).
- **CORS allowlist.** `CORS_ALLOWED_ORIGINS` (comma list of exact origins; no wildcard, no paths).
  Listed origins get headers and a pre-auth preflight answer; never credentials. Browser-only concept —
  server-to-server callers (JobPortal backend) need nothing.
- **CI repaired.** Found by reading the Actions API: `.gitignore` `storage/` hid `packages/providers/storage`
  (now `/storage/`); `check` job given throwaway config for the migration runner; gitleaks told the
  throwaway keys are intentional. e2e + check green (incl. `test:sim`); the secrets-scan fix (`41c4cd7`)
  awaiting its run result.
- Docs PDF script (`npm run docs:pdf`). Standing rule: docs untouched unless asked. **541 vitest.**

### 2026-10-05 — The anti-ban simulation harness (and two bugs it found)
- **`npm run test:sim`** (`tests/simulation/*.sim.ts`, `vitest.sim.config.ts`, a CI step on `main`):
  the real gateway engine against `SimulatedWhatsApp`, a virtual WhatsApp that scores every send on the
  documented ban heuristics and bans at risk 100 (downgrades deliveries at 60). Simulated time (faked
  JS `Date` + a `simclock.now()` `search_path` shim visible only to the sim's own connections),
  simulated people (delivery/reply rates). A **negative control** proves the sim can ban. Scenarios:
  day-1 blast (strangers / known contacts), warmed long campaign (ceilings, no night sends, timing
  spread), reconnect-then-backlog, low-reply-ratio spiral. Scaled down to run in ~4 min.
- **Bug 1 (fixed): false soft-ban on a healthy number.** Sends younger than a receipt could exist were
  counted as undelivered, so the first burst of any campaign read as a delivery collapse and opened a
  48 h soft-ban recovery pause. `RECEIPT_GRACE_MS` (15 min) now keeps fresh sends out of the ratio.
- **Bug 2 (fixed): backlog flood after reconnect.** A queue built while the socket was down drained at
  8/min the moment it returned (32 sends in 5 min). For `RECONNECT_RAMP_MS` (10 min) after a (re)connect
  the per-minute ceiling is held at 3 (12 sends in 5 min in the sim). `last_connected_at` feeds it; no
  migration. `WorkContext.sweepBatchSize` added so the sim can run a small batch.
- 2 new pacing tests; health tests aged past the grace. **532 vitest** (+ 6 simulation scenarios).

### 2026-10-05 — D-25 outbound media (sending files)
- **Agents can send a file.** `POST /conversations/:id/attachments` (raw body, `?filename=&caption=`,
  16 MB cap) → type decided from the bytes (images/video/audio/PDF/ZIP-Office; HTML/SVG/unknown refused
  415) → `storeOutboundMedia` (core; random key, per-org sha256 dedup, inside the tenant tx) → a queued
  message with `media_id` + caption, under the thread lock and `messages:send`. The gateway reads the
  file from storage (`WorkContext.storage`) and sends it via `OutboundContent.freeform.media`; Baileys
  `toBaileysContent` maps images/video/audio natively, the rest as a named document. Web: 📎 button in
  the composer. Same anti-ban pacing as any send. No migration.
- **Fixed a latent bug found on the way:** an over-limit body (an upload past 20 MB, JSON past 1 MB)
  came back as `500 INTERNAL_ERROR`; the error boundary now answers body-parser 4xx errors as 413 /
  400. 10 new tests → **530**.
- Not built: >16 MB documents, voice notes, media in campaigns, media templates (D-19).

### 2026-10-05 — Anti-ban #8 (recipient-timezone inference) — the completion pass is done
- **#8 of 8 — respect the recipient's day (Layer 3 circadian).** `timezoneForPhone` (`@crm/core`, a
  ~60-country table over a new `phoneCountry` in `@crm/shared`) infers a recipient's zone from their
  number. In `handleSend`, after the sender's own circadian gate: a send landing in the recipient's
  small hours is left queued, one in their shoulders is slowed. Only adds caution; phone recipients
  only; same-zone and unknown-country traffic untouched; independent of server location (the
  sender's day is the explicit `SEND_TIMEZONE`). `SEND_RECIPIENT_TIMEZONE` (default on). No migration.
  Writing the test caught that +44 7911… is Guernsey (`GG`), so GG/JE/IM now map to London.
  6 new tests → **520**. **All 8 anti-ban refinements are done.**

### 2026-10-05 — Anti-ban #7 (background entropy)
- **#7 of 8 — idle-time presence noise (Layer 3).** New optional `ChannelProvider.presence` (Baileys
  `sendPresenceUpdate`, fake records `presenceCalls`) and `runEntropyEvent`/`sweepEntropy` in the
  gateway: per connected number every 2–6 h, active hours only, an abandoned 3–8 s "typing…" to a
  contact who has replied (never a stranger) plus a 30–120 s available→unavailable blip. Pure
  `EntropyScheduler`/`entropyPlan` in `@crm/core`; events run detached and best-effort.
  `SEND_BACKGROUND_ENTROPY` (default on). No migration. 9 new tests → **514**.

### 2026-10-05 — Anti-ban #6 (read behaviour)
- **#6 of 8 — human-like read receipts (Layer 3).** New `ChannelProvider.markRead` (optional;
  Baileys `readMessages`, fake records `readCalls`). `sweepReadReceipts` (gateway, every sweep) blue-
  ticks an inbound message only after its own 10–60 min delay (`readDelayMs`, deterministic from the
  message id), only in active hours, never past 24 h, max 3/sender/sweep. `read_at` on an inbound
  message = "receipt sent", set only after the provider confirms. `SEND_READ_RECEIPTS` (default on).
  No migration. 7 new tests → **505**.

### 2026-10-05 — Anti-ban #5 (decrypt-failure signal)
- **#5 of 8 — 3 `Bad MAC` in 60 s degrades the sender (Layer 5).** Baileys drops undecryptable
  frames before `messages.upsert`, so the adapter now taps its logger (`decrypt-tap.ts`, covers child
  loggers, best-effort) and reports each one via `onDecryptFailure`. The gateway's
  `DecryptFailureTracker` (`@crm/core`) trips on the 3rd inside 60 s and writes
  `channel_session.decrypt_burst_at` (migration 0018); `computeRiskScore` adds +60 while it is under
  15 min old → high band → degraded, then recovers by time with no manual clear. 7 new tests → **498**.

### 2026-10-05 — Anti-ban #4 (reply-ratio floor) + printable docs
- **#4 of 8 — reply-ratio floor (Layer 4).** The new-contact daily cap (20) is now earned: it applies
  only once ≥10 new contacts from the last 7 days (48 h grace to reply) exist and ≥30 % replied;
  until then 5/day. `newContactDailyAllowance` + `DEFAULT_REPLY_FLOOR` in `contact-graph.ts`,
  evidence computed in the same SQL as the existing throttle (no migration). Opt-in per
  `ContactGraphLimits.replyFloor`, wired by `NEW_CONTACT_REPLY_FLOOR` (default true). Never throttles
  known/contacted recipients. 6 new tests → **491 vitest**.
- **`npm run docs:pdf`** builds `build/whatsapp-crm-docs.pdf` (gitignored): HANDOFF + CHANGELOG +
  GETTING_STARTED + all of `docs/`, with a cover, contents and a section index, both with page
  numbers (`scripts/docs-pdf.mjs`, `marked` dev dependency). eslint ignores `scripts/*.mjs`.

### 2026-09-30 — Anti-ban #3 (delivery→speed curve) + CI runs the full test set
- **#3 of 8 — continuous delivery→speed curve (Layer 5).** New `deliveryDelayMultiplier` in
  `@crm/core` scales the inter-send delay by the delivery ratio — ×1 at ≥85 %, ×4 below 55 %, linear
  between — applied in `handleSend` from the sender's `health.deliveryRatio`. Replaces the blunt
  "degraded = half speed"; a degraded sender is still held to at least half speed whatever its
  delivery (it may be degraded for failures/disconnects, not delivery). 1 unit test.
- **GitHub Actions now runs everything** (`.github/workflows/ci.yml`). The `check` job was fixed —
  it migrated the test DB *after* running tests and pointed at the wrong database, so the
  integration suite never really ran in CI; now it uses a `dev`-superuser Postgres on 5434 (so the
  vitest default connection and the `crm_app` role both work), migrates the test DB **before**
  `npm test`, and re-checks migration idempotency. A new **`e2e` job** installs Chromium, migrates,
  provisions the `e2e-test` admin, starts the API + web, and runs `npm run test:e2e`.
- **CI can't be validated from here** — it runs on the next push/PR; watch the first run.

### 2026-09-30 — Anti-ban completion #2: identical-body guard (D-26 backstop)
**#2 of 8.** The dispatcher now **refuses more than N identical bodies in a window** — the half of
D-26 that was left open.
- A sender holds at most `IDENTICAL_BODY_DAILY_CAP` (new config, default 50) messages with the same
  `body_hmac` per rolling 24h; `dispatchCampaign` leaves the excess **pending** (never failed). The
  per-body count is cached in the loop, so a no-variation batch costs one query, not one per
  recipient. Moot when spintax/`{{name}}` vary the body — it only brakes a no-variation blast.
- Threaded via `WorkContext.limits.identicalBodyCap` (absent = no cap, so existing tests/behaviour
  are unchanged) from `IDENTICAL_BODY_DAILY_CAP`.
- 1 test: a flat body to 8 recipients queues 3 (cap 3) with 5 pending; a `{{name}}` body to the same
  8 queues all 8 (distinct bodies, never capped). D-26 is now complete (both halves).

### 2026-09-30 — Anti-ban completion #1: outbound-only daily clamp (Layer 1)
Working through the remaining anti-ban backlog one by one. **#1 of 8 done.**
- A sender that has **never received an inbound** (`last_inbound_at IS NULL`) is now clamped to
  **20 sends/day regardless of warmup day** — outbound-only is a top ban pattern. Built in
  `dailyCeiling` as `OUTBOUND_ONLY_DAILY_CAP`; it only lowers the ceiling and lifts automatically on
  the first inbound.
- Enforced at the send chokepoint (`handleSend`) and in campaign dispatch, and fed into the campaign
  **forecast** (all three sender-limit queries now carry `last_inbound_at`), so "this will take
  forever" shows up before launch. A caller that omits `lastInboundAt` skips the clamp, so the whole
  pre-existing pacing path — and the test suite — is unchanged.
- 5 tests (4 unit on `dailyCeiling`: clamp / lift / backward-compat / never-raises; 1 integration:
  dispatch holds a never-replied sender to 20 then lifts to the rest once it gets an inbound).
- Remaining backlog (HANDOFF): #2 identical-body guard · #3 continuous delivery→speed curve ·
  #6 read behaviour · #7 background entropy ·
  #8 recipient-timezone inference.

### 2026-09-30 — Playwright E2E + a segments-UI bug found by driving the app
- **Added browser end-to-end tests (Playwright).** `@playwright/test` (dev dep) + Chromium,
  `playwright.config.ts` (loads `TEST_EMAIL`/`TEST_PASSWORD` from `.env` without a dotenv dep;
  `webServer` reuses a running stack), and specs under `tests/e2e/` (`*.spec.ts`, so vitest's
  `*.test.ts` and Playwright never grab each other's files). `npm run test:e2e`. Coverage: wrong
  password refused; sign-in → sign-out drops the session (a protected page then bounces); every main
  page renders; and **build-a-segment → preview-count → save**, which guards the bug below. **4 e2e
  tests, all green** (478 vitest tests unchanged).
- **Fixed: the Segments "Preview count" button did nothing.** The builder `<form>` used a *function*
  server action, so React intercepted every submit and swallowed the button's `formMethod="get"`
  override — the GET never fired and no count showed. Fixed by making the form a plain GET form and
  moving the server action onto the Save button via `formAction={createSegmentAction}` (and dropping
  `required` from the name field so Preview works before naming). Found by driving the app in a
  browser end to end; verified fixed there and by the new e2e regression test.
- **Walkthrough (login → inbox → contacts → tags → segments → campaign create/start/pause →
  logout) passed** against a throwaway `e2e-test` org. Other findings are in `HANDOFF.md`
  (the dev hydration-overlay cause of "can't see anything", a plural-copy nit, no add-one-contact UI).
- Reverted the earlier root `suppressHydrationWarning` change at Kushal's request (see HANDOFF for
  why it is likely still wanted).

### 2026-09-30 — D-28 dynamic segments (minimal slice)
- A **saved, criteria-based audience** that re-evaluates every time it's used — unlike a tag (a
  fixed list). New `segment` table (migration `0017`, RLS forced) storing an allowlisted
  `definition`; `@crm/core` `segments.ts` turns it into a **bound** SQL predicate.
- **The JSON-to-SQL seam is closed by construction:** only known keys emit SQL, every value is a
  bound parameter, unknown keys contribute nothing, and the API's `.strict()` zod rejects them with
  a 422. Criteria this slice: **has-tag**, **replied ever/never**, **last-contacted-within-N-days**,
  AND-combined; `do_not_contact` and soft-deleted contacts always excluded.
- `GET/POST/DELETE /segments` + `POST /segments/preview` (live count). Campaigns gain a fourth
  targeting mode `from_segment_id`, resolved and **frozen** in `snapshotAudience`/`previewAudience`
  like every other audience.
- **Web:** a `/segments` page (nav tab added; Broadcast's stale `soon` flag removed) — a builder
  (tag / reply / recency) with a live "N match" count via a GET preview + a Save server action, and
  a list with per-segment counts + delete. The new-campaign form can target a segment.
- 13 new tests: filter correctness (tag/replied/recency/AND/empty), injection-safety (unknown key →
  422, non-uuid → 422, valid-but-unknown id → 0 not error), CRUD + live count, and campaign
  freeze-at-launch. **478 total.** Typecheck, lint, suite and `web:build` green.
- **Deliberately not built** ("a CRM, not a query language"): custom-field equals, AND/OR grouping,
  nested trees — add only on a concrete need.

### 2026-09-29 — D-26 campaign body variation (spintax + {{name}}); D-29 pinned
- A campaign no longer sends byte-identical text. New `@crm/core` module `body-variation.ts` —
  `renderBody(template, vars)` resolves **spintax** (`{Hi|Hey|Hello}`, nested, inside-out) first on
  the operator template, then fills **variables** (`{{name}}` / `{{contact.name}}`). Spintax-first
  is deliberate: the contact's value goes in last, so an odd display name (a stray `{` or `|`)
  cannot corrupt the parse — at the cost of not supporting a variable *inside* a spintax option.
- `dispatchCampaign` renders each recipient's copy (joining the contact for its name) before
  encrypting, so 500 sends are 500 different strings. Both campaign compose UIs (new-campaign form,
  contacts-page panel) hint at the syntax.
- **Still open (the smaller half of D-26):** the dispatcher's "refuse >N identical bodies in a
  window" guard — moot when spintax is used, unbuilt for a no-variation body.
- 7 new tests (spintax pick/nest/none, variable fill, spintax-before-vars safety, per-recipient
  variance, end-to-end dispatch decrypting three rendered messages) — **465 total.** Typecheck,
  lint, suite and `web:build` green.
- **Pinned D-29 — anti-ban advisory mode** (warn-but-don't-enforce override). Recorded, not built:
  it is the code path the design deliberately omits, so it needs careful scoping (`do_not_contact`
  and consent stay hard even in advisory mode, admin-only, audited, loud UI).

### 2026-09-29 — P6 recovery orchestration (Layer 6): the anti-ban engine is complete
- Beyond the health scorer's both-ways *status* recovery, a typed incident now starts a **timed**
  response: **463** timelock → 24 h pause, resume at 10 % of cap, +15 %/week; **429** rate overlimit
  → 4 h, 25 %, +25 %/week; **delivery-collapse soft ban** → 48 h, 5 %, +10 %/week. A 401 hard ban
  stays on the unlink→re-link path (indistinguishable from a user unlink at the socket).
- **Schema:** migration `0016` adds three `sender_identity` columns (`recovery_incident`,
  `recovery_started_at`, `recovery_until`). New `@crm/core` module `recovery.ts` — `recoveryState`
  (pure: phase + cap fraction from the columns + fixed schedule) and `beginRecovery` (the one writer,
  guarded so a storm of the same signal never resets the pause).
- **Enforcement:** the pause is a full hold at the `handleSend` chokepoint (message left queued,
  never failed); the ramp is a `recoveryCapFraction` handed to the pacing gate, which can only lower
  the daily ceiling (never below 1 — the pause is the full stop). Detection wired where the signals
  already surface: 463/429 in `applyConnectionEvent`, soft ban in the health sweep.
- **UI:** `GET /senders` derives the recovery phase/fraction server-side (raw columns hidden); the
  Numbers page shows a per-number at-risk / cooling-off banner (pause + resume time, the reduced-cap
  ramp, or a plain degraded/quarantined reason) — the frontend warning that was asked for.
- 11 new tests (recovery-state phases/ramp/clear, ceiling scaling, send-path hold, 463 opens a
  recovery, the no-reset guard, soft-ban open, senders derivation) — **458 total.** Typecheck, lint,
  suite and `web:build` green. **All six anti-ban layers are now built.**

### 2026-09-29 — Broadcast UI: the last two targeting modes (import + hand-pick)
- **Target a whole import.** New `GET /imports` lists committed, non-superseded runs with a
  `contactCount` (distinct people created/updated); the new-campaign form now offers an **audience
  by tag OR by import** (two selects, pick one — the create action enforces exactly one).
- **Hand-pick specific contacts.** The **Contacts page** grew a checkbox per row (disabled for
  do-not-contact people) and a "Campaign from checked contacts" panel (name, message, number) that
  creates a draft with `explicitContactIds` and jumps to it. Checkboxes belong to the panel's form
  by the HTML `form=` attribute, so no nested-form is needed (rows already carry tag forms). Tags
  remain the better tool for a *reusable* audience; this is for an ad-hoc "these people, now".
- Web: `crm.ts` gains `listImportRuns` + `ImportRun`; `createCampaignFromSelectionAction` on the
  contacts page; the create action accepts tag or import.
- 2 API tests for the imports list (committed-only with counts; superseded hidden) — **447 total.**
  Root + web typecheck, lint, full suite and `web:build` green. UI not eye-verified signed-in.
- **The Broadcast UI is now feature-complete for the alpha:** create (by tag / import / hand-pick)
  → dry-run preview → start/pause/resume/cancel → per-recipient results. D-26 body variation is
  the remaining compose-step enhancement, pinned separately.

### 2026-09-29 — Broadcast UI: pre-start dry-run preview (F5 AC-1)
- A draft's page now shows a **dry run** before you commit: "would message N people · K skipped
  (no number) · T in the audience", plus the forecast — computed **without writing** a single
  `campaign_recipient` row. If nobody in the audience has a number, it says so in red rather than
  letting you start a send to no one.
- **New endpoint** `GET /campaigns/:id/preview` + core `previewAudience()`, which runs the *same*
  audience rule as `snapshotAudience` (import run / explicit list / tag) as a COUNT split by
  reachability — so the preview can't drift from what start actually freezes (a test asserts
  `preview.reachable === progress.pending` after start).
- Web: the draft detail page fetches the preview (one extra round trip, drafts only) and renders it
  in place of the all-zero progress tiles; `crm.ts` gains `previewCampaign` + `CampaignPreview`.
- 3 API tests (counts-without-freezing, matches-what-start-freezes, 404) — **445 total.**

### 2026-09-29 — Broadcast UI, slice 2: create a campaign, and operate it
- **Create a campaign from the browser** at `/broadcast/new`: name, message, sender, and an
  **audience by tag**. Creating makes a draft (sends nothing); the detail page then carries
  **Start / Pause / Resume / Cancel** controls (server actions over the existing endpoints), and
  starting freezes the audience and shows the forecast + per-recipient results.
- **New targeting mode `from_tag_id`** — migration `0015` adds a nullable FK from `campaign` to
  `tag`; `snapshotAudience` resolves it like an import run, so tagging a contact *after* launch never
  changes a running audience. `POST /campaigns` now takes exactly one of `fromImportRunId` /
  `explicitContactIds` / `fromTagId` (422 otherwise, 404 for an unknown tag).
- **Web:** `/broadcast/new` form (sender + tag pickers with contact counts, empty-state guidance),
  a "New campaign" button on the list, and start/pause/cancel controls on the detail page — all
  server actions, no client JS. New `crm.ts` functions: `createCampaign`, `startCampaign`,
  `pauseCampaign`, `cancelCampaign`.
- 4 API tests (freeze-the-tagged, post-launch-tag-ignored, unknown-tag-404, exactly-one-of-three
  audiences) — **442 total.** Root + web typecheck, lint, full suite and `web:build` all green.
  Not yet eye-verified in a signed-in browser.
- **Still to add:** import-run and hand-picked-contacts targeting in the UI (both in the API), and
  a pre-start dry-run preview.

### 2026-09-29 — Broadcast UI, slice 1: campaigns list + per-recipient results
- The **Broadcast** tab was a `ComingSoon` placeholder whose warning was **false** ("no rate
  limiting anywhere in the send path" — the whole anti-ban engine exists). Replaced with a real,
  read-only page; the false warning is gone.
- **New endpoint** `GET /api/v1/campaigns/:id/recipients` — the per-recipient results (F5 AC-5).
  `?status=` (pending/queued/sent/failed/skipped) and `?q=` (name or number, `ILIKE`), keyset
  paginated on the row id (no timestamp column on `campaign_recipient`, so no migration). Joins the
  contact for a name and the message for its delivery state. 404 for an unknown campaign, never a
  silent empty list.
- **Web:** `/broadcast` lists campaigns (name, status badge, when); `/broadcast/[id]` shows progress
  tiles that double as status filters, the forecast, the message body, and the recipients table
  (status badge + skip reason + delivery state, name/number search). Server-rendered, no client JS;
  the status-badge helper lives in its own module (Next forbids arbitrary exports from a `page.tsx`).
- **crm.ts** gained `Campaign`/`CampaignDetail`/`CampaignRecipient` types and
  `listCampaigns`/`getCampaign`/`listCampaignRecipients`.
- 5 API tests (list-all/none-absent, status filter, name+number search, delivery-status reflection,
  404) — **438 total.** Root + web typecheck, lint, full suite and `web:build` all green. Not yet
  eye-verified in a signed-in browser (needs the dev account password).
- **Next slices:** 2 = create → target → forecast → start; 3 = pause/resume/cancel controls.

### 2026-09-29 — Typing simulation (P6 anti-ban layer 3, D-24)
- Before each send, the gateway now shows a `composing` "typing…" presence, pauses a beat
  proportional to the message length, then clears it with `paused` — so a send looks human rather
  than instant (an instant send is a documented bot tell).
- **New pure helper** `typingDelayMs(bodyLength)` in `@crm/core` (`packages/core/src/typing.ts`):
  Gaussian on the per-character rate, clamped **0.7–8 s**. Deliberately a **compressed** beat, not
  literal 45-WPM typing time — a 30-second bubble before every send would stall the paced queue for
  no anti-ban gain.
- **Port change:** `ChannelProvider` gained an optional `typing(sender, to, state)`. Implemented by
  the **Baileys** adapter (`sendPresenceUpdate`) and the **fake** (records calls so tests can assert
  `composing` fired before the send). Best-effort at the `handleSend` chokepoint — a failed presence
  is swallowed and never fails the send.
- **Config:** `SEND_TYPING_SIMULATION` (default `true`), wired into the gateway context; opt-in like
  circadian and the contact-graph gate, so the 427 existing tests are unaffected.
- 6 new tests (3 unit: delay bounds, length-monotonic, not-a-fixed-interval; 3 in the send path:
  composing-before-send, off-by-default, send-survives-a-presence-throw) — **433 total.** Typecheck +
  lint + full suite green.
- **P6 now has one piece left:** per-incident recovery orchestration (Layer 6 timed
  pause/resume/ramp schedules), which ships next with a frontend at-risk warning.

### 2026-09-29 — Housekeeping: nuked the `[TEST DATA]` fixtures and the stray Insomnia export
- **Deleted the `[TEST DATA]` dev-DB fixtures** (safe since D-14 closed and media is proven against
  a real file): the `test_fixture` contact, its conversation, two messages, two `[TEST]` media
  assets, and the stub blobs + `.meta` sidecars under `storage/`. Removed in FK order in one
  transaction; the only media file left is the genuine D-14 JPEG (`0c764e48-…`, 49,408 bytes).
- **Removed the committed Insomnia workspace export** `whatsapp-crm (local)-wrk_*.yaml` from the
  repo root (it was tracked, not untracked as the handoff had said) and added a `.gitignore` rule
  so per-workspace exports can't be committed again — the curated collection stays at
  `tools/insomnia-collection.json`. Commit `288c361`.

### 2026-09-29 — Handoff refresh for a fresh chat + issue logged
- Brought `HANDOFF.md`, `CHANGELOG.md` (this by-phase section) and — at Kushal's request —
  `CONTEXT.md` (a consolidated session-026 catch-up entry; the log had been paused since 025)
  current: build state, counts (427 tests, 15 migrations), what works, recent work.
- **Issue logged** (`HANDOFF.md` Known defects): **campaigns have no UI** — the Broadcast tab is a
  `ComingSoon` placeholder, so a built feature is invisible, and its warning ("no rate limiting
  anywhere in the send path") is now false since the whole anti-ban engine exists. Flagged while
  Kushal was checking out the build.

### 2026-09-29 — Tags: label contacts and filter by them
- New `tag` + `contact_tag` tables (migration `0014`, RLS forced, granted to `crm_app`;
  `contact_tag` carries `org_id` like every tenant table so RLS scopes it directly, composite PK
  `(contact_id, tag_id)` makes re-tagging a no-op).
- **API:** `GET/POST /tags` and `DELETE /tags/:id` (name unique per org → 409 `TAG_EXISTS`;
  list carries a `contactCount`); `POST /contacts/:id/tags` + `DELETE /contacts/:id/tags/:tagId`
  (idempotent attach; a tag or contact from another org is a 404, not a foreign-key 500). The
  contacts list now returns each contact's `tags` and accepts **`?tag=<id>`** to filter to a label.
- **UI:** the Contacts page grew a tag **filter bar** (with counts), a **new-tag** form, tag
  **chips** on each contact (click to remove), and an **add-tag** picker — all server-rendered via
  server actions, no client JS.
- 9 new API tests (create/dup/list/delete, idempotent attach, filter, detach, cascade-on-delete,
  cross-org 404) — **427 total**. Eye-verified against the real dev DB (tag created, attached,
  filtered, rendered on the page). This + contact search is how an operator finds and labels
  specific people to hand-pick a campaign audience.

### 2026-09-29 — Contact list + search (find people in the book)
- **`GET /api/v1/contacts`** (`contacts:read`) — lists contacts newest-first and searches by a
  case-insensitive substring across the **display name and any identity** (phone/email). Contact
  fields aren't encrypted, so it's a plain `ILIKE` — no blind index, no design decision (the
  encrypted message-body search of D-23 stays the separate, harder half). Keyset-paginated on
  `created_at`; returns each contact with its identities and `do_not_contact`.
- **New `/contacts` web page** + a **Contacts** nav tab: a server-rendered search box (a plain GET
  form, no client JS) and a list showing name, phone/email, source, and a "do not contact" badge.
  This is what lets an operator *find* specific imported people (to hand-pick a campaign audience).
- 6 new API tests (search by name/phone/email, empty-on-no-match, per-org isolation) — **418
  total**. Eye-verified against the real dev DB: lists the actual contacts, `?q=919035` narrows to
  one. First slice; per-page cursor and richer filters come with tags/segments.

### 2026-09-29 — Build queue refined: contact search + tags + per-recipient results greenlit
- **Building now** (P2–P7 core, greenlit by Kushal): **contact list + search** (browse/search
  imported contacts by name/phone — contact fields aren't encrypted, so no design decision),
  **tags** (`tag` + `contact_tag`), and a **searchable per-recipient results** view for campaigns
  (the data already sits on `campaign_recipient`). Together these cover "find specific imported
  people → tag → hand-pick an audience → see what the campaign did".
- **D-28 reduced** from "tags & segments" to just **dynamic segments ("segregation")** and marked
  *later* — tags + contact search + explicit id lists + whole-import targeting cover the near-term
  need, so only the criteria-based filter engine stays parked.
- **D-23** (chat/message-body search) stays pinned — do something simpler first (contact-field
  search, which is being built, is the simple half). **D-19** templates stay pinned + priority.

### 2026-09-29 — Near-term priority queue set
- Flagged **PRIORITY** (near-term build queue, not "someday"): **D-25** outbound media, **D-19**
  templates, **D-26** body variation (ships with templates), **D-23** inbox search (settle
  blind-index vs. trigram first; contact-field search can ship without it), and **tags + segments**
  now pinned as **D-28** (campaign targeting; the four-slice build). Tags/segments is **not** an
  anti-ban dependency (P6 is complete), so it is scheduled per-slice on Kushal's go-ahead.

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
- Contacts: `POST /contacts` (create), `GET /contacts` (list + search by name/phone/email), and
  **tags** (`tag`/`contact_tag`, attach/detach, `?tag=` filter) with a Contacts web page.
- ❌ Custom-field definitions, segments (dynamic), pipelines, consent records (optional).

### P3 · Channels — ✅
- Baileys adapter: link by QR **or** pairing code, send, receive, delivery receipts, auto-reconnect.
- Credentials encrypted in Postgres — sessions survive a restart.
- Gateway as its own process, commanded through a durable table + `NOTIFY`.
- HTTP API for conversations/messages/senders; web UI (sign-in, inbox list/thread/composer, link
  screen with live QR + countdown, light/dark).

### P4 · Inbox — ⚠️ partial
- ✅ Conversation list, thread view, composer; message bodies encrypted at rest.
- ✅ Assignment, status, list filters; internal notes; canned replies; thread lock; mark-read /
  open-any-thread; **attachments render in the thread** (web `/media/:id` proxy).
- ✅ **Authorship** (who sent each message), **owner + participants** (admin-managed, may reply), **presence**
  ("viewing"), **typing indicator** and the **send-anyway collision warning** (D-17, D-53, D-54).
- ❌ Search (pinned **D-23**; design decided 2026-10-13: date-range-scoped decrypt-and-scan), snooze/Meta-window/
  keyboard (**D-18**).

### P5 · Ingestion — ✅ first slice
- CSV **and Excel (.xlsx)** import: upload → dry run → commit. Content-hash dedup; partial unique
  index + `?force=true` re-import supersedes; per-row ledger, phone normalisation, sparse guard;
  a web Import tab with simple column mapping.
- ❌ Google Sheets, REST puller, webhook source, schedules, full mapping wizard (**D-21**).

### P6 · Anti-ban — ✅ complete
- ✅ All six layers, enforced at the one send chokepoint: warmup ramp, per-minute/hour/day ceilings,
  Gaussian jitter; circadian pacing (the sender's day **and**, via `timezoneForPhone`, the recipient's);
  contact-graph gates with the reply-ratio floor; health scoring (both directions, receipt grace,
  decrypt-failure signal); timed recovery; reconnect easing; outbound-only clamp; identical-body guard;
  delivery→speed curve. Human behaviour: typing simulation, delayed read receipts, background presence
  noise. A **sender-health panel** and recovery banners on the Numbers page.
- ✅ **The simulation harness** (`npm run test:sim`) proves it against a virtual WhatsApp.
- ❌ Not built: the admin-overridable gates (engagement lock, cooldown, duplicate-campaign guard), a
  normalised `send_risk_event` table, Meta-side tier/quality tracking (P8), group limits, per-number proxy.

### P7 · Campaigns — ✅ alpha-complete
- Create (target by tag / import / hand-picked contacts / dynamic segment), a **dry-run preview**,
  start / pause / resume / cancel, per-recipient results, a forecast; the audience is frozen at start;
  bodies are rendered per recipient (spintax + `{{name}}`); the gateway paces them through the engine.
  A full **Broadcast UI**.
- ❌ Templates (**D-19**), scheduling and quiet hours, outbound media in a campaign, cost estimate.

### P8 · Meta Cloud API — ❌ not started

### Cross-cutting — ✅
- RLS on the request path: tenant transaction + `SET LOCAL ROLE crm_app`, proven by no-filter tests.
- **RLS in the gateway** (D-41): every gateway statement runs pinned to the owning org.
- **Key rotation** (D-31): key ring, background re-encryption, startup guard, CLI and an admin wizard.
- **Send path:** held messages released on time; send decisions serialised per number.
- Storage: `StorageDriver` port + filesystem driver + 25-test contract suite.
- Media: download, magic-byte typing, per-org sha256 dedup, unguessable keys, `GET /media/:id`
  (attachment-only headers), `mediaUnavailable` marking; read auditing (D-13).
- Small fixes: malformed UUID → 422 not 500; `problem()` no longer emits `"status": 0`; per-key
  rate limiting enforced.

---

## To do (top = next)

In the order Kushal set, remaining (2026-10-21). *Pinned* items are deliberately held:

00. **PRIORITY (Kushal, 2026-10-21): D-59, file support in campaigns first** (one image or GIF per campaign, the message as its caption; the assistant's `create_campaign` can attach an existing file).
0. **AI (2026-10-21):** (#96 is merged) Kushal's order: **D-81** guardrails (facts, STOP words, approval mode) and **D-84** (goal field,
   auto-assign new chats, follow-ups); **D-82** (flush the auth state on shutdown, detect the decrypt burst); **D-83** (stale screens on `dev:fast`). The
   assistant's chat with the other dev's number is still assigned to it on his dev stack; model choice (Groq vs Gemini vs another) is for a meeting.
1. ~~**#83** (D-21)~~ merged; the browser run and phone-width look for it were not done.
2. **D-70 Contacts page** (working on it): a refresh button, admin-chosen columns, a tidier layout, sort and search by date added
   or imported (the browser-side SQLite idea is an open question; the server-side option is a date filter and a sort parameter).
3. **D-21 remainder:** an admin-set list of personal columns, saved mappings, per-column transforms.
4. **D-67 (priority):** save the sender's own chosen name as an optional setting; the unknown-number alert is *pinned*; adding a
   number to a `@lid` chat that arrives without one waits on the Baileys 7 upgrade (D-44). Delete the newsletter contact in the dev DB (with his yes).
5. **Housekeeping to offer:** commit or ignore `dev-feedback-issues.md` and its images; tidy GitHub issues #64 to #72; a path filter so
   docs-only PRs skip CI; make the repo private again after 1 Nov (it conflicts with D-55).
6. *Parked (not working on it):* **D-8** setup wizard and first-time tutorial, **D-47** signup and billing gate, **D-52** deleting
   campaigns, **D-65** VM bugs (retest on a new VM with Claude on SSH), **D-73** quick message after an import.
7. *Pinned, research or plan first:* **D-23** inbox search, **D-55** licensing (doc 34), **D-59** file support round 3 (multi-file,
   drag-and-drop, paste, bigger uploads, voice notes, Files tab, manual Retry, images and GIFs in campaigns), **D-63** file store.
8. *Pinned:* **D-66** motion (sign-in button burst, revenue pop-up, theme toggle top right, hide the Next dev badge, loading animations),
   **D-69** job-portal chat and a pluggable front end, **D-71** background pictures per tab, **D-72** mobile UI, **D-75** number
   assignment, **D-76** notifications and requests, **D-77** admin scopes and number limits, **D-78** email (SMTP or API),
   **D-33** deployment, **D-34/37/38/39** Meta, **D-31** per-org keys, **D-44** Baileys 7, **D-48** security tests, **D-49** e2e revamp,
   **D-56** telemetry, **D-57** background import, **D-61/62/64** web tier, executable, database portability.
9. **Real-number pilot** and the **72-hour datacenter-IP test** once hosting (D-33) is chosen; a spare number is needed.

## Blockers (detail in `HANDOFF.md`)

- ~~**Inbound messages dead since 2026-09-20**~~ — **CLOSED 2026-09-28 (D-14).** Re-linked, inbound
  verified, media proven end to end against a real WhatsApp file. See *Latest*.
- **Test data in the dev DB** (`[TEST DATA - DO NOT TOUCH] …`) — D-14 is now closed, so these are
  safe to delete; still present pending the call.
- **Nowhere to deploy** (`docs/29`, D-33): no VPS is chosen; Kushal is deciding with the other developer. No free
  always-on host of 2 GB or more needs neither a card nor a first-time account (cheapest paid 4 GB options per
  provider are in `docs/29` §1b). Open: UPI for a 4 GB VPS, whether about ₹600–1,000 a month is acceptable, whether
  the old GCP account is alive, whether Hiring Studios is a real company. The alpha runs in a container
  (`npm run alpha:up`), but nothing is deployed anywhere.
