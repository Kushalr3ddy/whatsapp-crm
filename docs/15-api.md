# 15 · Public API

`https://<host>/api/v1`.

⬜ **There is no OpenAPI spec yet, and no `/api/v1/openapi.json`.** The intent is to generate
OpenAPI 3.1 from the Zod schemas that already validate every request body, so the spec cannot
drift from the code the way a hand-written one does (M22) — but none of that is built. Until it
is, **this document and [`24 · Testing it by hand`](24-local-testing.md) are the API
documentation**, and `What exists today` below is the part of this page that is true right now.
The rest describes the intended surface.

## Authentication

```http
Authorization: Bearer crm_live_a1b2c3...
```

API keys are hashed at rest, scoped, revocable, with last-used tracking. Session cookies exist
**only** for the first-party UI and require CSRF; they are not a supported integration path.

**Three kinds of credential**, and the difference matters:

| Credential | Who | Reaches |
|---|---|---|
| **Per-org API key** (`crm_live_…`) | integrations | everything its scopes allow, in its own org |
| **Session cookie** | a signed-in person | everything their role allows, in their org |
| **`API_KEY` from `.env`** | the deployment itself | **provisioning only** — create an org, mint its first key. Refused on every data route |

That last row is the important one. A single shared secret with full read/write over every org
is the hole per-org keys exist to close, so the bootstrap key cannot read a message or a
contact. It exists to solve the chicken-and-egg problem of a brand-new deployment having no
organisation and therefore no key.

Keys are resolved to their own org. Nothing is inferred: an earlier version ran
`SELECT id FROM org LIMIT 2` and refused with `409 MULTIPLE_ORGS` the moment a second
organisation existed, because a config-level key could not say which tenant it meant.

**Scopes implemented today:** `contacts:read|write` · `conversations:read|write` ·
`messages:send` · `senders:read|write`. An unknown scope is rejected when the key is issued,
rather than silently granting nothing. Campaigns ride on these — create/start/pause/cancel need
`messages:send`, reading them `conversations:read`; imports and segments use `contacts:*`. ⬜ Not yet
their own scopes: `campaigns:*`, `templates:*`, `imports:write`, `webhooks:manage`, `admin`.

**Rate limiting is enforced per key** — `rate_limit_per_min` (default 120) is counted per API key and
login attempts are throttled with progressive lockout — but both counters are in-process, so with several
replicas the effective ceiling is the limit times the replica count (the shared limiter is P9).

## Conventions

| | |
|---|---|
| Pagination | Cursor. `?limit=50&cursor=...` → `{ data, next_cursor }`. No offset paging on unbounded collections. |
| Idempotency | `Idempotency-Key` **required** on every POST that sends or spends. A replay returns the original result rather than repeating the action. |
| Errors | RFC 7807 problem+json with a stable machine-readable `code` |
| Request id | `X-Request-Id` accepted and echoed; present in every log line |
| Time | RFC3339 UTC |
| Money | integer micros + ISO currency |
| Expansion | `?expand=contact,template` |
| Sparse fields | `?fields=id,display_name` |

### Error shape

```json
{
  "type": "https://docs/errors/send-window-expired",
  "title": "Freeform send not permitted",
  "status": 422,
  "code": "SEND_WINDOW_EXPIRED",
  "detail": "The 24-hour service window closed at 2026-09-13T04:12:00Z. Use a template.",
  "request_id": "01J8...",
  "meta": { "window_expires_at": "2026-09-13T04:12:00Z" }
}
```

Branch on `code`, never on `detail`.

## What exists today

**About fifty endpoints, plus two unauthenticated health checks.** Everything marked ⬜ elsewhere in this
document (templates, webhooks, policy delegation, the SDK, OpenAPI) is design, not implementation. The
`Resources` list further down is the *intended* surface; the table below is what actually exists. The
`Sending a message` example later shows the shape the send body will take once the dispatcher exists,
**not** what the endpoint accepts now.

