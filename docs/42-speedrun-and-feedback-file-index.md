# 42 · Index: everything written during the AI speedrun and the other dev's feedback (2026-10-21 to 2026-10-23)

A list so nothing gets lost. "Mikhil's prod" in older files means **Mikhil's own laptop**: nothing is deployed anywhere.

## The other dev's (Mikhil's) feedback
| File | What it is |
|---|---|
| [`feedback/2026-10-22-prod.md`](feedback/2026-10-22-prod.md) | Generated triage of his first 13 items (issues #116 to #128) |
| [`feedback/2026-10-22-gdoc1.md`](feedback/2026-10-22-gdoc1.md) | Second batch, from his Google Doc (issues #139 to #142, waiting on his answers) |
| [`feedback/TEMPLATE.md`](feedback/TEMPLATE.md) | The template he copies into a Google Doc to report |
| `dev-feedback-issues.md`, `dev-feedback-prod-issues.md` (repo root) | His raw reports as received |
| `dev-feedback-gdoc-*.md`, `regression-report.md` (repo root) | Local working files, git-ignored |
| [`../tools/README.md`](../tools/README.md) | The tool that reads his Google Doc in your own browser |

## Docs written during the speedrun
| File | What it is |
|---|---|
| [`35-database-and-queries.md`](35-database-and-queries.md) | Database shape, optimisations, main queries; section 7: why there is no cache or extra data layer, and when to add one |
| [`36-workflows.md`](36-workflows.md) | The product's workflows, step by step |
| [`37-session-audit-findings.md`](37-session-audit-findings.md) | First timed audit (dev server): bugs and bottlenecks |
| [`39-bug-workflow.md`](39-bug-workflow.md) | From a bug report to a merged fix |
| [`40-testing-and-bug-guide.md`](40-testing-and-bug-guide.md) | Tests, bugs, CI and reporting: the guide for Kushal and Mikhil |
| [`generated/database-reference.md`](generated/database-reference.md) | Generated schema reference (`npm run db:docs`) |
| [`../tests/regression/README.md`](../tests/regression/README.md), [`REGISTRY.md`](../tests/regression/REGISTRY.md) | The regression suite and the bug registry (R-001 to R-011) |
| [`../.github/pull_request_template.md`](../.github/pull_request_template.md) | PR template added for the bug workflow |

## Slow on a laptop?
`npm run dev:all` runs the dev server, which compiles each page on first visit and grows in memory. On a slower laptop run `npm run dev:all -- --fast-web` (a production build). Measured in docs/38.
