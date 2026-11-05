# 40 · Testing and bug handling: the guide for Kushal and Mikhil

One page to follow, so nobody has to ask a chat. It covers three things: **how a problem gets reported**, **how it gets fixed and proven fixed**, and **what the automatic checks mean when they go red**. Longer background lives in [`39-bug-workflow.md`](39-bug-workflow.md) (the flow with a diagram) and [`../tests/regression/README.md`](../tests/regression/README.md) (the commands behind it).

## The idea in one paragraph
When something breaks for a real person, we do four things so it never breaks the same way again: **(1)** write it down as a GitHub issue, **(2)** give it a number (**R-012**) and write a test that fails because of it, **(3)** fix the code until that test passes, **(4)** let the robots (CI) re-run all the tests on every change. A test for every bug we have ever had keeps running forever.

## Words, in plain language
| word | what it means |
|---|---|
| **Regression** | something that used to work, broke, and could break again |
| **R-number** | the id of a bug in our list, like R-003. Its test has `[R-003]` in its name |
| **Registry** | the list of those bugs: [`tests/regression/REGISTRY.md`](../tests/regression/REGISTRY.md) |
| **Guarded** | a bug is fixed **and** a passing test would catch it if it came back |
| **CI** | the robots on GitHub that run all the checks on every pull request (PR) |
| **Production build** | the app as it is really deployed (`next build` + `next start`). Some bugs only show up there, not in `npm run dev` |
| **Smoke test** | a small, fast test of the most important things |
| **Gate** | a check that blocks a PR until a rule is met |
| **Flaky test** | a test that sometimes fails for no real reason. It gets `@flaky` in its name and stops blocking PRs while we fix it |
| **Nightly** | the full set of tests, run by a robot every night at 02:00 India time (and on demand) |
| **Slow drift** | the app getting a little slower with each change until you notice, long after. The speed table in the report catches it |

## If you are a tester (Mikhil): how to report a problem
Any one of these. **Never put real people's names, phone numbers, messages or screenshots on GitHub** (the repository is public).
1. **The Google Doc / Notion page** (copy [`feedback/TEMPLATE.md`](feedback/TEMPLATE.md)). One block per problem: which screen, what you did, what you expected, what happened, screenshot pasted right under it. Plain words are perfect. Kushal or a chat will ask you questions about anything unclear.
2. **The "Report a problem" button** at the bottom of the left menu in the app. It opens a form on GitHub with the screen already filled in. You describe it and press submit. Nothing personal is attached.
3. **A markdown file** like `dev-feedback-prod-issues.md` with the screenshots next to it. Kushal imports it.

Tips that save a day of back-and-forth: say **about what time** it happened; say whether it was your own machine or the deployed copy; say whether it happens **every time**; if something "was fine and then stopped", say what you did just before.

When a fix is merged, you get a comment on the issue: **"please check it on your copy."** Reply "works" or say what you still see. That is the last step.

## If you are fixing a problem (Kushal, Mikhil or a chat)
```bash
# 1. make sure there is a GitHub issue (npm run feedback:import for a file, or the form), then:
npm run bug -- "what broke, in plain words" --found "who, where" --issue 42
#    -> adds R-0xx to the registry, writes a skipped test stub, comments the R-number on the issue

# 2. open the stub (tests/e2e/regression-r-0xx-....spec.ts or tests/integration/regression-...test.ts),
#    fill in the steps, remove the "fixme"/"todo", and run it: it must FAIL, for the reason the bug exists
npx playwright test tests/e2e/regression-r-0xx-*.spec.ts      # browser test (stack running: npm run dev:all)
npx vitest run tests/integration/regression-r-0xx-*.test.ts   # database/API test

# 3. fix the code on a branch named fix/R-0xx-short-name, run the test again: it must PASS
git checkout -b fix/R-0xx-short-name

# 4. in tests/regression/REGISTRY.md set the row to "guarded" and put the PR number in the Fix column
npm run regress:check            # instant: every guarded bug has a test, every tagged test has a bug

# 5. open the PR; write "Fixes #42" in the description (the template has the checklist)
```
Which kind of test? Pick the **cheapest** one that would really have caught it: **integration** (rules and data, no browser), **e2e** (something a person sees or clicks). Add `@smoke` to a browser test's title only if it must also run on a production build on every PR (keep that set small).

A fix that truly cannot have a test (a wording change, say): put the label `no-regression-test` on the PR and say why in the description.

