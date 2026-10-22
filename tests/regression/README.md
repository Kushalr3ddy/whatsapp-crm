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

Which layer? Pick the cheapest that would really have caught it: **integration** (`tests/integration`, vitest, real database, no browser) for rules and data; **e2e** (`tests/e2e`, Playwright) for something a person sees or clicks; **simulation** (`tests/simulation`) for anti-ban behaviour over time.

## Speed budgets
`budgets.json` holds click-to-ready limits in milliseconds. The speed probe (`tests/e2e/regression-budgets.spec.ts`) times the main screens and the report compares them. A slow screen **warns**; `REGRESS_STRICT_BUDGETS=1 npm run regress` makes it fail. Re-measure in depth with `node scripts/measure-contacts.mjs` and `node scripts/measure-api.mjs`, and compare two full audits with `node tests/live/session-compare.mjs`.

## What is where
- `REGISTRY.md` — the bug list. · `budgets.json` — the speed limits.
- `check-registry.mjs`, `report.mjs` — the checker and the report builder.
- `tests/e2e/regression-prod.spec.ts` — the production-build smoke tests · `regression-budgets.spec.ts` — the speed probe.
- `scripts/regress.sh`, `scripts/bug.mjs` — the runner and the bug intake.
- The older layers stay as they are: `tests/integration`, `tests/contract`, `tests/simulation`, `tests/live` (the timed audit, `npm run test:session`). See also `docs/12-testing.md` and `docs/24-local-testing.md`.
