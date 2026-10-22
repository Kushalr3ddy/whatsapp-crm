## What and why
<!-- Plain words: what was wrong, or what this adds. -->

Fixes #<!-- the issue number, so it closes when this merges -->

## If this fixes a bug
- [ ] The R-number is: **R-___** (made with `npm run bug -- "…" --issue N`)
- [ ] The test with `[R-___]` in its title **failed before the fix** and passes now
- [ ] The registry row (`tests/regression/REGISTRY.md`) is `guarded`, with this PR in the Fix column
- [ ] Added `@smoke` to the test only if it must also run on a production build in CI

> A fix with no test needs the label `no-regression-test` and a sentence here saying why.

## Checks
- [ ] CI is green: check, e2e, secrets-scan, regress-smoke, bug-gate
- [ ] I looked at the screen if this changes how something looks
- [ ] Docs updated if behaviour changed
