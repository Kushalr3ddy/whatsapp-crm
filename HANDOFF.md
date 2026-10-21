# Handoff — state as of 2026-10-21

A point-in-time snapshot for picking this up in a new session. For *what has been built and what
is left, in order*, read [`CHANGELOG.md`](CHANGELOG.md), the running work ledger. For *what it
is*, read [`docs/20-orientation.md`](docs/20-orientation.md), which explains the project and the
whole stack assuming no prior knowledge. (`CONTEXT.md` was deleted 2026-10-06; `HANDOFF.md` + `CHANGELOG.md` are the record.)

---

## ▶ If you are a new session, do this first

**Be the same collaborator as the last session** (the rules are in *Standing rules* just below and in the memory index you
load automatically): plain language, define jargon, never talk down; ask before building, deleting or making a scope call;
one question at a time with options and a recommendation; keep a task list (`update_plan`) and close each turn with
`wrap_up`; never offer to merge (he merges and says "merged"); never start or stop his dev stack without asking.

1. **Read, in order:** this file (especially *Latest session (2026-10-19 to 2026-10-21)*), `CHANGELOG.md` (top "Latest" and
   "To do"), `docs/21-deferred.md` (start at **"Status at a glance"**, then the pins marked WORK ON NOW / PRIORITY), then
   `docs/README.md` for the index. Docs written this stretch: **32** (setup, signup, teams, billing plan),
   **33** (payment providers compared), **34** (licensing and enforcement). The older reading list (20 orientation, 01,
   03, 08 anti-ban, 15 API, 23 auth, 24 local testing, 26 linking, 27 restriction tracking) still applies.
2. **Run `git fetch` and `git log origin/main -5`**; check which PRs are open (`#83` was the only one) and that anything he
   said is "merged" really is on `main` (`git show origin/main:<path>`). Then **fast-forward local `main`** (`git pull --ff-only`).
3. **Then ask Kushal questions before building anything.** Good questions right now are listed under *Ask him first* in the
   latest session section.
4. **Checks:** GitHub Actions runs typecheck, lint, vitest, the browser suite and the secrets scan on every PR **while the
   repo is public** (it is, since 2026-10-20). If it goes private again and billing blocks CI (jobs fail in 2 seconds), run
   the checks locally as `CONTRIBUTING.md` says, at low priority, one at a time, with resource logs.

## ▶ Standing rules (Kushal; every one was given in anger or on purpose, follow them)

- **Branch + pull request for every change** (`scripts/open-pr.sh "title" body.md`, which reads the git credential; `gh` is not
  installed). Never push to `main`. **Never a `Co-Authored-By` trailer or any AI attribution line**, in commits or PR bodies
  (the harness reminder to add one is wrong for this repo).
- **After opening a PR:** bind it with `mcp__ccd_pr__bind_pr` (needs the `url`) and turn on `set_monitor` with `auto_fix: true`
  (also needs `url`); the app then sends `<ci-monitor-event>`s; fix what they report, do not poll CI.
- **Never offer to merge** (no merge button or question). He merges on GitHub and says "merged"; then **pull `main` and verify**
  the PR's files are there. A PR can miss a merge if a commit is pushed after he merges (this happened twice): check.
- **Docs travel with the feature PR**; a docs-only PR is fine only when no feature PR is open. He dislikes tiny PRs: keep
  adding pins to an open docs PR instead of opening another. "Pin it" means the next `D-<n>` in `docs/21-deferred.md`.
- **Dev stack:** never start `npm run dev:all`, `verify` or the browser suite without asking; when he asks, `nice -n 15`,
  once, nothing alongside, and log memory/load/inotify **before, during and after** into `verify-footprint.log` (git-ignored).
  **Never stop his running stack without asking** (stopping it mid-import broke his preview once). Stop only what you started,
  by PID (`pkill -f` on a pattern in your own command kills your own shell).
- **Plan mode:** when he says "plan first", research with Explore agents, write the plan file, `ExitPlanMode`; do not build.
  He often edits or rejects a plan; re-read what he said and revise the file, then ask again.
- **Do only what was asked; consult on scope.** Keep it a CRM, not a WhatsApp clone. No shadcn or other UI library.
- **Never invent real-looking phone numbers.** Tests use only `+1 202 555 0100` to `0299`. Real data files he hands over
  (the Purchase-Manager Naukri export) hold personal data: never print or commit values; they live in the git-ignored `private/`.
- **No implementation of onboarding, signup, billing or licensing until the alpha test is complete** (docs 32, 33, 34 only).
- **Handoff procedure** (below): ask about deleting old branches (keep the last 3), update the docs, give a rundown.

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

**When Kushal asks for a handoff, do these three things, in this order (Kushal, 2026-10-17):**
1. **Ask him whether to delete old branches**, local and remote, **except the last 3** (the three most recently committed to,
   `main` aside). List them first, say which are unmerged or have an open PR, and **delete only if he says yes**. Never
   delete on your own, and never a branch that holds work that is on no remote without telling him that is what he loses.
2. **Update the changelog and the docs wherever required**: the table above, plus any doc a change made wrong (for example
   links and references when a section moves).
3. **Give a rundown of what happened in the current session**: what was asked, what was built, what is merged, what is
   open, what failed or is unverified, and the rules he gave.

Then say in the final message which PRs are open and what the next session should ask him first.

## ▶ Latest session (2026-10-21 afternoon and evening, the "AI speedrun"): read this first