## The checks on every pull request
| check | what it does | if it is red |
|---|---|---|
| **check** | typecheck, lint, all unit and integration tests | run `npm run typecheck`, `npm run lint`, `npm test` locally and read the error |
| **e2e** | the browser tests on the dev server with a fake WhatsApp number, **split across 3 machines running at once** (`e2e-shard` 1, 2, 3); `e2e` is green only when all 3 are | open the failed run → the failing shard → the test name and the line; CI saves the page snapshot, trace and screenshot (artifact **e2e-failures-shard-N**). Each shard has its own fresh database, so a test must not depend on data another test file creates |
| **secrets-scan** | looks for passwords/keys committed by mistake | remove the secret from the commit **and** change it; never just delete it later |
| **regress-smoke** | builds the real production app and runs the smoke tests plus the tests of the bugs this PR touches; posts a **report comment** on the PR | read the comment: it lists each known bug as ✅ or ❌ and a speed table |
| **bug-gate** | a PR named `fix/…` (or labelled `bug`) must add a test with `[R-nnn]` in its name, and the bug must be `guarded` | follow the message: it says exactly what is missing |

**One retry:** if a browser test fails and then passes on the retry, the PR stays green but the report lists it under **Flaky**. Don't ignore it: fix it, or put `@flaky` in its name (it then stops blocking, still runs at night, and shows up in the auto-made issue "Flaky tests (auto)").

**`main` is protected** (set 2026-10-22): a PR cannot merge unless `check`, `e2e` and `secrets-scan` pass, nobody (not even an admin) can push straight to `main` or force-push it, and branches are deleted after merging. When the regression framework and the gate are on `main`, add their checks to the list with `CHECKS='["check","e2e","secrets-scan","regress-smoke","bug-gate"]' bash scripts/protect-main.sh --yes`.

**Merging:** Kushal merges. A PR with the label `automerge` merges itself once the checks are green (for docs/tests-only changes). **Stacked PRs** (one built on another) merge in order, bottom first.

## Why CI is split and cached (and what to watch)
- **Sharding:** the ~30 browser test files used to run one after another on one GitHub machine (about 4.5 minutes). They now run as 3 jobs side by side, each on its own GitHub-provided machine (free and parallel on a public repository), so the wall-clock time is about a third. A small final job named `e2e` collects the three results; that single name is what branch protection requires.
- **Caching:** the Chromium browser for the tests and the Next.js build cache are saved between runs, so a run does not download and rebuild them each time. A changed `package-lock.json` or changed web code refreshes the cache automatically.
- **Watch for:** a test that needs data created by *another* test file passes on one machine and fails when the files are split. Make every test create what it needs (as the R-007 test does).

## Running everything yourself, before a deploy
```bash
npm run dev:all -- --no-web      # the API and gateway (the script starts the web app itself, as a production build)
npm run regress                  # everything: registry, typecheck, lint, all tests, the WHOLE browser suite on a production build, speed table, report
#   -> prints and writes regression-report.md
npm run regress:ci               # the small CI-sized version (smoke + speed probe)
npm run regress:nightly          # what the nightly robot runs
npm run regress:check            # just the registry check, instant
```
The report says for every known bug whether its guard still passes (**"this bug is back"** in red if not), and times each main screen against its limit in `tests/regression/budgets.json`. A slow screen **warns**; `REGRESS_STRICT_BUDGETS=1` makes it fail.

## The nightly run
Every night at 02:00 India time the robot runs the whole browser suite on a production build. **Red** → one issue "Nightly regression failed" is opened (or added to), with the report; **green again** → it is closed. You can run it any time from GitHub → Actions → regression-nightly → "Run workflow".

