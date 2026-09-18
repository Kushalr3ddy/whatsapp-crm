# ADR-0002 · Baileys version to pin

**Status:** Accepted, 2026-09-18. Supersedes the open version of this ADR.

## Context

Baileys is the single hardest dependency in the system: unofficial, reverse-engineered, and
tracking a protocol that changes without notice. Two candidates, both published on npm by the
same maintainers:

| | `baileys@6.7.24` (tag `legacy`) | `baileys@7.0.0-rc14` (tag `latest`) |
|---|---|---|
| Published | 2026-07-29T00:57Z | 2026-07-29T01:13Z |
| Maturity | Stable release | Release candidate since rc.3; **no stable 7.0.0 has ever shipped** |
| Dependencies | 9, all pure JavaScript | 11, incl. `whatsapp-rust-bridge` |

**The decisive fact is the timestamps: those two were published sixteen minutes apart.**
`legacy` is a label, not a verdict — 6.x is actively maintained alongside 7.x, which is the
main risk one would otherwise fear from pinning an older line.

### A concern investigated and dismissed

An earlier draft of this ADR argued against 7.x because `whatsapp-rust-bridge` is a "native
Rust binding" that would complicate Docker builds and platform portability.

**That was wrong, and it was checked rather than assumed.** Installing the package shows it is
Rust compiled to **WebAssembly**: 2.1 MB, no `.node` binary, no Rust toolchain required at
install, and it loads cleanly. WASM is platform-independent, so there is no portability or
build-time cost. That argument is withdrawn.

### Package scope

Use the **unscoped** `baileys`, not `@whiskeysockets/baileys`. Both are published in lockstep
at identical versions, but the unscoped package now carries ~1.8M weekly downloads against
~426k for the scoped one. Where a reverse-engineered client is concerned, the more-used
package gets protocol breakages reported and fixed sooner.

## Decision

**Pin `baileys@6.7.24` exactly.** No caret, no range.

Reasoning, in order:

1. **It is a stable release; 7.x is not.** A release candidate's API can still change, and the
   7.x line has sat in RC across at least twelve iterations. While learning the library, a
   moving API is a cost with no benefit.
2. **It is demonstrably maintained** — same-day publication alongside the RC.
3. **Fewer moving parts** while the adapter is being written for the first time.
4. **The port makes this cheap to revisit.** `ChannelProvider` plus its contract suite means
   evaluating 7.x later is: write the adapter against the new version, run the same suite,
   compare. That is the entire reason the port exists.

## Consequences

**Accepted risk:** if WhatsApp changes its protocol and the maintainers fix only 7.x, 6.7.24
breaks and we migrate under pressure. The same-day publishing pattern is evidence against
this, not proof. Mitigation: the adapter surface stays thin, the contract suite is the
migration test, and this ADR is revisited **when a stable 7.0.0 ships**.

**Given up:** whatever performance the WASM bridge buys in 7.x. Irrelevant at a volume the
anti-ban engine caps at roughly 8 messages per minute per number.

**Operationally:** pin the exact version in `package.json`, never a range. A reverse-engineered
client is the last dependency that should float.
