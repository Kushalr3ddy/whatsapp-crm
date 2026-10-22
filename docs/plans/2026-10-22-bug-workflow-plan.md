# Plan: the bug-to-merge pipeline (approved 2026-10-22)

> **Status (2026-10-22 evening): built.** Phases 1 to 5 shipped as PRs #129 to #133 on top of the regression framework (#115), then CI speed (#136). What is running is described in [`../39-bug-workflow.md`](../39-bug-workflow.md) and the day-to-day guide [`../40-testing-and-bug-guide.md`](../40-testing-and-bug-guide.md); this page is the plan as it was agreed, kept for the reasoning.
>
> **Where the build differs from the plan**
> - The "run only this PR's R-numbers" check is **one job** (`regress-smoke` also runs the tests of the R-numbers the PR touches), not one job per R-number, to keep CI time down.
> - **Branch protection** was applied with `scripts/protect-main.sh` at Kushal's go: required checks `check`, `e2e`, `secrets-scan`, `regress-smoke`, `bug-gate`.
> - **Not built from the plan:** the **Google Doc ingest worker** (now pinned as D-92: a scheduled worker, plain parser first, AI and clarifying questions later); the nightly run exists but has **not run yet**; AI-drafted follow-up questions are pinned.
> - Added beyond the plan: sharded e2e and caching (#136), `npm run dedup:cleanup` (D-90), an own-number guard (#110), the retry for the Chromium install.


## Context
Today's flow is hand-made: Mikhil writes a markdown file with screenshots, Kushal pastes it, a chat turns it into a status doc, fixes go out as PRs, and a first regression framework exists (registry, `npm run bug`, production-build smoke tests, speed probe; PR #115). What is missing is the **whole loop**: a clear intake, a triage document that writes itself, one tracked issue per problem, a PR-time gate that proves each fix has a test, branch protection so main cannot go red, a nightly run, and the rule for flaky tests. The goal is an industry-style, lightweight loop sized for a small team: **report, triage, issue, test, fix, PR, CI, merge, verify**.

Decisions already made by Kushal: intake through a **Google/Notion-style doc** (screenshots + the tester's own words, clarified by asking them), the **GitHub bug form**, **markdown batch import** and an **in-app "Report a problem" button**; **Kushal merges** and `main` is protected by required checks; the bug-fix gate = **a PR that fixes a bug must add a tagged test and it must pass**; a **nightly full regression with flaky-test quarantine**.

## The loop, end to end
1. **Report** (any channel, one normalised shape: screen, what I did, what I expected, what happened, dev or prod, screenshot, when).
   - *Google Doc (primary for Mikhil):* a template doc he pastes into. A chat session reads it with the Drive connector, asks Mikhil clarifying questions in the doc's comment thread or via Kushal when something is unclear, then creates the issues (below).
   - *GitHub "Bug report" form:* already in `.github/ISSUE_TEMPLATE/bug.yml`; add labels `alpha-feedback` automatically.
   - *Markdown batch:* `npm run feedback:import <file.md>` (same format as `dev-feedback-prod-issues.md`) makes one issue per `## issue-N`.
   - *In-app button:* "Report a problem" in the nav opens a pre-filled GitHub issue URL (screen path, app build id, the error code if any). No personal data attached, nothing sent until the person presses submit.
   - **Privacy rule:** the repo is public and screenshots show real numbers and names, so **screenshots are never committed**; issues point to where they are kept (`dev-feedback-*-images/`, git-ignored, or the Google Doc).
2. **Triage** (labels, minutes not days): severity **S1** wrong message sent / data loss / ban risk · **S2** a feature is broken · **S3** confusing or slow · **S4** polish; area labels (contacts, campaigns, inbox, import, ai, numbers, gateway); `needs-repro`, `duplicate`, `wontfix`.
3. **Triage document (generated, not hand-written):** `npm run feedback:report` builds `docs/feedback/<date>-<batch>.md` from GitHub issues + `REGISTRY.md`: table of every item with severity, area, status (reported / reproduced / fixed / verified), R-number, PR, CI state, plus counts (open by severity, bugs reintroduced, flaky tests). This replaces the hand-made `dev-feedback-prod-status.md`.
4. **Reproduce → R-number:** `npm run bug` (exists) gains `--issue N`: it adds the registry row (new **Issue** column), writes the failing test stub, and comments the R-number on the issue.
5. **Fix PR:** branch `fix/R-012-short-name`, one bug per PR where possible. A **PR template** (checklist: issue linked with `Fixes #N`, R-number, test added and was red first, registry row set to `guarded`, docs touched if behaviour changed).
6. **CI gates on every PR** (new jobs next to `check`, `e2e`, `secrets-scan`, `regress-smoke`):
   - **`bug-gate`**: if the branch is `fix/*` or the PR is labelled `bug`, the diff must touch a test whose title carries `[R-nnn]` and `regress:check` must pass (existing `tests/regression/check-registry.mjs`, extended with the Issue column and a "changed R-ids" mode).
   - **`regress-ids`**: runs only the R-tagged tests for the R-numbers in the PR (production build), so each issue has its own named check, fast feedback.
   - **Sticky PR comment** with `regression-report.md` (pass/fail, speed table, budgets warnings).
   - Retry once on a failed browser test; a pass-on-retry is reported as **flaky**, not green-washed.
7. **Merge:** Kushal merges. **Branch protection on `main`** requires `check`, `e2e`, `secrets-scan`, `regress-smoke`, `bug-gate` (a settings change, done only with his OK at build time via `gh api`). Optional `automerge` label (enable the repo's auto-merge setting) for docs/tests-only PRs.
8. **Close the loop:** `Fixes #N` closes the issue; a workflow comments "fixed in #PR, please check on your copy" and labels `needs-verify`; the reporter confirms and it becomes `verified`. The generated doc and a changelog (merged `fix/*` PRs grouped by area, via `gh`) update from that.
9. **Nightly regression** (`.github/workflows/regression-nightly.yml`, cron + manual `workflow_dispatch`): whole browser suite on a production build, speed probe, full report as an artifact; **opens (or updates) a GitHub issue** if red. **Flaky quarantine:** a test tagged `@flaky` is excluded from the blocking jobs, still runs nightly, and has an auto-opened issue; the nightly report lists them with how long they have been flaky.

## Phases (each its own PR, with CI green before the next)
- **P1 Intake and triage:** labels (S1-S4, areas, `needs-verify`, `verified`, `flaky`), issue forms (feedback batch, bug), `scripts/feedback-import.mjs`, `scripts/feedback-report.mjs`, the Google Doc template and the procedure for a chat to import it, the in-app Report button (`apps/web/app/nav.tsx` + small `report-problem.tsx`), registry gets an Issue column, `docs/39-bug-workflow.md` (the flow above with a diagram).
- **P2 PR workflow and gates:** PR template, `bug-gate` and `regress-ids` jobs in `.github/workflows/ci.yml`, `--only R-nnn` in `scripts/regress.sh`, sticky comment, retry-once-and-flag-flaky reporter (`tests/regression/report.mjs`).
- **P3 Merge policy and loop closing:** branch protection (with Kushal's OK), optional `automerge` label, issue-comment workflow, changelog generator.
- **P4 Nightly and flaky handling:** scheduled workflow, auto-issue on red, `@flaky` tag handling in `playwright.config.ts` (`grep` / `grepInvert`) and in the report, flake counter.
- **P5 Documentation and onboarding for new chats:** rewrite `docs/12-testing.md` "Regression tests for prior defects" to point at the workflow; one short "How to handle a bug report" section new sessions read first; memory note.

## Reuse (already built)
`tests/regression/REGISTRY.md`, `check-registry.mjs`, `report.mjs`, `budgets.json`; `scripts/bug.mjs`, `scripts/regress.sh`; `tests/e2e/regression-prod.spec.ts`, `regression-budgets.spec.ts`; `.github/ISSUE_TEMPLATE/bug.yml`; the `regress-smoke` job; `tests/live/session-compare.mjs`; the labels `bug`, `alpha-feedback`; the watcher idea for merges (now only advisory, since Kushal merges).

## Verification (dogfood the pipeline)
- Import the 13 items of Mikhil's prod feedback and the Farhan flake through P1 and generate the triage doc: it must match what is true (issues 1 to 13 with their PRs).
- Open a deliberately test-less `fix/R-0xx` PR: `bug-gate` must fail; add the tagged test: it passes.
- Break something known (turn the gzip setting back on): `regress-smoke` and the named R-number check go red.
- Trigger the nightly with `workflow_dispatch`: report artifact appears; force a failure on a throwaway branch to see the auto-issue; tag a test `@flaky` and see it leave the blocking set but appear in the nightly.
- `npm run regress:check`, typecheck and lint stay green; CI on each phase PR green before merging the next.

## Open points to settle while building
- Google Doc access for Mikhil (a doc shared with Kushal's Drive; the chat reads it with the Drive connector; Notion is not connected here).
- Branch protection needs repo admin rights on GitHub: confirm at P3.
