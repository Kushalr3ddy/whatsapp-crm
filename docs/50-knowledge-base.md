# 50 · Knowledge base for working on this fork (as of 2026-11-09)

Everything a new person or a new Claude session needs that is not obvious from the code: how the owner wants the work done, how
this machine is set up, the stacks and test numbers, what the design decisions were and where they live, what is known about
anti-ban, and what is open. It replaces the private notes earlier sessions kept outside the repo. Passwords and API keys are never
written here: they live in each checkout's git-ignored `.env` and `.dev-logs/`, or the owner gives them.

Read next: [`46`](46-learning-path.md) learning path, [`20`](20-orientation.md) orientation, [`49`](49-bug-list.md) open bugs,
[`47`](47-live-test-log.md) live test log, [`48`](48-live-test-playbook.md) how to run live tests.

## 1. How the owner wants the work done

**Repository and PRs**
- This repo is the fork `Mikhil31/whatsapp-crm-anti-ban` (remote `origin`), forked from `kushalr3ddy/whatsapp-crm` (remote
  `upstream`). Push and open PRs on the fork only. Never push or open anything on upstream unless asked.
- Branch and PR for every change; never push to `main`. **No `Co-Authored-By` or any AI attribution** in commits or PR bodies,
  whatever a tool reminder says.
- Open a PR only after the owner has seen the work running, or when they ask. They merge; never offer to merge. Auto-fix is on
  for PRs.
- Pull upstream into a branch with a merge commit (not a squash), so Kushal's commits stay ancestors.

