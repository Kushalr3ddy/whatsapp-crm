# 11 · Code conventions

## The comment rule

**Every class, function, method, exported constant, type and non-obvious variable carries a
1–4 line comment saying what it is and why it exists.**

Not a restatement of the signature. The signature already says what the parameters are; the
comment says why anyone should care.

### Bad — satisfies a linter, helps nobody

```ts
/** Gets the contact. */
async function getContact(id: string) { ... }

/** The cap. */
const DAILY_CAP = 1500;
```

### Good — says why, and what would surprise you

```ts
/**
 * Resolves an inbound sender to a contact by identity, creating one if unknown.
 * Always goes identity → contact, never a scan of `contact`, because a person may
 * arrive under a phone number, a `@lid` privacy id, or an external ref.
 */
async function resolveInboundContact(orgId: string, identity: Identity) { ... }

/**
 * The shortest gap between two sends from one sender identity, in milliseconds. A number needs its source and the reason it is
 * that number (docs/08-antiban.md).
 */
const BASIC_GAP_MIN_MS = 3_000;
```

### Enforcement

Mechanical, because discipline decays:

```jsonc
// eslint.config.js — the working configuration, verified to fire on an undocumented
// function, exported const and type, and to pass clean code.
"jsdoc/require-jsdoc": ["error", {
  "require": {
    "FunctionDeclaration": true, "MethodDefinition": true, "ClassDeclaration": true,
    // Inline callbacks are deliberately exempt. Demanding a docblock on every
    // `(t) => [...]` produces noise that trains people to write "/** Callback. */" —
    // the exact failure this rule exists to prevent. Named function-valued consts are
    // still covered by the export context below.
    "ArrowFunctionExpression": false, "FunctionExpression": false
  },
  "contexts": [
    "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration",
    // Targets the `export` statement, not the declaration inside it — a leading docblock
    // attaches to the ExportNamedDeclaration node, so selecting the inner
    // VariableDeclaration reports a missing comment that is plainly there.
    "ExportNamedDeclaration[declaration.type=\"VariableDeclaration\"]"
  ]
}],
"jsdoc/require-description": "error"
```

CI fails on violation. The linter cannot judge whether a comment is *useful* — that is what
review is for, and "this comment restates the signature" is a valid review blocker.

### Where comments are especially load-bearing

- **Anti-ban constants.** Every number needs its source and the reason it is that number.
- **Anything that looks wrong but isn't.** The old codebase's best comment explained why it
  used a gateway-resolved chat id instead of a synthesized one — because the obvious
  alternative crashed the entire engine (M26). That comment saves the next person a day.
- **Deliberate duplication**, caches, and anything where the obvious refactor is wrong.

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **No `any`** without an inline comment justifying it.
- No non-null assertion (`!`) without a comment; prefer narrowing.
- Errors are typed; expected failures are `Result<T, E>`, unexpected ones throw.
- `readonly` by default on interfaces and parameters.

## Layering

Enforced by `no-restricted-imports` (this is M1's rule as a lint error):

```
apps/*  →  core, shared, db, sdk
core    →  shared, db, PORTS only — never a concrete adapter
adapters →  shared (+ their own SDK)
db      →  shared
shared  →  nothing
```

`core` may import `ChannelProvider`; it may never import `baileys`.

## Naming

| Thing | Convention |
|---|---|
| Files | `kebab-case.ts` |
| Types, classes | `PascalCase` |
| Functions, variables | `camelCase` |
| Constants | `SCREAMING_SNAKE_CASE` |
| DB tables, columns | `snake_case`, singular table names |
| Ports | `SomethingProvider` / `SomethingDriver` |
| Adapters | named for the vendor: `BaileysChannelProvider`, `S3StorageDriver` |
| Booleans | `is` / `has` / `should` prefix |
| Async | no `Async` suffix — the type says so |

## Errors

- RFC 7807 problem+json at the boundary, with **stable machine-readable codes** clients can
  branch on.
- Never swallow an error. Never `catch {}`.
- Log at the boundary, not at every layer — one error, one log line.
- Include `request_id` and `org_id` in every error path.

## Git

- **Never push to `main`. Every change is a pull request** (changed 2026-10-09): branch from an
  up-to-date `main`, push the branch, open a PR with `scripts/open-pr.sh`; the maintainer checks CI
  and the local tests and merges. One PR per workstream; migrations are numbered in merge order, so
  only one PR touching the schema is open at a time.
- Commit messages are a plain lowercase line saying what changed and why, scoped by a leading
  area when it helps: `numbers: archive unlinked numbers, drive the unlink button from the db`.
  No Conventional-Commits `type(scope):` prefix is required.
- **No AI / `Co-Authored-By` attribution** in commit messages.
- Session state lives in `HANDOFF.md` (the current snapshot) and `CHANGELOG.md` (the running
  work ledger), not in `CONTEXT.md` — that file is retired.

## Recording decisions

A decision that would be expensive to reverse, or that someone will later ask "why on earth"
about, is written down **in the doc it belongs to** — the stack choice in `10-stack.md`, a
parked decision in `21-deferred.md`, a data-model call in `05-data-model.md` — with the *why*
and what was rejected, not just the outcome. Keep the reasoning next to the thing it is about,
so there is one place to look and nothing to cross-reference.

## Tests

- Co-located `*.test.ts` for units; `tests/` for integration, E2E and load.
- Test names read as sentences: `refuses a freeform send outside the Meta window`.
- No mocks at architectural boundaries — use Testcontainers and the `fake` adapters.
- Every bug fix starts with a failing test; every `M*` defect from `00-prior-art.md` has a
  named regression test.

## Documentation

- Docs live beside code and are reviewed with it.
- Generated where possible: OpenAPI from Zod, the schema diagram from migrations, the config
  table from the env schema. A drift check fails CI (M22 — the old repo's README contradicted
  its code in both directions).
- Comments explain *why*; docs explain *how*; the code explains *what*.
