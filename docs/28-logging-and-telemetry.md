# 28 · Logging and telemetry

What the system tells you about itself, where that goes, how to read it, and what it does **not**
yet tell you. Written to be read from zero: if a term is new, it is explained where it first
appears.

**The short version.** Today there is **logging** (every process writes structured log lines),
**health endpoints** (is it up, can it reach the database), and a good amount of **state kept in
the database** that doubles as a record of what happened. There are **no metrics, traces,
dashboards, error-tracking service or alerting**. That was a deliberate call on 2026-10-13: logging
is enough for now, telemetry is pinned as [D-56](21-deferred.md).

---

## 1 · Vocabulary

| Term | Meaning here |
|---|---|
| **Log line** | One event, written as one line of JSON, with a time, a level and a message. |
| **Level** | How serious. From quietest to loudest: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. The process prints that level and everything above it. |
| **Structured** | The extra detail is fields (`"senderId": "…"`) rather than text glued into the message, so it can be searched and filtered by a program. |
| **stdout** | "Standard output": where a program prints by default. Whatever runs the program (your terminal, Docker, a process manager) decides where that ends up. |
| **Telemetry** | The wider family: logs, **metrics** (numbers over time, such as queue depth), and **traces** (the path one request took across services). Only logs exist today. |
| **Request id** | A random id given to every API request, so one request's trail can be pulled out of busy traffic. |

---

## 2 · How logging is implemented

