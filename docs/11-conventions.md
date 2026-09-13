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
 * Steady-state daily send ceiling per sender identity, once warmup completes.
 * Chosen from observed ban thresholds, not from throughput needs — see
 * docs/08-antiban.md. This is a hard limit: no admin override path exists.
 */
const STEADY_STATE_DAILY_CAP = 1500;
```

### Enforcement

Mechanical, because discipline decays:

```jsonc
// .eslintrc
"jsdoc/require-jsdoc": ["error", {
  "require": { "FunctionDeclaration": true, "MethodDefinition": true,
               "ClassDeclaration": true, "ArrowFunctionExpression": true },
  "contexts": ["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration",
               "VariableDeclaration > VariableDeclarator[init.type=/Function|Arrow/]"]
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

- **Conventional Commits**: `feat(campaigns): pause acts on the queue, not the rows`.
- Branch per change; squash on merge.
- PR template checklist: does this touch the send path? does it add a bypass? is the comment
  rule satisfied? does it need a `CONTEXT.md` entry?
- **Every session appends to `CONTEXT.md`.** No exceptions — that file is how a successor
  reconstructs intent.

## ADRs

`docs/adr/ADR-NNNN-short-title.md` for any decision that would be expensive to reverse or that
someone will later ask "why on earth" about. Format: Context · Options · Decision ·
Consequences · Status. An ADR is never edited after acceptance; it is superseded by a new one.

## Tests

- Co-located `*.test.ts` for units; `tests/` for integration, E2E, load and simulation.
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
