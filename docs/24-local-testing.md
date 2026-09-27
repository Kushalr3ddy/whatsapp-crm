# 24 · Testing it by hand, locally

How to start this on one machine and prove to yourself that it works. Everything here has been
run as written.

For *what to test and why*, read [`12 · Testing strategy`](12-testing.md). This is the
mechanical companion to it: the commands, in order.

---

## Start everything

```bash
npm run dev:all
```

That starts the database, applies migrations, then runs all three processes and streams their
logs into one terminal. **Ctrl-C stops everything it started.** Postgres is left running on
purpose — it holds linked WhatsApp credentials in a named volume, and stopping it is a separate
decision (`npm run db:dev:down`).

| | | |
|---|---|---|
| api | `:3000` | the HTTP API |
| gateway | — | owns the WhatsApp sockets. **Nothing sends or receives without it** |
| web | `:3001` | the UI |

Flags: `--no-web` (skip Next, much faster) and `--no-gateway` (no WhatsApp connection at all —
right for testing the API alone).

Prefer three terminals? `npm run dev`, `npm run gateway`, `npm run web`. The script only removes
the need for them; the processes stay separate for the reason in
[`04 · Architecture`](04-architecture.md) — restarting the API must never drop a socket.

### Check it came up

```bash
curl -s localhost:3000/health          # {"status":"ok"} — process is alive
curl -s localhost:3000/ready           # also checks Postgres
```

**Read the `rls:` line the script prints.** It comes from the API's startup log and says whether
row-level security is actually enforcing anything:

```
rls: tenant requests will run as a restricted role, so row-level security applies to them
```

If instead it says RLS is **not** enforced, tenant isolation is resting entirely on the
`WHERE org_id` in each query, with no second layer ([`09 · Security`](09-security.md)).

---

## Get a credential

Everything below `/api/v1` needs one. There are two kinds and they are not interchangeable.

The **bootstrap key** is `API_KEY` in `.env`. It provisions and nothing else — it is refused on
every data route, deliberately, because one shared secret with full data access is the hole that
per-org keys exist to close.

```bash
BOOT=$(grep -E '^API_KEY=' .env | cut -d= -f2-)
ORG=$(npm run --silent admin -- whoami | awk '/^  [0-9a-f-]{36}/{print $1; exit}')

curl -s -X POST localhost:3000/api/v1/admin/keys \
  -H "Authorization: Bearer $BOOT" -H 'Content-Type: application/json' \
  -d "{\"orgId\":\"$ORG\",\"name\":\"local testing\",
       \"scopes\":[\"conversations:read\",\"conversations:write\",\"messages:send\",\"senders:read\",\"senders:write\"]}"
```

The secret comes back **once** and is never stored in a form anyone can read back. Keep it in a
shell variable for the rest of the session:

```bash
KEY=crm_live_…
```

No organisation yet? `npm run admin -- org --name "…" --slug … --email you@example.com` creates
one with its first admin, and prints a generated password.

---

## Or use Insomnia

`tools/insomnia-collection.json` imports as a collection with everything below already set up —
the inbox group (filters, assignment, notes, canned replies), the refusals that must stay refused
(401, 403, 422, 404) and a group for exercising the pacing gate. Fill in `base_url`,
`bootstrap_key`, `org_key` in the environment, plus `conversation_id` and `user_id` for the inbox
requests. The key minted by "mint an org key" now carries `conversations:write`, which the
assignment, notes and canned-reply writes need.

**The pacing group queues real messages.** With the gateway running and a number linked they
are actually sent, so point `test_recipient` at a number you control.

## Exercise the API

```bash
# who am I, and what am I allowed to do
curl -s localhost:3000/api/v1/auth/me -H "Authorization: Bearer $KEY"

# the inbox
curl -s localhost:3000/api/v1/conversations -H "Authorization: Bearer $KEY"

# one thread, bodies decrypted for display
curl -s localhost:3000/api/v1/conversations/<id>/messages -H "Authorization: Bearer $KEY"

# queue a message — 202, not 201: accepted for sending, not sent
curl -s -X POST localhost:3000/api/v1/messages \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"to":"+91…","body":"hello"}'
```

Sending needs a **linked number and a running gateway**. Without the gateway the message sits at
`status = queued` forever, which is the correct behaviour and a common source of confusion.

Worth trying because the answers are deliberate:

