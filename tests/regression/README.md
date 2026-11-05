# Regression testing

A regression is something that worked, broke, was fixed, and could break again. This folder is how we make sure a bug found once is never found twice.

## Run it

| command | what it does | when |
|---|---|---|
| `npm run regress` | registry check, typecheck, lint, all unit/integration tests, then the **whole browser suite on a production build** (port 3101), then a report | before a deploy; after a big change |
| `npm run regress:ci` | registry check, the `@smoke` browser tests and the speed probe on a production build | what CI runs on every PR (job `regress-smoke`) |
| `npm run regress:check` | only: does every guarded bug have a test, and every tagged test a bug | instant |
| `npm run bug -- "what broke" --found "who, where"` | report a new bug (see below) | whenever you find one |

The API (and gateway) must already be running (`npm run dev:all -- --no-web`); the script starts only the web app, as a production build, and stops it again. The result is `regression-report.md` (also printed): pass/fail, whether each known bug is still guarded, and click-to-page timings against budgets.

**Why a production build?** Some bugs exist only there. R-001 (forms hanging on "Creating…") was invisible in `next dev`, which does not compress responses, and showed up the first time the app was run the way it is deployed.

## When a new bug turns up

1. **Report it.** Anyone can file the GitHub "Bug report" form (what, which screen, dev or prod). Whoever picks it up runs `npm run bug -- "<what broke, in plain words>" --found "<who, where>" [--layer e2e|integration] [--area contacts]`. That gives it the next number (R-008, …), adds a row to `REGISTRY.md` with status `open`, and writes a stub test that is skipped until you fill it in.
2. **Write the failing test first.** Fill in the stub so it fails for the reason the bug exists (red). Keep `[R-008]` in the test title. Add `@smoke` to the title only if it must also run on a production build in CI (keep that set small: it costs CI minutes).
3. **Fix the code** until the test passes (green).
4. **Mark the row `guarded`** and put the PR number in the Fix column. `npm run regress:check` (and CI) fails if you forget: a `guarded` row needs a test with its tag, a tag in a test needs a row, and a row left `fixed` with no test is refused.

Which layer? Pick the cheapest that would really have caught it: **integration** (`tests/integration`, vitest, real database, no browser) for rules and data; **e2e** (`tests/e2e`, Playwright) for something a person sees or clicks.

## What CI checks on a pull request that fixes a bug
- **`bug-gate`** (`tests/regression/bug-gate.mjs`): a branch named `fix/…` (or a PR labelled `bug`) must add or change a test with a `[R-nnn]` tag in its title, and that bug's registry row must be `guarded`. Escape hatch for a fix that truly cannot have a test: label the PR `no-regression-test` and say why in the description.
- **`regress-smoke`**: also runs the browser tests of the R-numbers the PR touches (`tests/regression/changed-ids.mjs` reads them from the diff), on a production build, and posts one **comment on the PR** with the report (updated every run).
- **Retry once:** a test that fails and then passes on the retry is shown in the report as **flaky**, not green-washed. To take a known-flaky test out of the blocking checks while it is fixed, put `@flaky` in its title (the nightly run, still to come, keeps running it).
- **Nightly:** a scheduled run (02:00 India time, or on demand) of the whole browser suite on a production build, flaky-tagged tests included. If it goes red it opens one issue (`Nightly regression failed`, label `regression-nightly`) and closes it when green again; tests that passed only on a retry go in one `Flaky tests (auto)` issue. `npm run regress:nightly` runs the same thing locally.
- The PR template (`.github/pull_request_template.md`) walks through the same checklist.

## Phone numbers in tests (R-009)
All test people use fiction numbers `+1 202 555 0xxx`. The seeded demo people (`npm run local:seed`) own **0120 to 0139**; a test that imports one of those numbers under another name renames that person (newest name wins) and the seeded-pages tests then fail at random. Keep each test's numbers in its own block: send-flow 0180-0198, broadcast-flow 0200-0299, keep-columns 0200+, contacts-tags 0245-0290, import-flow 0300-0489, import-notice 0490-0579, import-reupload 0600. Never reuse 0120-0139.

## Speed budgets
`budgets.json` holds click-to-ready limits in milliseconds. The speed probe (`tests/e2e/regression-budgets.spec.ts`) times the main screens and the report compares them. A slow screen **warns**; `REGRESS_STRICT_BUDGETS=1 npm run regress` makes it fail. Re-measure in depth with `node scripts/measure-contacts.mjs` and `node scripts/measure-api.mjs`, and compare two full audits with `node tests/live/session-compare.mjs`.

## What is where
- `REGISTRY.md` — the bug list. · `budgets.json` — the speed limits.
- `check-registry.mjs`, `report.mjs` — the checker and the report builder.
- `tests/e2e/regression-prod.spec.ts` — the production-build smoke tests · `regression-budgets.spec.ts` — the speed probe.
- `scripts/regress.sh`, `scripts/bug.mjs` — the runner and the bug intake.
- The older layers stay as they are: `tests/integration`, `tests/contract`, `tests/live` (the timed audit, `npm run test:session`). See also `docs/12-testing.md` and `docs/24-local-testing.md`.
