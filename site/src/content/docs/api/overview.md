---
title: Overview and sign-in
description: How to sign in to the API with a key, what a scope is, the error format, and what is not built yet.
---

Everything the web app does goes through an HTTP API under `/api/v1`. You can call the same API from your own tools. The full list of endpoints is on the [endpoint reference](../endpoints/) page; this page covers how to sign in and what to expect.

## Sign in with an API key

An API key belongs to one organisation and carries **scopes**, the only things it may do. Create one on the server:

```bash
npm run admin -- key --org <org-id> --name "my tool" --scopes messages:send,contacts:read
```

The secret (it starts with `crm_live_`) is shown **once**. Send it on every request:

```bash
curl https://your-crm.example.com/api/v1/auth/me \
  -H "Authorization: Bearer crm_live_xxxxxxxx"
```

`auth/me` tells you who the key is and what it can do. A missing or wrong key always returns the same `401`, so an attacker cannot tell which part was wrong.

## Three kinds of credential

| Credential | For | Reaches |
|---|---|---|
| **Per-organisation API key** | Your integrations | Whatever its scopes allow, in its own organisation only |
| **Session cookie** | A person signed in to the web app | Whatever their role allows. Writes also need a CSRF header. Not meant as an integration path |
| **Bootstrap key** (`API_KEY` in the settings) | The deployment itself | **Only** creating an organisation and its first key. It is refused on every data route |

## Scopes

`contacts:read`, `contacts:write`, `conversations:read`, `conversations:write`, `messages:send`, `senders:read`, `senders:write`. An unknown scope is rejected when the key is created, so a typo cannot silently grant nothing. Campaigns use these: creating, starting, pausing and cancelling need `messages:send`; reading them needs `conversations:read`.

## Limits

- **Per key:** a requests-per-minute limit (default 120). Going over returns `429` with `Retry-After`.
- **Sending is paced separately.** A send request returns **`202 Accepted`**, which means "queued", not "sent". The gateway releases it according to the number's warm-up and pacing rules, so a large batch can take hours. See [Warm-up and sending pace](../../concepts/warm-up/).

## Errors

Errors follow the problem-details format (`application/problem+json`) with a stable machine-readable `code`. **Branch on `code`, never on `detail`.**

```json
{
  "type": "https://docs/errors/send-window-expired",
  "title": "Freeform send not permitted",
  "status": 422,
  "code": "SEND_WINDOW_EXPIRED",
  "detail": "The 24-hour service window closed. Use a template.",
  "request_id": "01J8..."
}
```

Send an `X-Request-Id` header and it is echoed back and appears in the server logs.

## What is not built yet

:::caution
- **Webhooks** (the CRM calling your server when a message arrives or a status changes). Today you poll.
- **An OpenAPI file, a Swagger page and a typed SDK.**
- **An idempotency key on sends,** so a retried request can send twice.
- **A "send to this number" call.** Send into an existing conversation, or use a campaign.
:::
