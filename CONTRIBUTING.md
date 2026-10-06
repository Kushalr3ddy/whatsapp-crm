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

- Commits go straight to `main` while this is a single-maintainer repo (open a branch only when a change
  needs review first). A plain lowercase subject saying what changed and why, a substantive body, and
  **no AI / `Co-Authored-By` attribution** — see `docs/11-conventions.md`.
- Every bug fix starts with a failing test.
- Every `M*` defect in `docs/00-prior-art.md` has a named regression test — do not remove one.
- Checklist: does this touch the send path? does it add a bypass? is the comment rule
  satisfied? does `lean` still work? are `HANDOFF.md` / `CHANGELOG.md` updated?

## Tests

`docs/12-testing.md`. Coverage floors: ≥80% on core, **100% on `antiban` and the dispatcher**.
Coverage is a floor, not a goal — a PR that raises the number while testing nothing meaningful
is a review failure.