One library, [pino](https://getpino.io), configured in one place:
[`packages/shared/src/logger.ts`](../packages/shared/src/logger.ts). Every process builds its logger
with `createLogger(config)` and hands it to whatever needs one, so the format is identical
everywhere.

| Property | What it is | Why |
|---|---|---|
| **Format** | JSON, one object per line | Machines can parse it; `grep` and `jq` both work. |
| **Time** | ISO 8601 in **UTC** (`2026-10-13T14:05:44.946Z`) | Never shifted to local time. Localise when you display, never in the log. |
| **`service`** | Always `whatsapp-crm` | Lets a log tool group everything from this system. |
| **Level** | `LOG_LEVEL` in the environment, default `info` | One setting changes how chatty every process is. |
| **Redaction** | An allowlist of paths is replaced with `[redacted]` | See below. |
| **Pretty printing** | Only when `NODE_ENV=development` | Coloured, human-readable output while you work; real JSON everywhere else. |

An example line in production form:

```json
{"level":30,"time":"2026-10-13T14:05:44.946Z","service":"whatsapp-crm","messageId":"5a29…","providerMessageId":"fake-msg-x1-3","msg":"message sent"}
```

`level` is a number in the JSON: 30 = info, 40 = warn, 50 = error, 60 = fatal.

### What is redacted

These paths are replaced with `[redacted]` before a line is written, so a secret cannot leak into a
log by someone logging a whole object:

`req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.phone`,
`*.phone_e164`, `*.body_enc`, `*.value_enc`, `*.apiKey`

Two rules follow from that:

1. **Never log a message body, a credential or a key**, on purpose or by accident. Redaction is a
   safety net, not permission.
2. If you add a new sensitive field, add its path to that list in the same change.

### Request ids

Every API request gets an id. If the caller sends an `X-Request-Id` header it is kept, otherwise one
is generated. The id is:

- written on **every log line** for that request,
- returned to the caller in the **`x-request-id` response header**,
- included as `request_id` in the **body of every error response**.

So when a person reports "it said something went wrong", the id in that error is all you need to
find the whole story (section 5).

### What each process logs

| Process | Logs |
|---|---|
| **API** (`apps/api`) | One line per request and response (method, path, status, timing, request id), and `unhandled error` with the stack for any failure nothing caught. |
| **Gateway** (`apps/gateway`) | `message sent`; why a send is held (`send paced: …`, `sender not connected — leaving message queued`, `sender in recovery pause`, `sender quarantined`); link and unlink results and classified link failures; connection state changes; health and restriction transitions (`restriction state changed`); key rotation batches (`key rotation: re-encrypted a batch onto the current key`); `gateway ready` at boot. |
| **Web** (`apps/web`) | Next.js's own request log (route, status, time). Errors from the API are shown to the person and are in the API log. |

Levels in practice: `info` is normal events, `warn` is "something is being held back or refused but
the system is fine", `error` is "this operation failed and someone should look".

---

## 3 · Where the logs are stored

The honest answer is "nowhere durable by default". Each process writes to stdout; what happens next
depends on how you ran it:

| How it was started | Where the lines end up |
|---|---|
| `npm run dev:all` | The terminal, **and** the files `.dev-logs/api.log`, `.dev-logs/gateway.log`, `.dev-logs/web.log` in the repo (git-ignored). **Never rotated**, so they grow; delete them freely when the stack is stopped. |
| `npm run dev`, `npm run gateway`, `npm run web` separately | Only the terminal you ran each in. |
| `npm run verify` | `/tmp/crm-verify-<time>/` for that run: `stack.log`, `typecheck_+_lint_+_vitest.log`, `browser_suite_(playwright).log`, and so on. The path is printed at the top of the run and again on failure. |
| Docker or a process manager (deployment) | Whatever that tool captures from stdout. `docker logs <container>` for Docker. Nothing in this repo ships logs elsewhere. |

There is no log rotation, shipping or retention policy in the application. In a deployment, give the
container runtime or process manager one (Docker's `max-size` and `max-file` log options are the
simplest).

---

## 4 · How to use it

### Change how chatty it is

Set `LOG_LEVEL` in `.env` (or the deployment's environment) and restart the process:

```bash
LOG_LEVEL=debug     # more detail while investigating
LOG_LEVEL=warn      # only trouble
```

### Read a live log

```bash
tail -f .dev-logs/gateway.log          # follow the gateway
tail -f .dev-logs/api.log
```

### Find things

In development the files are pretty-printed (coloured text), so search for words and ids. In a
deployment the lines are JSON, so you can also filter on `"level":50` (errors) or pipe through `jq`.

```bash
# everything that went wrong in the gateway (development: pretty text)
grep ERROR .dev-logs/gateway.log
# the same on JSON output (deployment)
grep '"level":50' gateway.log | jq .

# one request's whole trail, from the id in an error response or the x-request-id header
grep 'THE-REQUEST-ID' .dev-logs/api.log

# why a particular message is waiting
grep 'THE-MESSAGE-ID' .dev-logs/gateway.log

# one number's health and restriction story
grep 'THE-SENDER-ID' .dev-logs/gateway.log
```

### Is it up?

```bash
curl localhost:3000/health     # {"status":"ok"}: the process is alive. Never touches the database.
curl localhost:3000/ready      # 200 {"status":"ready"} or 503: can it reach the database?
```

Use `/health` for "should this process be restarted" and `/ready` for "should traffic be sent to it".
They are different on purpose: a database hiccup should stop traffic, not kill a healthy process.

---

## 5 · The database is also a record

A lot of what happened is kept as data, which is often a better answer than a log line because it is
queryable, permanent and visible in the app.

| Question | Where the answer lives |
|---|---|
| **Who did what, and when?** | `audit_log`: sign-ins, assignments, overrides, exports, key rotation pause/verify. Append-only; the application role cannot edit or delete rows. |
| **Why is this message not sent yet?** | `message.hold_reason` (shown in the thread as "waiting: …"): `paced:per_minute`, `paced:warmup`, `sender_not_connected`, `recovery_pause:…`, `quarantined`, and so on. |
| **What has happened to this number's health?** | `sender_health_event` (also `GET /api/v1/senders/:id/health-events`): restriction suspected or cleared, possible bans, recoveries. The number's current score and evidence are on `sender_identity` (`risk_score`, `health`, `restriction_state`). |
| **How is a campaign doing?** | `campaign` and `campaign_recipient`: per-recipient status, and the reason a person was skipped (`skip_reason`). |
| **Where does a key rotation stand?** | The **Security** page, `npm run keys -- status`, and the `key_rotation_state` table. See [22 · Encryption](22-encryption.md). |
| **What tables exist, and what is each for?** | `npm run db:docs` writes a browsable map to `docs/generated/schema.html`. |

---

## 6 · Troubleshooting recipes

**"A message is stuck on waiting."**
1. Read its `hold_reason` (or the "waiting: …" under it in the thread).
2. `paced:*` means the anti-ban pacing is spacing it out, which is normal and clears by itself.
3. `sender_not_connected`: check the Numbers page. `quarantined` or `recovery_pause`: read the
   number's health events.
4. Confirm in the gateway log: `grep 'THE-MESSAGE-ID' .dev-logs/gateway.log`.

**"Someone got an error."**
Ask for the id in the error (`request_id`), then `grep` it in the API log. The stack for anything
unexpected is on the `unhandled error` line.

**"This number looks restricted."**
Open the Numbers page, then the health events for that number. Detail and runbook:
[27 · Silent-restriction tracking](27-restriction-tracking.md).

**"The app will not start."**
The API and the gateway print why and exit: database not migrated, schema ahead of the code, or
data encrypted with a key version that is not in the key ring. The message names the fix.

**"Tests or `verify` failed."**
Open the log folder named in the failure. The stage's own log has the detail, and `stack.log` is the
API, gateway and web together.

---

## 7 · What does not exist, and the plan

| Missing | Notes |
|---|---|
| **Metrics** (queue depth, sends and holds per minute, per-number risk) | Would be a `/metrics` endpoint. The setting `TELEMETRY_DRIVER=none\|prometheus\|otlp` reserves the names; nothing reads it yet. |
| **Traces** | Not needed at this size. The request id is the poor man's trace. |
| **Error tracking** (Sentry-style) | Waiting on a vendor choice. |
| **Alerting** | Tracked separately as [D-43](21-deferred.md). In-app restriction banners exist. |
| **Log rotation and shipping** | A deployment concern ([13 · Deployment](13-deployment.md)). |

All of this is pinned as **D-56** in [21 · Deferred decisions](21-deferred.md), to be picked up when
the real-number pilot starts (it is a week-long watch, and metrics are how you would see it), when a
hosted deployment exists, or after the first incident that logs alone cannot explain.

---

## 8 · Gotchas

- **Do not put a secret or a message body in a log**, even at `debug`. Redaction is a net, not a plan.
- **Times are UTC.** The Z at the end means UTC; the UI converts for display.
- **Dev logs are pretty, not JSON.** A script that expects JSON will not work on `NODE_ENV=development`
  output; use `NODE_ENV=production` or read the files by eye.
- **The `.dev-logs` files only exist when you used `dev:all`.** Running the processes separately
  prints to each terminal only.
- **`LOG_LEVEL` has no `silent`.** Tests build their logger directly to silence it; the config accepts
  `trace` through `fatal`.