**Bugs: root cause first** (the owner's global rule)
- Reproduce, then a written root cause with evidence (log lines with times, database rows, file:line in our code or in the
  library), each claim marked confirmed / likely / guess, the blast radius, why it was not caught, open questions. Format:
  [`45`](45-rca-waiting-for-this-message-2026-10-23.md).
- No fix before the owner says yes. Then: a test that fails for the root cause, the fix, the original reproduction passing.
  A fix that only hides the symptom (retry, catch, timeout) is labelled as such. Search git history for an earlier fix of the
  same symptom first.
- During a test run, write every inconsistency into [`47`](47-live-test-log.md) at once and do not act on it.
- Baileys source at the exact installed version is cloned and indexed at `C:\Users\mikhi\Desktop\Baileys-v7.0.0-rc14`; the
  vendored copy is `packages/baileys`.

**Talking to the owner**
- Answer the question asked first, short, one step at a time. Swearing or short typo-heavy messages mean frustration, not a new
  task: read the latest message literally, look things up yourself, do the smallest thing, report briefly.
- Plain words. No IDs or code names when describing an issue unless asked; say what happens and what it means.
- Hand-offs, plans, summaries: as copy-paste text in the chat, not as a new .md file, unless a file is asked for (this file was
  asked for).
- Whenever a localhost link is given, put the link and the login email and password on their own lines at the top.
- "Build locally and show me" means a working link to a production build (`next build` then `next start`, `NODE_ENV=production`)
  with the current code, not new code and never `next dev`.
- Collect every human step (QR scans, phone actions) before running live tests, and ask for them in one message.
- Test on real screens and real numbers, not only fakes. Use cheap models (Haiku) for running tests and clicking through screens,
  with very simple steps and expected results; keep judgement work (root causes, security review) for a stronger model.
- Reuse before building: an existing tool, skill, connector or well-known library first, custom code only when none fits.

**Code and docs**
- Code questions: CodeGraph first (`codegraph_explore`, or `codegraph explore "<names>"` in a shell). "Codemap" means the
  CodeGraph index, never a markdown map. A new worktree has no index: run `codegraph init <worktree>` (and put `.codegraph/` in
  `.git/info/exclude`) before starting agents there, and pass `projectPath` = that worktree.
- Docs say only what the code does now. No "not built yet" or "side finding" notes in feature docs; delete stale text instead of
  annotating it. Bugs and findings go to 47 and 49.
- Docs that travel with a change: `CHANGELOG.md`, `docs/15-api.md`, `docs/05-data-model.md`, `docs/generated` (`npm run db:docs`),
  `docs/12-testing.md`, `docs/24-local-testing.md`, the regression registry (`tests/regression/REGISTRY.md`).
- UI work: stick exactly to the approved design (artifact); anything the design does not show, ask first. Check 375 px and
  1280 px. "Text box" means the one shared WhatsApp-style message box (B / I / S / mono toolbar, `*bold*` markers, fill-ins,
  live preview): `apps/web/components/message-box.tsx`, used wherever a message is typed.
- Repo files use CRLF (autocrlf). Edit `.cmd` files with an editor, not `sed` (it turns `\c` into a control byte).

## 2. This machine

| What | Where |
|---|---|
| Fork checkout | `C:\Users\mikhi\Desktop\WhatsAppCRMAntiBan` (worktrees under `.claude\worktrees\`). The main checkout's HEAD can be an old detached commit: check `git -C <path> log -1` before running anything from it |
| Upstream checkout (Kushal's repo) | `C:\Users\mikhi\Desktop\WhatsAppCRM`. Never clone upstream again; never push there |
| Postgres for this fork | container `whatsapp-crm-antiban-db`, port **5435** (volume `whatsapp-crm-antiban-data`); user `dev` |
| Postgres of the upstream checkout | container `whatsapp-crm-dev-db`, port **5434**; also used here for test and scratch databases |
| Docker Desktop | must be running; containers stop when it does |
| Standalone WhatsApp tester (number B) | `C:\Users\mikhi\wa-tester` (its login in `auth\`), control page http://127.0.0.1:3998; the repo copy is `tests/live/tester.mjs` |
| Design artifacts (HTML copies) | `C:\Users\mikhi\Desktop\whatsapp-crm-redesign-artifacts\` |
| Plan files the owner keeps current | `C:\Users\mikhi\Desktop\whatsapp-crm-redesign-plan.md`, `whatsapp-crm-restructure-checklist.md` |
| Owner's real test file | `Purchase-Manager_20260622211807_160.xlsx` (160 Naukri rows, 82 columns, 10-digit numbers without a country code), kept under `WhatsAppCRM\private\`. Do not upload it to a scratch database unless asked |

**Databases** (never migrate or wipe the owner's own `whatsapp_crm_dev`):

| Database | Server | Use |
|---|---|---|
| `whatsapp_crm_dev` | 5435 | the owner's own stack (API 3100 / web 3101). Do not touch |
| `whatsapp_crm_live` | 5435 | the live test install (number 123 linked in it) |
| `whatsapp_crm_test`, `whatsapp_crm_test_fm2` | 5434 | vitest. `_fm2` has every migration up to 0049; the shared `whatsapp_crm_test` may lag |
| `whatsapp_crm_e2e` | 5434 | scratch stack for the browser suite and attack tests (fake channel) |
| `whatsapp_crm_nc*` | 5435 | older scratch stacks of the redesign sessions |

**Ports in use** (other sessions' stacks may be running; never stop a stack you did not start):

| Ports | What |
|---|---|
| 3100 / 3101 | the owner's own stack. Do not touch. Also 3103 / 3104 |
| 3120 / 3121 | live test install: API / web, real Baileys gateway, database `whatsapp_crm_live` |
| 3000 / 3001 | scratch stack: API / web, fake channel, database `whatsapp_crm_e2e` |
| 3998 | the tester for number B |
| 3106 to 3118 | older redesign scratch stacks (Inbox, Contacts, Import, AI) |

## 3. Running things

- **A fresh worktree** has no `node_modules` and no CodeGraph index: `npm ci`, then `npm run baileys:build` (`npm ci` skips install
  scripts), then `codegraph init .`. Older worktrees had `node_modules` as links into deleted worktrees, which made `@crm/*` run
  old code; check with `find node_modules -maxdepth 1 -lname '*engine*'`.
- **A production web build:** `NODE_ENV=production next build apps/web`. With `NODE_ENV` taken from a development `.env`, the build
  fails on "<Html> should not be imported outside of pages/_document". Every `next start` that serves the same `apps/web/.next`
  must be restarted after a build.
- **Starting a stack by hand** (each in the background, logs in `.dev-logs/`): `node --import tsx --env-file-if-exists=.env
  apps/api/src/server.ts`, the same for `apps/gateway/src/main.ts`, and `node --env-file-if-exists=.env
  node_modules/next/dist/bin/next start apps/web --port <web port>`. `--env-file` never overrides a variable already set, so a
  scratch stack sets `DATABASE_URL`, `PORT`, `CRM_API_URL`, `GATEWAY_CHANNEL=fake`, `STORAGE_PATH` in the shell first.
  `npm run dev:all` and the `db:*` scripts hardcode 3000/3001/5434 and the upstream container.
- **A scratch org:** `npx tsx --env-file-if-exists=.env scripts/admin.ts org --name "E2E Test" --slug e2e-test --email <email>`
  (prints the password once; `admin.ts password --email <email> --password <new>` sets one), `admin.ts user --org <id> --email
  <email> --role agent`, then `npx tsx --env-file-if-exists=.env scripts/local-seed.ts` (a fake connected number, people, tags).
  The browser suite reads `TEST_EMAIL`, `TEST_PASSWORD`, `E2E_BASE_URL`.
- **Tests:** `TEST_DATABASE_URL=postgresql://dev:dev@localhost:5434/whatsapp_crm_test_fm2 npx vitest run`. Two
  `packages/providers/llm/src/settings.test.ts` tests always fail on Windows (file mode 0666 vs 0600). On a loaded machine, import
  tests and the browser import specs time out; run them alone before calling it a failure.
- **Quiet hours** are on by default (22:00 to 08:00 in the org's zone, Asia/Kolkata): every campaign message waits until 08:00.
  A test that sends a campaign at night will see nothing go out; the gateway log says `reason: "quiet_hours"`.
- **Querying the database by hand:** `docker exec whatsapp-crm-antiban-db psql -U dev -d whatsapp_crm_live`. Tenant tables have
  row-level security; as the app role set `app.org_id` with `set_config` first.
- **Typing hold:** `SEND_TYPING_HOLD_MS` (0 to 120000, needs `SEND_TYPING_SIMULATION=true`) keeps "typing…" on for that long before
  every send; the gateway re-sends "composing" every 5 s during it.

## 4. Live test set-up

| Part | Value |
|---|---|
| Number 123 (A) | +91 99641 22631, linked in the live install (sender `97b2feb0-40e3-4949-bf97-c65bcd68742a`) |
| Number 456 (B) | +91 88844 78039, linked to the standalone tester; the install knows it only as the contact "Ravi Kumar" (`c8ec9b45-5a38-428d-ada4-aef858625aaa`), tag `ai-test` (`27bd6ccd-a653-455f-bd24-42086d361ac6`), AI template `4d6474b0-f95f-4167-adab-f03f848f0201` |
| Login | `live@test.local` (password from the owner, not in the repo) |
| AI | Gemini `gemini-3.1-flash-lite`, key in the worktree `.env`. The key was pasted in a chat once: rotate it |
| Other people | two real strangers wrote to 123 (+91 90355 24447, +91 70199 47640). Never use "Send to everyone" in tests; stay off their chats in demos |

- Logins survive restarts: the install keeps the WhatsApp login in `channel_auth_state`, the tester in its `auth\` folder.
  Relink only if the device is removed on the phone, WhatsApp logs the number out, the phone is offline more than 14 days, or the
  database is wiped.
- Airplane mode on phone 123 does not drop the install's connection (linked devices keep working). To test a dropped connection,
  turn off the internet of the machine running the gateway.
- The suite: `npm run live:suite -- --only <group>`; settings and every case in [`48`](48-live-test-playbook.md). Run groups one
  after another.
- Not tested live yet: more than one recipient (pacing, caps, quiet hours, parallel AI chats; needs several consenting numbers,
  one tester each on its own port), the internet-drop recovery on the real adapter (F8), removing the device on phone 123 and
  relinking (F3). The self-hosted runner `whatsapp-live` for `.github/workflows/live-whatsapp.yml` is not set up.

## 5. Screens and their designs

The screens were redesigned one at a time from claude.ai artifacts the owner commented on (comments carry the decisions). The
artifacts are private to the account that made them; HTML copies are in the Desktop folder above.

| Screen | Design | Built |
|---|---|---|
| Look (palette Pulse/violet, Geist 16 px, dark sidebar, Lucide icons, motion rules) | step 0 `7qcWLJcrJPgmReENAmcgPx`, motion kit `A4dzCvKXbJYXpiaXDPxkqp` | PR #12 |
| Campaign page | `AcRYR6XMbPgBfmzeP7agSv` | PR #13 |
| Campaigns list | `LmJSeKAdjQxh3EZrm3ALgN` | PR #15 |
| New campaign | `RTMbhZikmVend1Qf7TKNVx` (v20) | PR #16 |
| Inbox and chat | `2gxn9n3mVyBoyedSpDoYuW` (v8) | PR #18 |
| Contacts | `FDzC71Amor7tEkccKJyvJN` (v7) | PR #18 |
| Import | `8MX13xDxegvx6A3HiuoLEU` | PR #19 |
| AI assistant templates (step 9) | `EZUL2phsVEDv82tqpkCCqe` (v26) | PR #21 |

Decisions worth knowing:
- **Inbox:** the header shows the name and who is answering; number, owner, Resolve and campaigns are in a Details slide-over.
  While the AI owns a chat the reply box is blurred behind "Take over"; then "Hand back to AI". Only the chat's owner or an admin can
  send (enforced on the server); the first sender in an unowned chat becomes its owner. Resolve closes; a new customer message
  reopens.
- **Contacts:** left list = imported files (each is also a tag named after the file, not deletable), your tags, saved lists (the
  `segment` table). The person panel shows every column of their file. Export is admins only, 5 an hour, audited. The old page is at
  `/contacts/classic`.
- **Import:** the tag is required (the owner: "the core of the whole app"); newest file wins for kept columns (blank or NA never
  erases); a row with no name is saved and campaigns say "there"; email-only people are imported and counted apart; a bad email
  no longer fails a row with a good number. A read-only mini sheet on the check screen, no editing.
- **New campaign:** one pick stays a live audience; several picks freeze as a list. A missing name reads "there". "Draft with AI"
  was removed. Draft rows have Edit.
- **AI templates:** one sentence in, one AI call out (a draft plus at most 5 questions); one "What the AI knows" text; sensitive
  details are "Show it" or "Keep it general"; a hand-over person is required and gets the chat. Customer photos, voice and files
  get a fixed reply with no AI call. Tasks and "Other chats" are parked (D-118).
- **Shelved, never delete:** branch `feat/campaign-workflow-revamp` (anti-ban UI "S10" and campaign-workflow wave 1; PR #11 closed),
  also `feat/antiban-v2-ui`, `feat/cw-wave1-*`. Do not bring them back unless asked.

## 6. Anti-ban: what is known

- Almost every number in the anti-ban engine (day-1 cap 20, ×1.8 a day, 8 a minute and 200 an hour, recovery 24 h after a 463,
  stranger ×2.5, full speed above 85% delivered) was copied from one GitHub library, `kobie3717/baileys-antiban`, which cites no
  data. The "sources" in `docs/08-antiban.md` are vendor blogs. The simulation tests ban on rules from the same doc, so passing
  them only proves the engine obeys its own assumptions.
- The only primary source is WhatsApp's 2019 white paper "Stopping Abuse: How WhatsApp Fights Bulk Messaging and Automated
  Behavior": 2 million+ bans a month, 75% with no user report, about 20% at registration. Signals named, no thresholds: number
  origin and network reputation, messaging intensity, sending without the typing indicator (so typing is not cosmetic), group
  operations, reports and blocks weighted most on the first message from an unknown number. Nothing in our code looks at network
  or IP reputation (a datacenter server).
- Evidence-backed: pacing intensity, typing, care with cold first contacts, group limits, network reputation. Folklore: every
  specific number. The only real calibration is our own data: log every ban or restriction per number beside its sending pattern.
- Meta's Cloud API is the only zero-ban-risk option (paid per conversation). In April 2026 an npm "anti-ban" package (`lotusbail`)
  was malware: vet any library first.
- The planned module shape: an `AntiBanPolicy` port with drivers (today's engine as `builtin`, a `none` driver, the new system as
  its own driver), delete `builtin` last. Do-not-contact, own number, socket down, empty body, fallback-number check and the
  recipient gates (engagement, cooldown, duplicate) always stay outside it.

### 4b. Two organisations on the live install (2026-11-10)

One install, one gateway, two organisations. Org A "Live Test": number `mik` (+91 99641 22631), admin `live@test.local`, extra people `live-a2@` (admin), `live-agent1@`, `live-agent2@test.local`. Org B "Live Org B": number `org-b-number` (+91 88844 78039), admin `live-b@test.local`, extra `live-b2@`, `live-bagent1@`, `live-bagent2@test.local`. Customer phones: A (+91 70199 47640, in both orgs), B (org A only), C (org B only), the friend (+91 90355 24447, both). The scripts, passwords, the MAP file and the send logs live outside the repo in `C:\Users\mikhi\wa-testers` (`run\lib2.mjs`, `l2` to `l13`, `MAP.txt`, `logs\`). Quiet hours were switched off in both orgs for the run: restore with `node quiet.mjs on`. Org A also has a sender slot `second` that was linked by the same WhatsApp account as `mik` (X-006); remove it before a real two-number test.

## 7. Where things stand (2026-11-09)

- `main` has the redesigned screens (#12, #13, #15, #16, #18, #19, #21), the upstream sync (#20), and the failure-mode testing with four
  sending fixes (#22: a connection drop mid-send no longer fails the batch, no double send after a crash or database blip, Cancel
  withdraws queued messages, a blank campaign body is refused).
- Fixed after that, with tests (the branch of this PR): Pause on a draft no longer ends a campaign having messaged nobody (R-022);
  a number that loses internet keeps retrying and comes back by itself (R-026); the contact panel with a Naukri file no longer draws
  values one letter per line (R-032).
- Tested on 2026-11-09 (all in [`47`](47-live-test-log.md)): the live suite on real numbers, the browser suite, a code security
  review, attack-style checks against the API, a bad-input sweep of every write route, every page at 375 and 1280, a load run, and
  whether the AI files replies as interested or not.
- Open, in plain words, worst first (details and evidence in [`49`](49-bug-list.md)): the AI filed a clear "yes" as still talking;
  imports get slow with a few thousand contacts; agents can clear do-not-contact and manage numbers; the raw session cookie is
  written to the API log; anyone can lock the admin out by guessing passwords; the opt-out message quotes an old chat and a second
  STOP reopens messaging; opt-outs are not shown on the campaign page; text cut off at phone width on a few pages; console errors on
  Team, AI settings and Sign-up; drizzle-orm and zod have high advisories.
- Two-organisation run (2026-11-10, [`47`](47-live-test-log.md)): inbound routing, STOP and START per organisation, outbound, parallel campaigns, fill-ins, two admins and two agents in each organisation at the same time, pause, resume and cancel by different people, quiet hours in one organisation only, AI templates in both: all as designed. Fixed since: X-001 (an admin of one organisation could take over a person of another by adding their email) and X-006 (the same number linked twice in one organisation), with R-027 to R-030 (adapter). Still open from it: X-002 to X-004, X-005 (the SC-11 family: recipients stay `queued`). Not done: L9 with a genuinely different second number. Written but not run (2026-11-11): `tests/integration/orgs-modules.test.ts` (66 tests: export, API keys, key rotation, pictures and downloads, imports, segments and custom fields, audit trail, presence) and browser scenarios SCR-1 to SCR-9; run them next and file what fails in `49`. The sign-up page (`/signup`) is a front-end mock (D-47, parked): it creates nothing.
- Next: root-cause the go-live blockers the owner picks; F3 and F8 need the owner's phone and internet; a daytime run with several
  recipients.