| Area | Method · path | Notes |
|---|---|---|
| Health | `GET /health` · `GET /ready` | No auth. `/ready` also checks Postgres |
| Auth | `POST /api/v1/auth/login` · `/logout` · `GET /auth/me` | Session + CSRF cookies; `me` says who the caller is |
| Admin | `POST /admin/orgs` · `POST/GET/DELETE /admin/keys` · `POST /admin/users` | `orgs` is bootstrap-key only; the rest an admin session |
| Senders | `GET/POST /senders` · `POST/GET /senders/:id/link` · `POST /senders/:id/unlink` | Live connection state, health evidence, recovery state; link by QR or pairing code |
| Inbox | `GET /conversations` (filters) · `GET/PATCH /conversations/:id` · `POST /conversations/:id/read` | Status, assignee, unread |
| | `GET /conversations/:id/messages` | Bodies decrypted for display; carries `media` and `mediaUnavailable` |
| | `GET/POST /conversations/:id/notes` | Team-only; never transmitted |
| | `GET/POST /canned-replies` · `GET /users` | Saved replies; org members for the assignee picker |
| Sending | `POST /messages` | **`{to \| conversationId, body, senderId?}`** → 202 (queued, not sent) |
| | `POST /conversations/:id/attachments` | **Raw file body** + `?filename=&caption=` → 202. Type decided from the bytes; HTML/unknown → 415; over 16 MB → 413 |
| Media | `GET /media/:id` | Streams one attachment, always as a download |
| Contacts | `GET/POST /contacts` | Search by name/phone/email; create with `externalRef`; 409 on a duplicate |
| | `POST /contacts/:id/tags` · `DELETE /contacts/:id/tags/:tagId` | Attach/detach |
| Tags | `GET/POST /tags` · `DELETE /tags/:id` | Name unique per org; counts on the list |
| Segments | `GET/POST /segments` · `POST /segments/preview` · `DELETE /segments/:id` | Saved criteria-based audiences, live count |
| Import | `GET /imports` · `POST /imports` · `POST /imports/:id/run` · `GET /imports/:id` | Upload (`?force=true` to re-import) → dry run → commit |
| Campaigns | `GET/POST /campaigns` · `GET /campaigns/:id` | Create a **draft** (sends nothing); detail with progress |
| | `POST /campaigns/:id/start` · `/pause` · `/cancel` | Start freezes the audience and returns a forecast; pause is instant |
| | `GET /campaigns/:id/preview` · `GET /campaigns/:id/recipients` | Dry run before start; per-recipient results |

All paths are under `/api/v1` except the health checks.

**Rate limiting.** Every API-key request is counted against that key's `rate_limit_per_min`
(default 120, settable when minting it, `0` for unlimited). Over the ceiling returns **429
`RATE_LIMITED`** with `Retry-After`, and every response carries `RateLimit-Limit` and
`RateLimit-Remaining`. Sessions are not limited this way — the login route has its own throttle.
Both counters are currently in-process, so with several replicas the effective ceiling is the
limit times the replica count (P9).

**A malformed id is a 422, not a 404.** Path parameters are validated before they reach the
database. Well-formed-but-absent stays 404, because that answer must be indistinguishable from
another tenant's resource; a malformed id cannot name a row in any tenant, so saying so leaks
nothing.

**Cookie-authenticated writes need CSRF.** Echo the readable `crm_csrf` cookie back in an
`x-csrf-token` header on any non-GET request authenticated by cookie. API-key requests need
none of this: an `Authorization` header is never sent automatically by a browser, which is the
entire attack being defended against.

**The send body today is flat**, not the nested form further down this page:

```http
POST /api/v1/messages
Authorization: Bearer <API_KEY>

{ "to": "+919876543210", "body": "hello" }
```

It returns **202**, not 201 — accepted for sending, not sent. There is no `Idempotency-Key`
support, no `intent`, no template rendering and no dispatcher yet; the caller's message is
queued and the gateway sends it.

### Attachments

A message that arrived with a file carries it on the thread response:

```json
{
  "id": "…", "direction": "inbound", "contentType": "document", "body": "",
  "media": {
    "id": "0b16afdb-…",
    "url": "/api/v1/media/0b16afdb-…",
    "contentType": "application/pdf",
    "sizeBytes": 184320,
    "filename": "Priya Sharma CV.pdf"
  },
  "mediaUnavailable": false
}
```

