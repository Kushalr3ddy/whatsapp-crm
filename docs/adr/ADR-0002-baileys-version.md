# ADR-0002 · Baileys version to pin

**Status:** Open — blocks P3.

## Context

Baileys is the single hardest dependency in the system: unofficial, reverse-engineered, and
tracking a protocol that changes without notice. As of September 2026 the latest published
version is **`7.0.0-rc14`** — a release candidate. The last stable release was **November 2025**,
and 7.0.0 introduced multiple breaking changes.

There are also several forks on npm (`@whiskeysockets/baileys` scoped, `baileys` unscoped, plus
community forks), which differ in maintenance and in how quickly they track protocol changes.

## Options

**Pin the last stable (Nov 2025).** Known-good, but ten months of protocol drift is a long time
for a reverse-engineered client, and community fixes since then would be missed.

**Pin `7.0.0-rc14`.** Current, but a release candidate — API may still change, and "rc" is a
weak guarantee for something in the send path of a production system.

**Pin a fork.** Some track fixes faster. Trades one maintenance risk for another, and forks are
abandoned more often than upstream.

## Decision

Undecided. To be resolved at P3, by building the adapter against both candidates behind the
`ChannelProvider` contract suite and choosing on evidence.

## Consequences

Whichever is chosen, **pin the exact version** — never a range. The `ChannelProvider` port keeps
the surface thin, so an upgrade is contained to one adapter and validated by the contract suite
plus the ban simulation before it reaches a real number.

Record the upgrade path and re-evaluate whenever upstream publishes a stable release.
