# 12 · Testing strategy

The prior system had **zero tests** and verified changes by messaging real people from a real
WhatsApp account (`00-prior-art.md`, M20). That is the bar being cleared.

The `fake` adapters are what make it possible: with `ChannelProvider` and `SourceConnector` as
ports, the entire pipeline — dispatcher, anti-ban engine, campaigns, inbox, webhooks — is
testable with no phone, no account and no network.

## The pyramid

| Layer | Tool | Target | Covers |
|---|---|---|---|
| **Unit** | Vitest | ≥80% core, **100% anti-ban + dispatcher** | Rate maths, warmup curve, jitter distribution, merge policies, phone normalisation, template rendering, identity resolution, risk scoring |
| **Contract** | Vitest + LocalStack, Keycloak, MailHog | Every adapter and every driver | One conformance suite per port — `ChannelProvider`, `SourceConnector`, `StorageDriver`, `AuthProvider`, `QueueDriver`, `EmailDriver`, `KmsDriver`. New adapters are correct by construction; swapping drivers provably changes nothing. |
| **Integration** | Vitest + Testcontainers | Repositories, queues, workers | Real Postgres, real queue, no mocks at the boundary. Migrations up and down. **RLS isolation asserted per table.** |
| **API** | Supertest + Testcontainers | Every endpoint | Happy path, authz matrix (every role × every endpoint), validation, pagination, idempotency, rate limits, error shapes |
| **E2E** | Playwright | Critical journeys | Link a number (fake), import a dirty spreadsheet, build a segment, run a campaign, receive a reply, reassign, opt out |
| **Simulation** | Custom harness | The anti-ban engine | See below |
| **Load** | k6 | Throughput and soak | 10k campaign · 100 msg/s inbound burst · 50k-row import · 24 h soak |
| **Security** | ZAP, Semgrep, gitleaks, Trivy, custom | Every PR | OWASP Top 10, cross-tenant IDOR, SSRF, authz bypass, injection |
| **Chaos** | Scripted | Quarterly | Kill Postgres / queue / gateway mid-campaign |
| **Manual** | Runbook | Pre-release | One real number, small scale, against a checklist |

## The simulation harness

**The single highest-value test in the project**, because it is the only way to validate
`08-antiban.md` without risking a real number.

`tests/simulation/` implements a **virtual WhatsApp** that enforces the documented ban
heuristics and bans you when you trip them:

- tracks reply ratio, block rate, contact-graph distance, send timing regularity, body
  similarity, burst-after-reconnect
- issues typed failures the engine must handle: 401, 403, 429, 463, and delivery collapse
- **bans the virtual number** when the weighted signal crosses the documented threshold

Scenarios run in CI on `main`:

| Scenario | Assertion |
|---|---|
| Cold number, day-1 10k blast | Engine caps at the warmup ceiling; never banned |
| 10k campaign over a warmed number | Completes; never banned; never exceeds documented limits |
| Reconnect then burst | No flood after reconnect |
| Low-reply-ratio spiral | Engine brakes before the simulation downgrades quality |
| 5 workers, one sender | Shared budget respected; no double-spend |
| Timing distribution over 1,000 sends | Gaussian; no detectable fixed period |

The engine must trip **its own** circuit breakers before the simulation trips its ban
heuristics. If the simulation ever bans us, that is a build failure.

## Regression tests for prior defects

Every `M*` in `00-prior-art.md` gets a named regression test. The highest-value ones:

| Defect | Test |
|---|---|
| M7 empty-string dedup | Two blank-email contacts stay two contacts |
| M8 unnormalised phones | Five formats of one number resolve to one contact |
| M9 blind overwrite | Sparse re-import destroys nothing |
| M11 caps counted rounds | Cap counts messages, including agent replies |
| M12 send path bypass | No route or job can reach a provider except via the dispatcher |
| M13 in-process state | Multi-worker run produces correct shared-budget behaviour |
| M26 poison message | One unresolvable recipient does not affect the session or other sends |
| M31 context bleed | Two conversations with one contact stay separate |

## Preset and resource testing

- **E2E runs on all three presets** — `lean`, `standard`, and a paid-equivalent (LocalStack S3
  + KMS + SES, Keycloak OIDC). A test passing on one and failing on another means the
  abstraction leaked, and the build fails.
- **`lean` is the preset that must never break** — it is the default and what most self-hosters
  will run.
- **Resource budget as a test**: a CI job runs `lean` under a hard **2 GB memory limit** with a
  synthetic Solo-tier workload and fails on OOM or on exceeding the documented footprint by
  more than 20%. This keeps `19-capacity.md` honest and stops the default quietly growing past
  the box it promises to fit.

## Test data

**Synthetic only** (M19 — the old repo committed a real-looking candidate record with name,
mobile, DOB, address and salary). A fixture library builds orgs, contacts and conversations
deterministically from a seed, so failures reproduce exactly.

A deliberately hostile ingestion fixture is maintained as a first-class asset: mixed date
formats, `19 Year(s) 0 Month(s)`, lakh/crore salaries, duplicate emails, blank emails, phones
in five formats, non-UTF8 bytes, 50k rows.

## Gates

| Stage | Must pass |
|---|---|
| **PR** | lint (incl. the JSDoc rule) · typecheck · unit · contract · integration · API · Semgrep · gitleaks |
| **main** | + E2E on all presets · simulation · resource budget |
| **Release** | + load · chaos · restore drill · manual checklist |

## Coverage

≥80% on `core`, `ingestion`, `channels`. **100% on `antiban` and the dispatcher** (NFR-22) —
these are the components where a gap is a banned number or a duplicate send, not a bug report.

Coverage is a floor, not a goal. A PR that raises coverage while testing nothing meaningful is
a review failure.