`media` is null when there is no file. **`mediaUnavailable` is true when there was one and it
could not be fetched** — WhatsApp expires media, and a message whose attachment failed to
download is kept rather than lost, so a client can say so instead of showing an empty bubble.

`GET /api/v1/media/:id` streams the bytes. It needs the same `conversations:read` scope as the
thread, and four things about the response are deliberate and will not change:

- **`Content-Disposition: attachment`, always.** Nothing is ever served inline, images
  included. A file that slips past type detection still cannot execute.
- **`Content-Type` comes from the file's magic bytes**, decided when it was stored — never
  from its name or from what the sender's client declared. Unrecognised files are
  `application/octet-stream`.
- **`X-Content-Type-Options: nosniff`**, so the browser cannot overrule that.
- **`Cache-Control: private, no-store`.** Attachments are personal data; no shared cache and
  no browser disk cache keeps a copy.

There is **no signed URL and no public path**, on purpose. Every request resolves
file → message → conversation → org through the database, because row-level security protects
the row and cannot reach the bytes — a URL that granted access on its own would route around
the only check there is. Another tenant's attachment answers **404**, not 403: saying
"forbidden" would confirm the file exists.

Each download is recorded in the audit log as `media.downloaded`, and opening a thread as
`conversation.read` (`docs/21-deferred.md`, D-13).

### Campaigns send at the ceiling, not on demand

`POST /campaigns/:id/start` **queues nothing**. It freezes the audience into
`campaign_recipient` rows, and the gateway converts those into messages only as fast as that
sender's remaining daily allowance permits — so the response includes a forecast:

```json
{ "status": "running",
  "progress": { "total": 5000, "pending": 4999, "skipped": 1 },
  "outlook": { "remaining": 4999, "allowanceToday": 117, "daysToFinish": 42,
               "inWarmup": true } }
```

**Read `daysToFinish` before you start.** A large campaign on a number that is days old is a
months-long proposition, because the warmup ramp is a hard ceiling nothing can raise
(`docs/08-antiban.md`). Recipients with no phone number come back as `skipped` with a reason
rather than quietly reducing the total.