*(The section below, "2026-10-19 to 2026-10-21", is older and its "state" is out of date: #83 and #84 are merged and the stack is running.)*

### State in one paragraph
`main` has everything through **#93** (the AI assistant, its queue, click feedback, the tutorial PDF, `dev:fast`). **#94** (`npm run llm:check`) is open
and this docs and prompt PR follows it. The dev stack **is running** on his machine (API :3000, web :3001 in `next dev`, gateway) with
`LLM_DRIVER=compatible` on **Groq** (`openai/gpt-oss-20b`; keys only in the git-ignored `.env`: `LLM_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`;
`LLM_TIMEOUT_MS=90000`). His real number `kushal_test` was **relinked at 17:03 IST** and works. In his `hiring-studios` org the AI is **on**, consent
accepted, and the chat with the other dev's number ("Test Phone Two") is **assigned to the assistant**, which has a recruiter script as its instructions.

### What was built (all PRs titled `ai-speedrun:`; search git history for it)
`@crm/llm` (any OpenAI-format endpoint plus Anthropic); AI settings and consent; a bot user; auto-reply on chats assigned to it; anti-ban warnings; campaign
tools; `send_message`; Write with AI; the request queue (`ai_job`); `llm:check`. Migrations **0031, 0032, 0033** (run `npm run db:migrate`; the dev script does it
on start). Design and status: `docs/06-features/F12-ai-agent.md`. Users: `docs/CRM-user-tutorial.pdf`. Pins: D-4 (built), D-42 (partly), **D-81 to D-84**.

### Decisions he made this session (do not re-ask)
- "It needs to **just work for now, guardrails later**." No fact-checking, no hand-over-when-unsure, no STOP words yet (D-81). The assistant should **take over the
  whole conversation** and lead it (D-84).
- The assistant **creates, pauses, resumes and edits campaigns** and may start them only if an org switch (off by default) allows it; it answers **only chats assigned to it**;
  per-message/per-campaign overrides only for the admin's do-not-contact; the hard anti-ban limits have no override.
- The other dev's number (+91 99641 22631) is fine to message for tests. Provider-neutral model layer; the model is **not decided** (a meeting); Groq is the working default now.
- Every commit and PR for this work starts `ai-speedrun:`. He merges PRs himself; once he explicitly said "merge it" and I merged #93 after green checks.
- Docs: a tutorial **PDF with screenshots** of the whole platform (not markdown, not AI-only).
- **File support in campaigns is back at priority** (D-59, first slice: one image or GIF with the message as its caption). Do this after the AI fixes in flight.

### The dev environment right now
- Stack **running**, started with `npm run dev:all` (output in a scratchpad file, **not** in `.dev-logs/`: see the gotcha). Web is in `next dev`; `npm run dev:fast`
  serves a production build (fast, but see D-83). A demo org **"Demo Co"** (`demo-tutorial`, `demo@example.test`) holds invented data for screenshots; its password is the default in `scripts/tutorial-shots.mjs` (local database only).
- The test database needs `npm run db:migrate:test` after pulling (0031 to 0033). Playwright reuses a running stack on :3001; it can leave servers running afterwards.

### New gotchas (paid for the hard way)
- **Never restart the gateway while testing** (D-82, RB-13). Under `tsx watch` every saved edit to a file the gateway imports (including `packages/core`) restarts it; many restarts
  diverged the saved WhatsApp encryption sessions and nothing was received for 1 h 45 m. Fix: unlink and relink. Use `bash infra/scripts/dev-up.sh --no-gateway` to restart only API and web.
- **Never redirect the stack's output into `.dev-logs/`**: `dev-up.sh` tails that folder, so it reads its own output in a loop (two logs reached 1.1 GB and 345 MB, load average 8).
- **Appending to `.env`: end the last line first** (`[ -n "$(tail -c1 .env)" ] && printf '\n' >> .env`), or the new line glues onto the last value (it glued onto the API key once).
- `Next` refuses a production build with the `.env`'s `NODE_ENV=development`; the `web:prod` script sets `NODE_ENV=production` for the build and the start only.
- A model that answers text may not call tools; check with `npm run llm:check` before choosing one. Models misreport themselves (`gpt-oss-20b` called itself "ChatGPT").
- `gh pr edit` can fail on GitHub's Projects (classic) deprecation: use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.
- The seeded browser specs leave state behind when a run fails midway (e.g. the seeded "Asha Rao" chat left *closed*); reset it before blaming code.
- **The health scorer can stamp a 48-hour soft-ban pause from false signals.** After the gateway restarts, the burst of decrypt failures and messages his phone could not read (they count
  as undelivered) took `kushal_test` to *quarantined* with `recovery_until` two days ahead, and every send is held. The clean ways out: an admin turns **Advisory mode** on for that number
  (Linked numbers, with a reason; audited), or the pause is cleared in the database the way `scripts/local-seed.ts` does for the fake number (`recovery_incident`, `recovery_started_at`,
  `recovery_until` to NULL, `status='active'`), or wait. Ask him first; it is a real number.
- **"Waiting for this message" on the other phone** means it could not decrypt what we sent and asked for a resend; the gateway now answers those for text (`resendText`). The log line to look
  for is `recv retry request, but message not available` (should now be `resending a message the recipient could not decrypt`).
- The assistant's replies are paced by the gateway (a human-like delay), so a reply can take about 20 s to leave although it was written in 1 s.

### Ask him first (next session)
1. Merge **#94** and this PR? Delete old branches (keep the last three; list them first, per the handoff rule)?
2. Model: keep Groq, or try `gemini-3.5-flash-lite`, or Groq's 120b? (`npm run llm:check -- --groq-model openai/gpt-oss-120b`.)
3. Guardrails now that the other dev has tested (D-81), and **auto-assign new chats to the assistant** (D-84)?
4. Pin or fix **D-82** (restart-safe WhatsApp sessions) before more testing? And D-83 (`dev:fast` stale screens)?
5. Keep the "Demo Co" org in his dev database, or remove it? The uncommitted notes in `docs/21-deferred.md` (D-80 and others, from earlier sessions) are still uncommitted: commit them?

## ▶ Latest session (2026-10-19 to 2026-10-21): older; superseded by the section above

### State in one paragraph
`main` has everything through **#82**. **#83 is the only open PR** (import wizard, see below) and carries this handoff.
The dev stack is **stopped**. The repo is **public** (Kushal, 2026-10-20) so GitHub Actions is free; GitHub's billing block
(about 1,802 of 2,000 free minutes used on the private repo, resets 1 Nov) showed as jobs failing in 2 seconds before that.
Local branches kept: `docs/status-tidy` (merged, #82), `fix/skip-channels-and-broadcasts` (merged, #81), `feat/import-wizard-more`
(#83), and `main`; all older branches were deleted locally and on the remote (2026-10-21, with his yes). The temporary
`diag/lid-events` diagnostics branch (shape-only logging behind `LID_DIAGNOSTICS=1`) was deleted too; to redo that investigation
re-create the logging (it logged message kinds, `senderPn`/`participantPn`/`pushName` presence, and contacts-event counts).

### PRs merged this stretch (all on `main`; #64-#72 are GitHub **issues**, not PRs)
| PR | What |
|---|---|
| #54 | Theme toggle on the sign-in and sign-up pages; `/private/` git-ignored; pin D-67 |
| #55 | `tests/live/walkthrough-recording.live.ts` (a recorded demo: sign in, link, inbox reply, tag, import, campaign, sign out) |
| #56 | **Import keeps chosen columns as custom fields** (`mapping.fields`, searchable, never overwrites); default tag named after the file; campaign page says "No one is tagged yet"; `GET /campaigns?tagId=` later |
| #57 | "Upload anyway" when the same file bytes were uploaded before (the server refuses duplicates by SHA-256; the screen had no way to force) |
| #58, #59, #62, #63 | Docs: pins D-67 to D-72 and priority marks, D-66 loading animations and UI ideas, D-8 tutorial, D-21 wider selector note; CI e2e job re-enabled (#62) |
| #60 | **Files in chat, round 1 (D-59, D-30):** Office, mov, webm, m4a, HEIC, rtf, rar, 7z recognised from bytes; stickers, shared contacts, locations and wrapped (ephemeral, view-once, caption) messages no longer dropped; HEIC sent as a file; failed inbound downloads retried 3 times and the reason saved (**migration 0030** `message.media_error`, `media_failed_at`) and shown in the thread |
| #61 | **Round 2: safe image previews** (`GET /api/v1/media/:id/thumb`, re-encoded 320 px WebP via `sharp` 0.35.5, now a direct dependency; original stays download-only) |
| #73 | Linked numbers card refreshes itself after a scan, link buttons grey out once linked, one word "Linked"; **add-number country list** (`apps/web/lib/dial-codes.ts`) |
| #74 | **Contacts tags:** selects fit, "No tag" option with a warning, tag chip shows loading and `aria-current`, campaign suggestion for a tagged group (names an existing campaign via `GET /campaigns?tagId=`), "Are you sure?" before removing a tag |
| #75 | **Import flow:** upload on choosing a file (no Upload button), row count and file name, no-rows error, clearer columns wording, trimmed preview, "View the N imported contacts" and "Message these people" after an import; run result now has `tagId` |
| #76 | After a scan works the card suggests Import and Campaigns |
| #77, #78, #79 | Docs 32 (setup/signup/teams/billing plan), 33 (payment providers), 34 (licensing/DRM); pins D-75, D-76, D-77, D-78; D-67 findings and decisions; priorities re-sorted |
| #80 | Show/Hide password on sign-in (`apps/web/app/password-input.tsx`), a server log line on every failed sign-in (reason and masked email, `routes/auth.ts`), **Add a number asks for a name only and opens its QR at once** (`/link?start=<id>`), the country list now lives in the **Type a code** method (`link/phone-field.tsx`) |
| #81 | **Newsletters, any `@broadcast` list and groups are ignored on the way in** (`isNotAPerson` in `packages/channels/baileys/src/index.ts`) |
| #82 | Docs: **"Status at a glance" table** at the top of `docs/21-deferred.md`; D-63 pinned; the CI note in `CONTRIBUTING.md` |

### Open: PR #83 (`feat/import-wizard-more`): D-21, built as Kushal previewed and approved
The Match columns step is divided into sections (file / phone columns / name and email / columns to store / preview / tag and import):
- **Several phone columns**: tick every column with numbers; numbered and tried in order; a person with two numbers keeps both
  (`mapping.identities` already allowed several phone rules). Component `PhoneColumns` in `apps/web/app/import/import-panel.tsx`.
- **Joined names** (`mapping.nameParts`, `joinName` exported from `packages/core/src/ingestion.ts`, mirrored for the preview in
  `apps/web/lib/join-name.ts`): never shortened; `Anita` + `Sharma` is `Anita Sharma`; only a first name that is already one
  letter is joined with a dot and no space (`a` + `sharma` is `a.sharma`); a blank part leaves the other as the name; the sheet's case is kept.
- **Personal columns** (`apps/web/lib/personal-columns.ts`: date of birth, pay/CTC, address, government ids, marital status, gender...)
  are marked "personal" and cannot be ticked while "Never store columns marked personal" is on.
- **Layout:** fixed-height scrolling columns box with "N of M ticked", bigger text, preview shows chosen columns and "showing N of M rows".
- **Verified locally:** typecheck (server and web), lint, `ingestion.test.ts`, `import-columns.test.ts`, `imports.test.ts` (32 tests incl. a new
  two-phone plus joined-name test). **NOT run:** the browser suite and a look at **phone width** (he asked that the layout not break the
  mobile layout later, D-72). Both need his go-ahead and the stack; the e2e specs `import-problems` and `import-flow` were rewritten and have not run.

### Decisions he made (so you do not re-ask)
- **Invite-only beta first; teammates are created by an admin** (who can reset a password and revoke access, **never delete** an account). Billing:
  manual invoicing first, then Razorpay (working recommendation in doc 33). **No implementation until the alpha test ends.**
- **Number assignment (D-75) pinned:** nobody is restricted for now (agents see all numbers and who they are assigned to); agents may add their own numbers.
  Notifications tab and number requests (D-76) and admin scopes/limits (D-77) are pinned.
- **D-67:** `@newsletter` and similar are ignored (built); the **unknown-number alert is pinned** (not small); saving the sender's own chosen name is **optional**;
  adding a number to a `@lid` chat that arrives without one waits on the Baileys 7 upgrade (D-44).
- **Parked:** D-8 (setup wizard, tutorial), D-47, D-52, D-65 (retest on a new VM with Claude on SSH), D-73, D-63 (file store), D-23, D-55, D-59.
- **WORK ON NOW:** D-21 (rest: admin-set personal list, saved mappings, per-column transforms) and **D-70** (Contacts page: refresh button, admin-chosen columns, tidier layout, sort and search by date added/imported; the browser-side SQLite idea is an open question).
- **Chip** means a small rounded label on screen (a tag name); explain it wherever the word is used.
- **Public repo for now;** consider making it private again after 1 Nov (it conflicts with D-55's "only the developers decide who uses it"; there is no licence file, so default copyright applies but forks are possible).

### What the `@lid` investigation found (D-67; one real linked number, shapes only)
`@lid` mapping **works when WhatsApp includes the sender's number** (`senderPn`): 13 of 13 real inbound `@lid` messages had it and `pushName`; that person is one contact with a phone identity and the `@lid` identity. The `contacts.update` events carry only the person's chosen name (`notify`), **no lid/number pair**, and no `phoneNumberShare` event arrived. The gap is chats where WhatsApp omits the number (not seen); a newsletter had created a contact named with a raw address (now prevented; **that contact still exists in his dev database**, delete by hand with his yes). `pushName` is on every message and is not stored (optional setting, pinned).

### The dev environment right now
- Stack **stopped**; Postgres container up on 5434 (`whatsapp-crm-dev-data` volume). He wiped the database on 2026-10-20 and started again: org **"Hiring Studios"** (slug `hiring-studios`), admin `developer@hiringstudios.com` (his own password, not recorded), a linked number with real inbound messages, an agent `mikhil_test` (`mikhil31.2002@gmail.com`), a newsletter contact and a few import tests. `.env` unchanged. The e2e user `e2e@test.local` exists only on CI's throwaway database.
- Untracked local files he has not decided on: `dev-feedback-issues.md` and `dev-feedback-images/` (Mikhil's alpha feedback; **commit or gitignore?** ask). `private/` (git-ignored) holds the Purchase-Manager sample; `mockups/` is git-ignored scratch.
- GitHub issues **#64 to #72** (alpha feedback) are done in code; #64 closed itself early (its second half landed in #76); the others are still open: offer to tidy.

### New gotchas (paid for the hard way)
- **GitHub "Failing after 2s" with annotation "recent account payments have failed or your spending limit needs to be increased" is billing, not code.** Read the check annotations through the API before debugging.
- **React empties a file input after a form action finishes**, so "Upload anyway" and the default tag name must use the `File` kept in `lastFile`/the picked file, not state read during the same event.
- `getByRole('alert')` also matches Next's hidden route announcer: find messages by text. A `<button>` inside a `<label>` becomes part of the label's name; use `htmlFor`.
- Playwright tests that import contacts must use **fresh numbers** inside `+1 202 555 0100-0299`; a number already in the database keeps its old contact (and name). Blocks in use: `import-flow` 0100-0129 and 0100-0289 (join test), `import-keep-columns` 0200-0289, `contacts-tags` 0290-n, `import-reupload` 0130.
- Typecheck and lint are not run by CI for test files the same way; an unknown ESLint rule in a disable comment (`@next/next/no-img-element`) is itself an error.
- `git push` and DNS to GitHub occasionally fail for a few seconds ("Could not resolve host"): retry. The auto-mode classifier occasionally returns "no verdict": retry once.
- A merge to `main` can miss commits pushed after he merged; when he says merged, verify with `git show origin/main:<path>`.
- Baileys 6.7.24 types lack `remoteJidAlt`; `senderPn`/`participantPn` come from the stanza; Baileys 7 (D-44) has a lid-to-number table.

### Ask him first (next session)
1. Merge **#83**? Run the **browser suite and a phone-width look** first (needs his stack stopped, about 4 minutes)?
2. `dev-feedback-issues.md` and its images: commit or ignore? Tidy GitHub issues #64-#72?
3. Add a path filter so docs-only PRs skip CI? Make the repo private again after 1 Nov?
4. Next piece: **D-70** (refresh, admin columns, layout, date sort/search) or the rest of **D-21**?
5. Delete the newsletter contact from the dev database?

### Pins at a glance (full table is at the top of `docs/21-deferred.md`)
Working: D-21, D-70. Priority: D-67. Parked: D-8, D-47, D-52, D-65, D-73. Pinned and not started: D-23, D-55, D-59 (round 3), D-63, D-66 (motion, sign-in explosion, revenue pop-up, theme at top right, hide the Next dev badge), D-69 (job-portal chat plug-in and pluggable front end), D-71, D-72 (mobile), D-75, D-76, D-77, D-78 (email), and the Meta/hosting/security pins. Built: D-11 (serving), D-13, D-14, D-17, D-24, D-25, D-26, D-29, D-41, D-45, D-53, D-54, D-60, D-68, D-74, with D-30, D-31, D-35, D-40, D-59, D-63, D-65, D-66, D-67, D-70, D-73 part built.

## ▶ End of day 2026-10-17 (older, superseded by the section above)

- **Merged since:** #50 (this handoff), #51 (market research moved from `docs/01` to `docs/03`, so the competitor
  screenshots and UI patterns now live in `03-competitive-analysis.md`), #52 (an admin may demote themselves while another
  admin remains, with the error "At least one admin must stay" otherwise; **Numbers is now called Linked numbers**; D-66
  pinned). Everything up to #52 is on `main`.
- **Open: #53** (`feat/ui-direction-a`): the **new look, direction A** (clean light, one green accent, **one font: Inter**,
  light and dark), the **animated sign-in screen with the lead scene**, a **front-end-only sign-up page** at `/signup`
  (checks the fields in the browser, then says nothing was created; the backend is still the D-47 decision), Overview
  greeting + getting-started checklist + count-up stats, loading skeletons, a signed-in label in the sidebar. **Not merged
  yet:** its first CI run had 25 of 26 browser tests green; the one red was my new sign-up test (a selector bug), fixed
  and pushed with a merge of `main`; **re-check its checks before merging**. The older local branches `feat/ui-look` and
  `feat/ui-refresh` are superseded by it and exist only locally.
- **The lead scene** (kept in `mockups/lead-scene.html`, git-ignored, plus the real component in `apps/web/app/login/lead-scene.tsx`):
  your organisation (three headset agents) + our CRM message eight people; three accept (green), two decline (red), three
  never answer (grey); a clipboard "service" is sent to the interested; cash bricks stack up beside a growing arrow. No
  currency symbol anywhere. Mockups of all four directions (A, B, C, Mix) are in `mockups/index.html`.
- **Direction chosen: A**, with Inter, a small hand-drawn icon set, no UI library, no ⌘K bar, no fake sparklines.
  **Not yet restyled one by one:** most pages only pick the look up from the shared tokens.
- **CI vs local (Kushal, 2026-10-17):** do **not** run typecheck, lint or vitest locally; **GitHub Actions runs them** (and
  the browser suite and the simulation) on every PR, and a failing PR is fixed with another commit. Locally, run **only the
  browser automation**, once, low priority, and only when he has said to. **Important finding:** on a loaded laptop
  `bulk-tag-flow`, the seeded inbox test and `zz-roles-flow` fail; on GitHub's clean machine they **pass**. They are load
  problems, not bugs; do not rerun them locally to chase them.
- **Rules added today:** inform him **before** building anything, and ask questions whenever something is unclear; the
  handoff procedure above; `mockups/` is git-ignored scratch for design choices.
- **Left over:** the mockup server (`python3 -m http.server 8123` in `mockups/`) may still be running; stop it when done.
  The VM was deleted by Kushal; nothing of it remains.

## ▶ Session 2026-10-17 (older; its "CI vs local" rule is superseded by the CI note in the first section)

**`main` now has PRs #46–#49 merged** (check each is really there: `git show origin/main:<path>`):
- **#46 import**: first valid email from a cell with several; big drop-box picker; "rows to fix" table laid out like the
  sheet with a **Download these rows (CSV)** button; progress kept across tabs (sessionStorage; a running commit is
  noted on return); pressing **Import before Preview** now says "Please click Preview first".
- **#47**: **Team tab** (admins only: list, add with a generated or chosen password shown once, change role,
  disable/enable, reset password; nobody can demote or disable themselves, never zero active admins, disabling ends
  sessions at once; API `GET /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/password`, audit rows);
  **Add a number** button on Numbers (stale `npm run` text removed from Numbers, the inbox banner and the sign-in
  page); the gateway now **records the phone a linked number belongs to** (it said "no number yet" forever);
  Security's step 1 is a **Generate a new key** button (`POST /encryption/new-key`; the current key is never shown);
  **Broadcast is now called Campaigns** (URL still `/broadcast`).
- **#48** optional `ENVIRONMENT_BANNER` line across the top of every page (empty = nothing).
- **#49 number fallback (D-60)** with **migration 0029**. Still **never run against a real number**.

**Standing rules added this session (Kushal, angry about all three; follow them):**
1. **Do not start a local app stack or `npm run verify` without asking first.** A cold `dev:all` + gateway + Next dev
   pushed his laptop to load 36–66 on 4 cores (inotify 145 of 128) and froze it more than once. When he does ask for
   a run: once, `nice -n 15`, nothing alongside it, stopped straight afterwards. `verify` logs its own footprint
   to the git-ignored `verify-footprint.log`; do the same by hand for any other run.
2. **Do only what was asked.** "Run the UI changes locally first" meant *ask*, not "build a whole restyle". He also
   did not ask for the Team tab at the start (he liked it, but it was not requested); ask before adding scope.
3. **No shadcn or other UI library** (bloat; he wants everything optimised later). For the look, copy the apps in the
   research (`docs/03-competitive-analysis.md`, images in `docs/assets/competitors/`: Wati, Interakt, Respond.io, Chatwoot,
   Pipedrive, Twenty): light grey page, white cards, light sidebar, green primary.
- Tool quirk: `pkill -f "<text that is in my own command>"` kills the very shell running it (exit 144). Use
  `pgrep -x`, a bracket pattern (`[s]ampler`), or a pid.

**The look is NOT done.** Kushal finds it "depressing" (login, overview, every page; light theme "bland").
Two commits exist **only on the local branch `feat/ui-look`, never pushed, never seen by him** (the screenshot run was
cancelled): `f12d6dc` (new colour tokens in `globals.css`: light grey page, white cards, **light sidebar**, green
primary, mint selection tint, light-green outgoing bubbles, dark variant, serif page titles via `next/font`, gentle
motion that respects reduced-motion) and `0b80b21` (animated **sign-in screen**: drifting blurred blobs, message bubbles
rising, a small inbox preview with a typing indicator, all CSS; Overview **Getting started checklist**, icons on stat
tiles, new floating empty-state illustration). Typecheck and lint pass; the browser tests were not run on it. There is
**no signup page** (backed out earlier, D-47); only sign-in. An older `feat/ui-refresh` branch (cyan/dark-teal sidebar)
is superseded; ignore it. **Ask Kushal before continuing**: show him screenshots first (one run, per rule 1).

**VM test (Linode, 2 cores / 4 GB, Ubuntu 24.04, deleted by Kushal; resource log saved at
`~/Downloads/vm-test-resource-logs/`, 4,553 samples every 5 s)** for the hosting talk (D-33):
- Idle: about 0.9–1.0 GB of 3.9 GB used with the app at 350–390 MB, Postgres 41–53 MB, Caddy 11 MB; CPU about 0%;
  swap never touched; disk 3.5 GB used after Docker and the build.
- `npm run alpha:up` build and each rebuild: about 3 minutes, memory peak 1.0–1.45 GB, CPU 98% on both cores, load 2.5.
- A real WhatsApp number **linked fine from a datacenter IP** (QR). Idle with a linked number: CPU peak 7%.
- **Login needs HTTPS**: the session cookie is `Secure`, so a plain `http://<ip>` drops it and every click asks
  to sign in again. There is no plain-http test setting; the test used Caddy `tls internal` (self-signed) with
  `PUBLIC_URL=https://<ip>`. In production it sits behind the Cloudflare tunnel, which is fine.
- The alpha container logs "connected as SUPERUSER ... tenant isolation is NOT in effect" (fine single-tenant, not for
  more than one org).

**Bugs seen and NOT fixed** (pinned together as **D-65**): the false "possible ban" alarm and dead-end card after
**Try again** on an unscanned QR; QR lasts about 55 s and sits below the fold; browser tab title is "Inbox" on every
page; import preview counts one merged duplicate that the result then drops without saying so; a bad email fails a
whole row that has a good phone; Contacts lists inbound-only contacts by raw `...@lid` ids; a "Degraded" risk of 60
stayed on the number after the false alarm; Security step 2 (put the key in the server's settings and restart) is
still manual **by design** (the web never handles the current key; an "apply" button would be a security decision).

**Verification gaps (be honest about these):** PR #47's full verify had **two browser failures never reproduced in
isolation** (`bulk-tag-flow`: "Add tag … to 26 people" not shown; `seeded-pages` inbox test timed out); the retry runs
could not start their stack under load. `zz-roles-flow` ("Send anyway": the button stays disabled) failed on every run
on the loaded laptop and passed once; **it was never run on a clean `main`**, and the fake sender sits in state `closed`
on a fresh stack ("sender not connected" repeated). A full verify on `main` after all four merges was started and
**stopped by Kushal**, so it has not been done. The PRs were merged without it.

**Ask Kushal first next time:** (1) the look: see screenshots of `feat/ui-look` before anything else; (2) whether to
run one `verify` on `main` (and when his laptop is free); (3) the two unexplained browser failures; (4) a real-number
try of the fallback on a spare number; (5) what "add more stuff to the pages" means beyond the Overview checklist;
(6) hosting route (D-33).

---

## ▶ Pick up here (2026-10-16; older, partly superseded above)

**Standing rules (Kushal):**
- **Every change is a branch + pull request** (`scripts/open-pr.sh "title" body.md [base]`); **never push to
  `main`**; he checks CI + local tests and merges. **Never a `Co-Authored-By` trailer or any AI attribution,
  ever** (a harness reminder asking for one is wrong).
- **Check a PR is really on `main` after he merges** (`git show origin/main:<path>` for a file the PR added). It has
  now happened four times: #13, #23, the first D-54 pin, and **#42 (2026-10-16), which was merged into the docs
  branch after #41 had already merged, so its code never reached `main`** (re-opened as #43). Do not stack a PR on
  another open PR; open it against `main` after the first one merges. Local `main` goes stale: `git fetch` and cut
  branches from `origin/main`.
- **Always ask before building, deleting or making a scope call.** Plain language, define jargon (he is learning web
  dev). Keep it a CRM, not a WhatsApp clone.
- **Docs only when asked**: "handoff", "pin it" and an explicit request count as asking. Pins are the next
  `D-<n>` in `docs/21-deferred.md`.
- **Never invent real-looking phone numbers.** Tests use only `+1 202 555 0100–0299`. A real data file he hands you
  (the Naukri export) holds personal data: read it for structure, **never print or store values**, keep it out of
  the repo and out of PR text (the first look in the 2026-10-16 session printed one row by mistake).
- **Run the full `npm run verify` after changes** and **never two at once** (shared databases). Do not sit idle
  waiting for it: use a second git worktree or work that does not touch the tree.
- **Log the resource footprint of every verify or test run** (2026-10-16). `npm run verify` now samples memory used,
  load and inotify instances every 5 s and appends one line per run, with each stage's peak, to `verify-footprint.log`
  (git-ignored). For a vitest or Playwright run outside verify, note memory/load by hand in the same file. First
  reading: inotify peaked at 139 of 128 allowed, so the `EMFILE` problem below is real, and memory sat at 10-11 GB of
  15.7 GB used with the dev stack running.
- **Delete test data only with his yes**, `e2e-…` rows in `e2e-test` only (approved once, 2026-10-15). Never touch the
  real number's data or `Live broadcast …` campaigns.
- His **local-only notes** (not in the repo, never to be committed): `~/everything/whatsapp-crm-db-notes.md`, about the
  databases and what was done to them.

**Merged to `main` (PRs #1–#41):** through #35 see the changelog · #36 telemetry and hosting docs · **#37 alpha
container** · **#38 it sets itself up** (secrets, migrations, first admin; works with `docker-compose` v1) · **#39
Cloudflare-tunnel hardening** (1 MB upload cap fixed, client IP forwarded, optional `cloudflared` service,
`docs/30`) · **#40 contacts page size** (fixes the `bulk-tag-flow` e2e failure) · **#41 docs**: D-59 file support in
chat (priority), D-19 templates back to deferred, D-21 real Naukri analysis, D-57 background import, D-58 site
checklist.

**Merged since the last handoff, confirmed on `main` (2026-10-16):** **#43 import** (several phone numbers per
cell, `NA` as blank, columns chosen from the values, rows-to-fix box) and **#44 S3 storage** (S3-compatible driver
next to the local one, default local; D-59 layout decision; D-63; the 2026-10-16 handoff). `main` was checked after
the merges: the new files are there and the full check passes (701 tests, 1 skipped without an S3 endpoint).

**Open, in the order to do them:**
1. **`feat/whatsapp-number-fallback` has no PR yet and now can have one** (#43 is on `main`). It carries D-60 (for a
   contact with several numbers, ask WhatsApp `onWhatsApp` before the first send and message the first number that
   has an account), migration **0029**, and pins D-61 (plain React with refresh buttons instead of Next) and D-62
   (single executable). First `git fetch`, merge `origin/main` into it (expect conflicts in `config.ts`,
   `.env.example`, `CHANGELOG.md` and the end of `docs/21-deferred.md`, where each side appended; D-63 and D-64 are
   already taken, D-60 to D-62 are its own), run the full `verify`, then open the PR against `main`. Tested with the
   fake channel only.
2. **This docs PR** (`docs/handoff-and-codebase-map`): D-64, the codebase map, this handoff. Docs only.

**Dev environment state:**
- **The dev database is at migration 0029**, ahead of `main` (0028). A checkout without that migration makes the API
  and gateway refuse to start against it. Until the fallback branch merges, either work on that branch or roll the
  two nullable columns back (`wa_registered`, `wa_checked_at` on `contact_identity`; ask first). The **test**
  database was rolled back to 0028 for the S3 branch; re-run `npm run db:migrate:all` after switching to a branch
  with 0029.
- `e2e-test` org: **Live demo number** (baileys, active) is the real linked number; Seed number is the fake one; the
  dev data was pruned 2026-10-15. Two empty `signup-org-…` orgs remain from the backed-out signup page (D-47).
- **Alpha container:** `npm run alpha:up` (compose v1 or v2 via `infra/scripts/compose.sh`), generates its own
  secrets into a `state` volume, creates a first admin (password in `npm run alpha:logs` once). Ports 3000/3001, Postgres on
  loopback 5434. `npm run alpha:tunnel` adds a Cloudflare tunnel (`TUNNEL_TOKEN`). Read `docs/30` before
  publishing it. Tested through `docker-compose` 1.29; the v2 plugin path is untested.
- Test counts: **701 on `main` (+1 skipped without an S3 endpoint)**; the fallback branch adds a few more.

**Open decisions and pending (nothing here is built unless marked):**
- **Hosting (D-33, `docs/29`)**: no VPS chosen; he is talking it over with the other developer. Cheapest 4 GB option
  per provider is in `docs/29` §1b (Hetzner about €4, an Indian VPS about ₹430–880, Azure about $16).
- **Priority list (`docs/21-deferred.md`):** **D-59 file support in chat** (priority; layout decided: virtual
  per-chat folders), **D-63 central file store** (priority; S3 driver built in #44, not tested on a real bucket),
  **D-21** wizard (phone-list fix and column scoring are in #43; still to build: several phone columns in the UI,
  first+last name joined, a column mapped to a custom field, dropping personal-data columns), **D-23 inbox search**
  (design decided, six open decisions), **D-31** per-org keys. **D-19 templates were withdrawn from the priority
  list** (the entry says how much they matter for anti-ban: not a protection on the Baileys path, required on Meta).
- **Pinned, not built:** **D-64 database portability** (the code is written for Postgres on purpose: row-level
  security, `LISTEN`/`NOTIFY`, 2 functions, 3 triggers, `SKIP LOCKED`, `jsonb`, raw SQL in 41 files; moving it into
  the app so SQLite could work is a re-architecture, inventory in D-64; relates to D-20) · D-55 licence enforcement · D-56 telemetry (an external uptime check plus a "no data" alert is
  how to be told it is down) · D-57 import commit as a background job (Cloudflare 524 ceiling about 40,000 rows) ·
  D-58 public-site checklist · D-46 UI laggy (partly explained by #40; D-61 is the larger answer) · D-47 signup ·
  D-48 OWASP tests · D-49 e2e revamp · D-50 front/back independence · D-51 deleted-message tracking · D-52 delete
  campaigns · D-27 opt-out · D-34/37/38/39 Meta adapter · D-42 AI takeover · D-43 alert channels · D-44 Baileys 7.
- **Online testing platforms** were surveyed (ZAP authenticated scan, Autorize for cross-tenant checks, Checkly or
  Uptime Kuma for synthetic flows, k6 for load, Lighthouse/Observatory/SSL Labs): not written up in `docs/`; ask if
  wanted.

**Facts worth knowing:**
- `npm run verify` stages: migrations twice, check, web typecheck, anti-ban simulation (about 10 min), scripted flow,
  seed, Playwright. `--fast`, `--no-sim`, `--no-e2e`. **Two known environment problems**: the browser stage can fail
  to start with `EMFILE` because this machine's `fs.inotify.max_user_instances` (128) is exhausted by other programs
  (workaround `WATCHPACK_POLLING=true npm run verify`; real fix is a system setting for Kushal to change); and
  `zz-roles-flow.spec.ts` ("Send anyway") fails in some full runs under that workaround and passes alone and in
  other full runs (a 15 s window; load-sensitive).
- Import: one cell may hold several numbers (36% of a real Naukri sample did); the screen suggests the phone column
  from the values; `GET /imports/:id` also returns `warnings`; the sheet row is the ledger row number plus one.
- Files: local disk under `./storage` (git-ignored; `/app/storage` in the container) unless `STORAGE_DRIVER=s3|minio`;
  **switching an install with files to S3 does not move them**.
- MinIO's images can no longer be pulled from Docker Hub or Quay; use `motoserver/moto` as the S3 test server.
- The Cloudflare 100 s timeout, upload caps, server-action origin checks and the rest are in `docs/30`; the first
  deploy through a real tunnel is untested.
- **`docs/31-codebase-map.md` explains every directory and file** (built from each file's header comment; regenerate
  rather than hand-edit). `npm run db:docs` writes the schema map; `npm run keys`, the Security page and `npm run admin` are unchanged.

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
| **Import commit is synchronous** | Runs inside the request, about 2.4 ms a row: behind Cloudflare's 100 s limit that is about 40,000 rows, then a 524 (D-57) |
| Import screen | Only one phone column can be mapped in the UI (the API accepts several); first and last name cannot be joined; personal-data columns can only be dropped by the API's `unmapped: drop` (D-21) |
| `zz-roles-flow` e2e | Timing-sensitive "Send anyway" step; fails in some full runs, passes alone |
| Number fallback (D-60) | Built and tested with the fake channel only; `onWhatsApp` has never been run against the real number, and a permanent send error does not trigger the switch |
| Files | Uploads over 1 MB failed in the web UI until #39. Still open: one file at a time, 16 MB cap, no voice notes, a failed store is invisible (D-30), nothing deletes a file, no retention, not encrypted at rest (D-11, D-59) |
| `docs/15-api.md` | Not yet updated for the import additions in #43 (`suggestions`, `columns`, `warnings`) |
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

The detailed, dated record is [`CHANGELOG.md`](CHANGELOG.md). Since 2026-10-11 (newest last): authorship, owner + participants,
presence (#26–#28); the fake-gateway and fixture fixes (#29); the schema visualizer (#30); the two-role pipeline
(#31); typing and the send-anyway warning (#32); held messages released on time plus a double-send race and a
ceiling overshoot (#33); the gateway inside each org's tenant (#34); key rotation with its wizard (#35); then, as
docs only, logging and telemetry (`docs/28`), the free hosting plan (`docs/29`), D-56, and the D-23 search decision; then the alpha container (#37, #38), Cloudflare hardening (#39, `docs/30`), the contacts page size fix (#40) and the priority and import-header docs (#41). then #43 (import) and #44 (S3 storage), both merged 2026-10-16. Still unmerged: the number-fallback branch.

---

## Next

**The order, remaining:** (1) **open the fallback PR** (merge `origin/main` into `feat/whatsapp-number-fallback`, run `verify`);
(2) **hosting**: he picks a route with the other developer, then packaging is finished and one spare number is
tested for 72 hours on the new host, behind the Cloudflare tunnel checklist in `docs/30`; (3) the **real-number
pilot** (a week), including the first run of the number fallback; (4) priorities: **D-59/D-63** (encryption
decision, then the copy job, Files tab, cleanup), **D-21** wizard remainder, **D-23** search, **D-31** per-org keys.

**Proposed and not chosen (ask before building):** fix the serial send sweep; a fast path that skips the pre-send
pause for the first replies to engaged contacts (needs a simulation scenario); the rest of D-53; the D-57
background import before any large real file; D-61 and D-62 (lighter web tier, single executable).

**Held / pinned (do not build without asking):** everything under *Pending* above, including D-55 (last) and D-56.

**Deployment:** the production database lives on the same host as the gateway (D-33, `docs/29`).
`ENCRYPTION_KEY` (and any retired keys) must be backed up separately from the database; losing them loses every
linked number and every stored message. Rotate with the Security page and `npm run keys`.