```bash
# the bootstrap key on a data route — 403, on purpose
curl -s localhost:3000/api/v1/conversations -H "Authorization: Bearer $BOOT"

# no credential — 401, with a message identical to a wrong credential's
curl -s localhost:3000/api/v1/conversations
```

---

## Inbox: filters, assignment, notes, canned replies (P4)

The shared-inbox slice. All the writes here need the **`conversations:write`** scope (already in
the key minted above).

### Filters and members

```bash
# filter the list: assignee = me | unassigned | <user-id>, status = open | closed
curl -s "localhost:3000/api/v1/conversations?status=open&assignee=unassigned" \
  -H "Authorization: Bearer $KEY"

# org members, for the assignee picker
curl -s localhost:3000/api/v1/users -H "Authorization: Bearer $KEY"
```

`assignee=me` needs a signed-in user, so with a **key** it is a 422 — a key has no identity.

### Assign and resolve

```bash
CONV=<conversation-id>
USER=$(curl -s localhost:3000/api/v1/users -H "Authorization: Bearer $KEY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')

# assign  ·  resolve/close  ·  unassign (explicit null)
curl -s -X PATCH localhost:3000/api/v1/conversations/$CONV \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"assigneeUserId\":\"$USER\"}"
curl -s -X PATCH localhost:3000/api/v1/conversations/$CONV \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"status":"closed"}'
curl -s -X PATCH localhost:3000/api/v1/conversations/$CONV \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"assigneeUserId":null}'
```

Deliberate refusals: an empty body is **422**; a `assigneeUserId` who is not an org member is
**422 `NOT_A_MEMBER`**; another tenant's conversation is **404**. Each change that actually moves
writes an audit row (`conversation.assigned`, `conversation.status_changed`).

### Open a thread, and mark it read

```bash
# fetch one conversation by id — works even for a thread past the recent-100 list
curl -s localhost:3000/api/v1/conversations/$CONV -H "Authorization: Bearer $KEY"

# clear the unread badge explicitly (opening the thread's messages also does it)
curl -s -X POST localhost:3000/api/v1/conversations/$CONV/read -H "Authorization: Bearer $KEY"
```

`unread_count` rises on every inbound and is reset by reading the thread — before this it only
ever grew. Another tenant's id is a **404**; a malformed id is a **422**.

### Internal notes

```bash
# add a note — never sent to the contact; it lives in internal_note, not message
curl -s -X POST localhost:3000/api/v1/conversations/$CONV/notes \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"body":"called, sending CV tomorrow"}'

# list a thread's notes
curl -s localhost:3000/api/v1/conversations/$CONV/notes -H "Authorization: Bearer $KEY"
```

The guarantee worth checking: after adding a note, the **messages** endpoint is unchanged — a
note never appears there, so it can never be sent (F3 AC-4).

```bash
curl -s localhost:3000/api/v1/conversations/$CONV/messages -H "Authorization: Bearer $KEY"
```

### Canned replies

```bash
# create one — shortcut is unique per org, so a repeat is 409 SHORTCUT_TAKEN
curl -s -X POST localhost:3000/api/v1/canned-replies \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"shortcut":"greet","body":"Hi {{name}}, thanks for reaching out."}'

curl -s localhost:3000/api/v1/canned-replies -H "Authorization: Bearer $KEY"
```

`{{name}}` is substituted from the contact when the reply is inserted in the composer, not on
the server.

### The thread lock

A thread assigned to one agent can only be replied to by that agent until they resolve or
reassign it — a light stand-in for presence/collision (parked as **D-17**). It applies to
**signed-in agents only**: an admin overrides it, and an **API key is exempt** (an integration is
not a person claiming a thread), so it **cannot be exercised with a bearer key** — a key's reply
always succeeds. To see the 409, sign in as a non-admin agent in the web UI and open a thread
assigned to someone else; the composer disables Reply and offers a note instead. It is covered by
`tests/integration/thread-lock.test.ts`.

---

## Attachments

Media arrives through the gateway: a file is re-downloaded through the socket that received it,
typed from its **magic bytes**, stored under an unguessable key, and served back only through
an authenticated route.

There is deliberate test data in the dev database for exactly this —
`[TEST DATA - DO NOT TOUCH] media demo +919999000001`, with two `[TEST]`-prefixed attachments.
Find one:

```bash
npm run db:query "SELECT id, filename, content_type FROM media_asset"
```

Then fetch it and **look at the headers, not the bytes** — the headers are the security:

```bash
curl -s -D - -o /tmp/got.bin localhost:3000/api/v1/media/<id> -H "Authorization: Bearer $KEY" \
  | grep -iE 'HTTP|content-type|content-disposition|x-content-type|cache-control'
```

Every response must show all four:

| Header | Must be | Why |
|---|---|---|
| `Content-Type` | the type detected from the file's **bytes** | Never its name. `cv.pdf` full of HTML is the attack |
| `Content-Disposition` | `attachment` | Never inline, images included |
| `X-Content-Type-Options` | `nosniff` | The browser must not overrule us |
| `Cache-Control` | `private, no-store` | Attachments are personal data |

The second fixture is the point: it is named `totally-a-cv.pdf` and contains a `<script>` tag.

```bash
file /tmp/got.bin      # says HTML — and it was still served as an inert download
```

Another tenant's attachment answers **404**, not 403 — saying "forbidden" would confirm it
exists.

### The gap to know about

**The download step has never met a real WhatsApp file.** Storing, typing, serving and auditing
are all tested; the one link from provider to bytes is not, because inbound is currently broken
(**D-14** in [`21 · Deferred`](21-deferred.md)). The fixtures above exercise every layer except
that one.

---

## The access trail

Opening a thread and downloading a file are both recorded. Listing the inbox deliberately is not
— a paginated load is not a meaningful access event (**D-13**).

```bash
npm run db:query "SELECT action, actor_type, target_id, at FROM audit_log ORDER BY at DESC LIMIT 10"
```

After fetching an attachment you should see `media.downloaded`; after opening a thread,
`conversation.read`. The download row is written **before** any byte moves, so a transfer that
fails or is abandoned still appears.

---

## The UI

Sign in at `localhost:3001/login`. There is no self-service password reset; an administrator
sets one:

```bash
npm run admin -- password --email you@example.com
```

It **generates and prints** the password rather than taking one as an argument — an argument
ends up in shell history and in the process list. Running it also ends every session on that
account.

The inbox does not render attachments yet. A message that arrived with a file shows as an empty
bubble; the API has been carrying `media` on every message since media landed, and wiring it
into the UI is the next piece of work.

---

## Linking a WhatsApp number

```bash
npm run wa:link
```

QR or pairing code. **Read [`08 · Anti-ban`](08-antiban.md) first if you are pointing this at a
number you care about** — Baileys is unofficial, a ban has no appeal, and there is still no rate
limiting, warmup or pacing anywhere in the send path.

Two things that have cost time before, both now handled but worth recognising:

- WhatsApp closes the socket with **515 `restart_required` immediately after a QR scan**. That
  is the normal last step of pairing, not a failure; the client reconnects at once.
- `wa-link.ts` refuses to run when there is no organisation, or more than one. It used to invent
  one, which is how an unaccounted-for tenant ended up in the database.

If sends work and **nothing ever arrives**, check the gateway log for `failed to decrypt
message` / `Bad MAC` before suspecting the application. That is D-14, and it looks like a
half-working link rather than a broken one.

**To recover such a number, unlink it first.** A re-link cannot show a fresh QR while the corrupt
credentials are stored — Baileys only issues a QR when there are none. The **Unlink** button on
the Numbers page (or `POST /api/v1/senders/:id/unlink`) has the gateway log out and clear them;
then link again for a clean QR.

```bash
curl -s -X POST localhost:3000/api/v1/senders/<sender-id>/unlink -H "Authorization: Bearer $KEY"
```

---

## Running the tests instead

```bash
npm run check          # typecheck, typecheck:web, lint, and the whole suite
npm test               # the suite alone
npm run db:rls-demo    # watch tenant isolation refuse a read, in one transaction
```

Integration tests use a **separate database** (`whatsapp_crm_test`) and truncate freely, so they
cannot touch your linked numbers or stored messages.

---

## When something is stuck

| Symptom | Cause |
|---|---|
| `port 3000 is already in use` | A previous run is still up. `ss -ltnp \| grep 3000` |
| Message stays `queued` | The gateway is not running, or the number is not linked |
| `npm run web:build` fails while the UI is running | Both write `apps/web/.next`. Stop one |
| Migrations land in the wrong database | There is a **second Postgres on 5432** on this machine. This project uses **5434** |
| Everything returns empty for a real org | Check the `rls:` line — a wrong tenant role shows up as silence, not an error |

Never `cp .env.example .env` over a working install. It destroys `ENCRYPTION_KEY`, and with it
every linked number and every stored message, permanently.
