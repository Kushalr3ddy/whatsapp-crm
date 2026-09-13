# 15 · Public API

`https://<host>/api/v1`. OpenAPI 3.1 generated from the Zod schemas at
`/api/v1/openapi.json` — generated, so it cannot drift from the code (M22).

## Authentication

```http
Authorization: Bearer crm_live_a1b2c3...
```

API keys are hashed at rest, scoped, rotatable, rate-limited per key, with last-used tracking.
Session cookies exist **only** for the first-party UI and require CSRF tokens; they are not a
supported integration path.

Scopes: `contacts:read|write` · `conversations:read|write` · `messages:send` ·
`campaigns:read|write` · `templates:read|write` · `imports:write` · `senders:read|write` ·
`webhooks:manage` · `admin`.

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

## Resources

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

## Sending a message

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

Per key, returned on every response:
```
X-RateLimit-Limit / -Remaining / -Reset
```
`429` includes `Retry-After`. These are API limits, and are entirely separate from the
**message** rate limits in [`08-antiban.md`](08-antiban.md) — a caller can enqueue far faster
than the system will send, by design.

## SDK

A typed TypeScript client is generated from the OpenAPI spec and published per release. It
handles auth, retries, idempotency keys and pagination.

## Versioning

`/api/v1` is stable. Breaking changes go to `/api/v2`; the previous version is supported for
12 months after a successor ships. Additive changes — new fields, new endpoints, new enum
values — are **not** breaking, so clients must ignore unknown fields.