## The testers' Google Doc, turned into issues
The other dev (and alpha testers) paste problems and screenshots into one Google Doc. **One problem per numbered line or heading**, the screenshot right under it ([`feedback/TEMPLATE.md`](feedback/TEMPLATE.md) shows the layout). No AI is needed to read that.
- **With your own signed-in browser, no Google credentials (the easy way):** open the doc in Chrome, paste the contents of [`tools/feedback-doc-reader.js`](../tools/feedback-doc-reader.js) into the console (F12, then Console) **or** save [`tools/feedback-doc-bookmarklet.txt`](../tools/feedback-doc-bookmarklet.txt) as a bookmark (the address is the whole line) and click it on the doc's tab. It reads the doc through your own session, asks whose feedback it is, and saves `feedback-<id>.md` to your Downloads (nothing is sent anywhere). Then, in the CRM folder, `npm run feedback:latest` shows the issues it would create (a dry run) and `npm run feedback:latest -- --apply` creates them, never twice. If Chrome blocks pasting into the console, type `allow pasting` first. Regenerate the tool after changing the reader with `npm run feedback:bookmarklet`.
- **By hand with a file or a service account:** `npm run feedback:gdoc -- <doc link> --out dev-feedback-gdoc.md --reporter Mikhil` makes a markdown file (a doc you saved as text works too: `--file saved.txt`), then `npm run feedback:import -- dev-feedback-gdoc.md --batch gdoc-1 --reporter Mikhil` (dry run) and add `--apply` to create the issues. Numbers and e-mails are masked; **screenshots are never copied** (the doc stays private).
- **Automatically (every 10 minutes):** the workflow `feedback-ingest` does the same by itself and opens an issue for each **new** problem. One-time setup, about 10 minutes: (1) Google Cloud console: create a project, turn on the **Google Docs API**, create a **service account**, make a **JSON key**; (2) share the doc with the service account's e-mail address as **Viewer**; (3) GitHub repo → Settings → Secrets and variables → Actions: secret **`GOOGLE_SERVICE_ACCOUNT_JSON`** (the key file's contents) and variables **`FEEDBACK_DOC_ID`** (the long id in the doc's link), optionally **`FEEDBACK_REPORTER`** (a name) and **`FEEDBACK_REDACT`** (names to blank out, comma separated). Until then it does nothing and does not fail. Run it now from Actions → feedback-ingest → "Run workflow".
- An edit to a problem already imported does not change its issue (the doc's later answers belong in the issue's comments). A doc that is private and has no service account cannot be read: the error says which of the two fixes to use.

## When you want the full picture of a feedback batch
`npm run feedback:report -- --batch <name>` writes `docs/feedback/<name>.md`: every item with severity (S1 to S4), area, status (reported → triaged → reproduced → partly fixed → fixed → verified), R-number, the PRs and whether a test guards it. First one: [`feedback/2026-10-22-prod.md`](feedback/2026-10-22-prod.md). `npm run changelog -- --since 2026-10-22` lists the merged PRs by kind.

Severity: **S1** a wrong message was sent, data was lost or a number could be banned (drop everything) · **S2** a feature is broken · **S3** confusing or slow · **S4** polish.

## Things that have gone wrong before (read before debugging)
- **A page works in `npm run dev` but a button hangs on "Creating…" when deployed:** Next's own gzip. `compress: false` in `apps/web/next.config.ts` (R-001). Always test on a production build.
- **`next build` fails with "`<Html>` should not be imported":** your `.env` has `NODE_ENV=development`. Build with `NODE_ENV=production` (the scripts do this).
- **A feature looks missing after switching branches:** the API (`npm run dev`) can keep running old code. Restart the API. Never restart the **gateway** while testing real WhatsApp: it can put the encryption sessions out of sync ("Waiting for this message"; fix = Unlink / reset the number, scan a new QR).
- **"Waiting for this message" on a phone:** (1) out-of-sync sessions after a gateway restart, (2) a message sent **to the sending number itself** (blocked since PR #110), (3) a gateway crash leaving resend requests unanswered. Check the gateway log for "retry request".
- **A test fails in CI but passes on your machine:** CI uses a fresh database and the dev server (slow first page loads). Open the saved snapshot first; don't guess.
- **Test data piles up** (tags/drafts from audit runs): `npm run dedup:cleanup` (dry run first).

## Where things live
| what | where |
|---|---|
| the bug list | `tests/regression/REGISTRY.md` |
| browser tests | `tests/e2e/` (`regression-*.spec.ts` = production-build smoke + speed probe) |
| database/API tests | `tests/integration/` · contract: `tests/contract/` |
| the timed full walk of the app (recorded) | `tests/live/` · `npm run test:session` (safe) / `test:session:real` (sends real messages) |
| the commands | `scripts/regress.sh`, `scripts/bug.mjs`, `scripts/feedback-import.mjs`, `scripts/feedback-report.mjs`, `scripts/changelog.mjs`, `scripts/protect-main.sh`, `scripts/setup-labels.sh` |
| the robots | `.github/workflows/` (`ci.yml`, `regression-nightly.yml`, `after-merge.yml`, `automerge.yml`) |
| the issue form / PR template | `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` |
| the feedback template | `docs/feedback/TEMPLATE.md` |
