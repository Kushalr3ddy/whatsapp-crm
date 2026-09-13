# F8 · Public API & webhooks

**Covers** FR-56…FR-62 · **Fixes** M15, M18, M22 · **Tier** V1

Full reference in **[`../15-api.md`](../15-api.md)**; integration walk-through in
**[`../16-integration-jobportal.md`](../16-integration-jobportal.md)**.

## Purpose

Make the CRM drivable by anything. This is the requirement that turns it from "a tool" into
"a module" — the job portal is the first consumer, but nothing about the API is specific to it.

## Design notes

**API-first is a testable claim, not a slogan:** the web UI uses only the public API. If the
UI can do something the API cannot, that is a bug.

**OpenAPI is generated from the Zod schemas**, so the spec cannot drift from the code (M22).

**No introspection endpoints.** The old system exposed the full database schema to any logged-in
user (M15). Admin surfaces are separately authorised and audited.

## Acceptance criteria

- **AC-1** Every UI capability has an API equivalent, asserted by a coverage check.
- **AC-2** API keys are hashed at rest, scoped, rotatable, with per-key rate limits and
  last-used tracking.
- **AC-3** OpenAPI 3.1 is generated at build time; a drift check fails CI.
- **AC-4** `Idempotency-Key` is required on every POST that sends or spends, and a replay
  returns the original result rather than repeating the action.
- **AC-5** Errors are RFC 7807 problem+json with stable machine-readable codes.
- **AC-6** Cursor pagination everywhere; no offset pagination on unbounded collections.
- **AC-7** Outbound webhooks are HMAC-SHA256 signed over the raw body with a timestamp and a
  replay window, delivered at-least-once with exponential backoff, with a delivery log,
  manual replay and a DLQ.
- **AC-8** Inbound provider webhooks verify signatures over **raw bytes**, enqueue, and return
  200 within 3 s (CON-4). No processing inline.
- **AC-9** CORS uses an explicit origin allowlist (M18).
- **AC-10** A typed SDK is generated and published alongside each release.
- **AC-11** A host app can delegate consent and contactability decisions via a policy endpoint,
  with a cached negative.

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-8.1 | Replay a POST with the same `Idempotency-Key` | Original result; no second send |
| TC-8.2 | API key with `contacts:read` calls `messages:write` | 403 with a stable error code |
| TC-8.3 | Revoked key | 401 immediately, no grace period |
| TC-8.4 | Webhook endpoint returns 500 five times | Backoff honoured, then DLQ; replayable |
| TC-8.5 | Tampered inbound signature | Rejected; nothing enqueued |
| TC-8.6 | Inbound webhook handler duration | p99 under 3 s under load (CON-4) |
| TC-8.7 | Duplicate `wamid` delivered twice | Second is a no-op at the DB constraint |
| TC-8.8 | Cross-org id in any path parameter | 404 for every endpoint (IDOR sweep) |
| TC-8.9 | OpenAPI spec vs implemented routes | No drift |
| TC-8.10 | Register a webhook pointing at a private IP | SSRF guard blocks it |