Worked examples with real responses, including every failure case, are in
[Trying it by hand](#trying-it-by-hand-insomnia-postman-curl) at the end of this document.

---

## Endpoints added since the first slice (2026-10)

All under `/api/v1`, all tenant-scoped. "admin" means a signed-in admin session (an API key never
qualifies). Errors use the problem shape above.

| Method · path | Scope / role | What it does |
|---|---|---|
| `GET /contacts/count?q=&tag=` | `contacts:read` | How many contacts match a search / tag filter — the number a bulk action would touch |
| `GET /contacts/export?format=csv\|vcf` | admin | Streams every contact (CSV for a spreadsheet, vCard for a phone). Audited; 5 per hour |
| `PUT /contacts/:id/do-not-contact` | `contacts:write` | `{ value, reason? }` — flags or clears do-not-contact. Audited |
| `PUT /contacts/:id/custom-fields` | `contacts:write` | `{ values: { key: value \| null } }` — set/clear custom field values, validated against the org's definitions |
| `GET/POST /custom-fields`, `DELETE /custom-fields/:key` | read / admin | The org's typed field vocabulary (`text`, `number`, `date`, `select`); removing one clears it from every contact |
| `POST /tags/:id/bulk` | `contacts:write` (`all` = admin) | `{ action: add\|remove, target: all\|search\|segment\|ids, dryRun (default true), expectedCount? }` — set-based, idempotent, previews first, `409 COUNT_CHANGED` if the audience moved |
| `POST /imports/:id/run` | `contacts:write` | Now takes `tag: { id } \| { name }` — tags everyone the run created/updated, atomically with the commit |
| `POST /messages` | `messages:send` | Now `422 DO_NOT_CONTACT` for a flagged contact unless an admin sends `overrideDnc: true` + `overrideReason` |
| `POST /conversations/:id/attachments` | `messages:send` | Raw-body file upload (≤ 16 MB; type decided from the bytes); `422` for a flagged contact |
| `GET /conversations/:id/sender-status` | `conversations:read` | `{ canSend, reason, connectionState, restrictionState }` for the number behind a thread — drives the composer lock |
| `POST /campaigns/:id/start` | `messages:send` | Optional `overrideGates: [dnc\|engagement\|cooldown\|duplicate_campaign]` + `reason` (admin only, audited) |
| `GET /campaigns/:id` | `conversations:read` | Now includes `gateOverrides`, `gateOverrideReason`, `pauseReason` |
| `POST /senders/:id/enforcement` | admin | `{ mode: enforce\|advisory, reason }` — advisory mode (D-29); audited |
| `GET /senders/:id/health-events` | `senders:read` | The number's health timeline (restrictions raised/cleared, possible bans), newest first |
| `GET /senders` | `senders:read` | Now includes `enforcement`, `advisory*`, `restrictionState`, `restrictionSince` |
| `POST /segments` | `contacts:write` | Now takes `saved` (default `true`); `false` makes a one-off inline audience that is not listed |
| `PATCH /campaigns/:id` | `messages:send` | `{ name?, body? }`, only while the campaign is a draft or paused (`409 NOT_EDITABLE` otherwise) |
| `GET/PUT /ai/settings` | admin (session) | The AI assistant's switch, instructions, daily message limit, `mayStartCampaigns`, consent. `PUT` refuses to switch on until `acceptConsent` has been sent once (`422 AI_RULE`); creates the assistant's user the first time |
| `GET /ai/status` | `conversations:read` | `{ enabled }`, so screens know whether to offer the helpers |
| `POST /ai/jobs` | `messages:send` (`command` = admin session or API key) | `{ kind: command\|draft, input }` puts a request in the AI queue; `202 { id }`. `429 QUEUE_FULL` at 20 waiting |
| `GET /ai/jobs` | `messages:send` | The queue: waiting (with `position`), running, and the last 24 h. Admins and API keys see everyone's; anyone else only their own |
| `POST /ai/jobs/:id/cancel` | `messages:send` | Cancels a **queued** request (`409 NOT_QUEUED` once started) |
| `POST /ai/commands` | admin session or `messages:send` key | The same instruction run inline (waits for the model): `{ instruction }` returns `{ message, actions[] }`. Tools: create/pause/resume/edit campaign, `send_message`. Never lifts a gate; starts a campaign only if the org allows it |
| `POST /ai/draft-campaign-text` | `messages:send` | `{ goal }` returns `{ body }`: wording for the campaign form. Creates and sends nothing |
| `GET /ai/conversations/:id/notice` | `conversations:read` | Why the assistant is stuck on a chat (`held`, `do_not_contact`, `daily_cap`, `model_error`), or `null` |
| `POST /ai/conversations/:id/allow-reply` | admin (session) | `{ reason }` (10+ chars): lets the assistant answer the contact's latest message although they are do-not-contact. One reply; audited |

---

## Resources — the intended surface

⬜ **Almost none of this is built.** Kept as the target shape so the pieces that do land fit
together. Compare against the table above before writing a client.

```
/contacts            /contacts/{id}/identities   /contacts/merge
/segments            /tags                       /fields
/conversations       /conversations/{id}/messages   /conversations/{id}/notes
/messages            /templates                  /campaigns
/campaigns/{id}/{dry-run|launch|pause|resume|cancel|recipients|metrics}
/sequences           /automation-rules
/senders             /senders/{id}/{link|reconnect|health}
/sources             /imports                    /imports/{id}/{rows|errors}
/webhooks            /webhooks/{id}/deliveries
/events              /admin/providers
```

## Sending a message — the intended shape

⬜ **Not what the endpoint accepts today.** The current body is `{to, body, senderId?}`; see
[What exists today](#what-exists-today). This section describes where it is going, and
specifically what the caller will *not* be allowed to choose.

```http
POST /api/v1/messages
Idempotency-Key: 8f1e...

{
  "to":     { "kind": "phone", "value": "+919876543210" },
  "intent": "transactional",
  "content":{ "template": { "key": "order_shipped", "variables": { "order_id": "A123" } } }
}
```

Note what the caller does **not** choose: the sender identity, the provider, or whether this
goes out as a template or freeform. The dispatcher decides all three from intent, provider
capabilities, sender health, cost rules and the conversation's service window
([`04-architecture.md`](04-architecture.md)). A caller that could pick its own provider could
bypass the anti-ban engine, so it cannot.

A blocked send returns **200 with an explicit outcome**, not an error — blocked recipients are
reported, never silently dropped:

```json
{ "status": "blocked", "reason": "consent_missing", "contact_id": "01J8..." }
```

## Webhooks

⬜ **Not built.** No webhook tables, routes or delivery worker exist yet (P9).

Subscribe to: `message.received` · `message.status_changed` · `conversation.assigned` ·
`contact.created` · `contact.updated` · `campaign.completed` · `import.completed` ·
`sender.health_changed`.

```http
POST https://your-app/hooks/crm
X-CRM-Signature: sha256=<hex>
X-CRM-Timestamp: 1757740000
X-CRM-Delivery: 01J8...
```

**Verify over the raw request body**, before any JSON parsing. Verifying a re-serialised object
silently fails — the single most common integration mistake:

```js
/** Verifies a CRM webhook. `raw` MUST be the unparsed request body. */
function verify(raw, signature, timestamp, secret) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay window
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(`${timestamp}.`).update(raw).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Delivery is **at-least-once** with exponential backoff. Deduplicate on `X-CRM-Delivery`.
Failures land in a DLQ and are replayable from the delivery log.

## Policy delegation

⬜ **Not built.** Requires the per-key scopes in `api_key`, which is also unbuilt (P2).

A host application that owns consent and contactability registers a policy endpoint. The CRM
calls it before sends and caches the **negative** result:

```http
POST https://your-app/crm-policy/may-contact
{ "external_ref": {"system":"portal","id":"cand_123"}, "intent": "marketing" }

→ { "allowed": false, "reason": "no_consent_on_file", "cache_seconds": 3600 }
```

This keeps the rule in the system that owns it — the CRM asks, it never joins.
See [`16-integration-jobportal.md`](16-integration-jobportal.md).

## Rate limits

✅ **Per key** — `rate_limit_per_min`, enforced, with `Retry-After` and `RateLimit-*` headers.
In-process for now, so several replicas each count separately (P9).

✅ **In the send path** — the gateway paces every outbound message: warmup ramp, per
minute/hour/day ceilings, and a jittered pause. A paced message stays queued rather than
failing, so **a 202 from this API means accepted, not imminent** — a large batch drains over
hours by design (`docs/08-antiban.md`).

⬜ **Per org** — not built. The remaining gap is one org's several keys or senders adding up
to more traffic than any single ceiling allows.

Per key, returned on every response:
```
X-RateLimit-Limit / -Remaining / -Reset
```
`429` includes `Retry-After`. These are API limits, and are entirely separate from the
**message** rate limits in [`08-antiban.md`](08-antiban.md) — a caller can enqueue far faster
than the system will send, by design.

## SDK

⬜ **Not built** (P9).

A typed TypeScript client is generated from the OpenAPI spec and published per release. It
handles auth, retries, idempotency keys and pagination.

## Versioning

`/api/v1` is stable. Breaking changes go to `/api/v2`; the previous version is supported for
12 months after a successor ships. Additive changes — new fields, new endpoints, new enum
values — are **not** breaking, so clients must ignore unknown fields.

---

## Trying it by hand (Insomnia, Postman, curl)

A walk through everything that is actually implemented today, in an order that builds on
itself. Every request below was run against a live server before being written down, and the
responses are the real ones.

**Setup.** Start the API with `npm run dev`. In Insomnia create an environment with:

```json
{
  "base": "http://localhost:3000",
  "key": "<the API_KEY value from your .env>"
}
```

Then set a **folder-level** Bearer auth of `{{ key }}` so every request inherits it, rather
than pasting the header into each one. Requests 1–2 and 3 deliberately need it absent.

### Liveness — no authentication

| # | Request | Expect |
|---|---|---|
| 1 | `GET {{base}}/health` | `200` · `{"status":"ok"}` |
| 2 | `GET {{base}}/ready` | `200` · `{"status":"ready","checks":{"database":"ok"},...}` — this one touches Postgres, so it fails if the database is down while `/health` still passes |

### Authentication

| # | Request | Expect |
|---|---|---|
| 3 | `GET {{base}}/api/v1/senders` with **no** Authorization header | `401` · code `UNAUTHORIZED` |
| 4 | Same, with `Authorization: Bearer wrong-key` | `401` · the same `code` and `detail` as #3 — only `request_id` differs |
| 5 | Same, with the real key | `200` · `{"data":[...]}` |

#3 and #4 being indistinguishable is deliberate — an error that distinguished "no key" from
"wrong key" would confirm to an attacker that their key *format* was right.

### Reading

| # | Request | Expect |
|---|---|---|
| 6 | `GET {{base}}/api/v1/conversations` | `200` · each row carries `contactPhone`, which is what a reply is addressed to |
| 7 | `GET {{base}}/api/v1/conversations/{{id}}/messages` | `200` · `body` is **decrypted for display**; `undecryptable: true` would mean the encryption key changed |
| 8 | Same with an unknown but well-formed UUID | `200` · `{"data":[]}` |

### Validation — none of these write anything

| # | Body to `POST {{base}}/api/v1/messages` | Expect |
|---|---|---|
| 9 | `{"to":"1111111111","body":"hi"}` | `422` · `PHONE_INVALID_FOR_COUNTRY`. Junk that the default libphonenumber metadata would have **accepted** — this is the `max` bundle earning its size |
| 10 | `{"to":"+911123456789","body":"hi"}` | `422` · `NOT_REACHABLE` — *"looks like a fixed_line number"*. A landline cannot receive WhatsApp, and a doomed send would cost the sender's delivery ratio |
| 11 | `{"to":"+919380727007","body":""}` | `422` · `VALIDATION_FAILED` · `body: String must contain at least 1 character(s)` |
| 12 | `GET {{base}}/api/v1/nope` | `404` · `NOT_FOUND` naming the method and path |

### Senders and linking

| # | Request | Expect |
|---|---|---|
| 13 | `POST {{base}}/api/v1/senders` · `{"label":""}` | `422` · `VALIDATION_FAILED` |
| 14 | `POST {{base}}/api/v1/senders` · `{"label":"my number"}` | `201` · status is **`linking`**, not active — a sender exists before it is connected |
| 15 | `POST {{base}}/api/v1/senders/{{senderId}}/link` · `{"mode":"qr"}` | `202` with a `poll` URL. **Asynchronous by necessity** — the socket lives in the gateway process, not here |
| 16 | `GET {{base}}/api/v1/senders/{{senderId}}/link` | With the gateway **down**: `state: "pending"`, `challenge: null`. With `npm run gateway` running: the real QR string, starting `2@…`, which you render and scan |

Delete any sender you create this way — there is no `DELETE` endpoint yet, so it is a row in
`sender_identity` plus one in `channel_session`.

### Sending, for real

`POST {{base}}/api/v1/messages` with `{"to":"+91…","body":"hello"}` returns **`202`, not `201`** —
accepted for sending, not sent. The gateway decides when it actually goes. Poll request #7 and
watch `status` move `queued → sent → delivered → read`.

With no number linked it returns `409 NO_ACTIVE_SENDER`, and the message is **not** queued.

### Formerly rough edges — now fixed

Both were recorded here as known bugs and have since been fixed:

- **A malformed UUID now returns `422`, not `500`.** Path parameters are validated before they
  reach Postgres, so a bad id is a clean validation error rather than an `INTERNAL_ERROR`.
- **Problem bodies now carry the real HTTP status.** The `problem()` helper no longer emits
  `"status": 0`; `body.status` matches the HTTP status line, as RFC 7807 requires.
