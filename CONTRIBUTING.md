# Contributing

## Before you start

Read, in order: [`docs/01-vision-scope.md`](docs/01-vision-scope.md) (what this is and is not),
[`docs/00-prior-art.md`](docs/00-prior-art.md) (mistakes we are not repeating, and why), and
[`docs/11-conventions.md`](docs/11-conventions.md) (how code is written here).

## Non-negotiables

These are architectural, not stylistic. A PR that violates one will be rejected regardless of
how good the rest is.

1. **No domain-specific tables or enums.** No `candidate`, no `deal`, no hardcoded pipeline
   stage. Pipelines, fields and tags are user-defined rows. This is what keeps the product
   generic.
2. **One send path.** Nothing may reach a provider except through `OutboundDispatcher`. A
   bypass invalidates every anti-ban guarantee in the product.
3. **No transport SDK outside `packages/channels/*`.** Lint-enforced.
4. **No work inside an HTTP handler.** Validate, enqueue, return.
5. **The comment rule.** Every class, function, exported constant and type carries a 1–4 line
   comment saying what it is and why it exists — not a restatement of the signature.
   Lint-enforced; usefulness is a review matter.
6. **No mutable module state.** Locks and buckets go through the cache driver.
7. **Free-path first.** Any feature must work on the `lean` preset, or be optional and degrade
   cleanly when its driver is `none`.
8. **Keep `HANDOFF.md` and `CHANGELOG.md` current.** `HANDOFF.md` is the state snapshot, `CHANGELOG.md` the
   work ledger.

## Adding things

- **A channel** → implement `ChannelProvider` in `packages/channels/<name>/`, pass the contract
  suite. No core change.
- **A data source** → implement `SourceConnector`, export a `configSchema`. The settings UI is
  generated from it.
- **An infrastructure driver** → implement the port in `packages/providers/<port>/<driver>/`,
  pass the contract suite. If a core change seems necessary, the port is wrong — fix the port.

## Pull requests

- **Every change goes through a pull request; never push to `main`.** Branch from an up-to-date `main`
  (`fix/…`, `feat/…`, `test/…`, `chore/…`), push the branch, and open a PR (`scripts/open-pr.sh`). The maintainer
  checks that CI and the local tests pass, then merges. A plain lowercase subject saying what changed and why,
  a substantive body, and **never an AI / `Co-Authored-By` attribution** (commits or PR text) — see
  `docs/11-conventions.md`.
- Every bug fix starts with a failing test.
- Every `M*` defect in `docs/00-prior-art.md` has a named regression test — do not remove one.
- Checklist: does this touch the send path? does it add a bypass? is the comment rule
  satisfied? does `lean` still work? are `HANDOFF.md` / `CHANGELOG.md` updated?

## Tests

`docs/12-testing.md`. Coverage floors: ≥80% on core, **100% on `antiban` and the dispatcher**.
Coverage is a floor, not a goal — a PR that raises the number while testing nothing meaningful
is a review failure.

## Where the checks run (as of 2026-10-20)

- **While the repository is public, GitHub Actions runs the checks on every pull request for free**: typecheck, lint, the unit and integration tests, the browser suite and the secrets scan. That is the gate; read the result on the pull request.
- **If the repository goes private again** and the free minutes run out, GitHub stops starting the jobs (they fail in about 2 seconds with "recent account payments have failed or your spending limit needs to be increased"; that is billing, not the code). Then the same checks must be run **locally**, in this order, one at a time and at low priority:
  `npm run typecheck`, `npm run typecheck:web`, `npm run lint`, `nice -n 15 npx vitest run` (migrate the test database first with `npm run db:migrate:test`), then the browser suite with `nice -n 15 npx playwright test` (it starts its own stack, so stop any other dev stack first). Log memory and load before, during and after in `verify-footprint.log`.
