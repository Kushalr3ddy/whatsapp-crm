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

## Creating a contact

The single-person route the host app uses (`contacts:write`). At least one of `phone` / `email`;
`externalRef` carries the host app's own id.

```bash
curl -s -X POST localhost:3000/api/v1/contacts \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"displayName":"Priya","phone":"09876500001","externalRef":{"candidateId":"cand_42"}}'
```

The phone comes back normalised to `+919876500001` (a number written any way is one contact).
Posting the **same** number again — however formatted — is a **409 `CONTACT_EXISTS`** with the
existing id, not a silent merge. Neither phone nor email → **422**; an unparseable phone →
**422 `PHONE_*`**.

---

## Attachments

Media arrives through the gateway: a file is re-downloaded through the socket that received it,
typed from its **magic bytes**, stored under an unguessable key, and served back only through
an authenticated route.

The old `[TEST DATA]` fixtures are gone (deleted 2026-09-29, once real media was proven). To exercise
this, link a number and have someone send it a file — or send one yourself: in the inbox, the 📎 button
(or `POST /api/v1/conversations/:id/attachments`, a raw file body) sends a file into a thread. Find a
stored file:

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

### Verified end to end (2026-09-28)

**The download step has now met a real WhatsApp file.** After D-14 was closed (inbound
re-linked), an inbound image was downloaded through the socket, typed from its magic bytes as
`image/jpeg`, stored under an unguessable key, and the bytes on disk matched the bytes received.
Storing, typing, serving and auditing were already tested; the one link from provider to bytes
is now proven too. 

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

The inbox renders attachments as a download link (filename, type, size), served through a
web-side `/media/:id` proxy that forwards your session to the API. A media message whose bytes
could not be fetched says "attachment could not be fetched" instead.

---

## Linking a WhatsApp number

```bash
npm run wa:link
```

QR or pairing code. **Read [`08 · Anti-ban`](08-antiban.md) first if you are pointing this at a
number you care about** — Baileys is unofficial and a ban has no appeal. The full anti-ban engine now
exists — all six layers (warmup and ceilings, jitter, typing/circadian/read behaviour, contact-graph
gates, health scoring, timed recovery) — and `npm run test:sim` proves it against a simulated WhatsApp.
That makes a burst impossible and a campaign slow by design, but it reduces the risk of a ban; it
cannot remove it.

Two things that have cost time before, both now handled but worth recognising:

- WhatsApp closes the socket with **515 `restart_required` immediately after a QR scan**. That
  is the normal last step of pairing, not a failure; the client reconnects at once.
- `wa-link.ts` refuses to run when there is no organisation, or more than one. It used to invent
  one, which is how an unaccounted-for tenant ended up in the database.

If sends work and **nothing ever arrives**, check the gateway log for `failed to decrypt
message` / `Bad MAC` before suspecting the application. This was **D-14** (now closed — resolved
by the unlink→re-link recovery below); a corrupt companion session looks like a half-working
link rather than a broken one, so if the symptom recurs, the fix is the same.

**To recover such a number, unlink it first.** A re-link cannot show a fresh QR while the corrupt
credentials are stored — Baileys only issues a QR when there are none. The **Unlink** button on
the Numbers page (or `POST /api/v1/senders/:id/unlink`) has the gateway log out and clear them;
then link again for a clean QR.

```bash
curl -s -X POST localhost:3000/api/v1/senders/<sender-id>/unlink -H "Authorization: Bearer $KEY"
```

---

## The scripted walkthrough (no real sends)

```bash
npm run local:flow             # sign in → 5 contacts → draft → dry run → start → fake number "sends"
npm run local:flow -- --keep   # leave the demo org so you can sign in and look at it
npm run local:flow -- --reset  # remove it
```

It uses the real login route and the real gateway code against an in-memory fake number, so
nothing leaves the machine; it refuses a database that is not on this host. The browser version is
`tests/e2e/broadcast-flow.spec.ts`.

### What the app looks like now

Sign in lands on **Overview**. The sidebar is Overview · Inbox · Contacts · Numbers · Import ·
Broadcast. **Saved audiences** (what Segments became) is reached from Broadcast; a campaign's audience
can also be built inline with a live count. **Numbers** shows a banner and a health timeline when a
number looks restricted, and a red count on the sidebar item.

### Sample data

`tests/fixtures/import-contacts.csv` — 29 rows with numbers written five different ways, a duplicate,
two unusable rows and a landline. Fake `+91 98765 6xxxx` numbers only. Import it from **Import**, or
use it as the fixture the browser tests upload.

### Browser tests

`npm run test:e2e` signs in with `TEST_EMAIL` / `TEST_PASSWORD` from `.env` (the existing local
admin). Specs scope sidebar links with the `nav(page)` helper and open collapsed panels with
`openDetails`. It starts the stack itself if it is not already up.

---

## The seeded test org and the fake gateway

For the browser tests (and for clicking around with real-looking data), seed the test org and run the
gateway on the in-memory fake channel. **Nothing real can be sent** — the fake channel only handles numbers
whose provider is `fake`, and the app refuses `GATEWAY_CHANNEL=fake` when `NODE_ENV=production`.

```bash
npm run local:seed                    # a fake connected number, 20 people, 3 tags, a field, 3 conversations, an audience
npm run local:seed -- --reset         # remove exactly what the seed made (also clears the number's new-contact count)
GATEWAY_CHANNEL=fake GATEWAY_SWEEP_SECONDS=3 SEND_CIRCADIAN=false SEND_RECIPIENT_TIMEZONE=false \
  SEND_TYPING_SIMULATION=false npm run dev:all
npm run test:e2e
```

The seed signs in as `TEST_EMAIL` / `TEST_PASSWORD` to the org `e2e-test` and is safe to run twice. The
sending spec (`tests/e2e/send-flow.spec.ts`) skips itself unless the seeded number is connected, i.e. unless the
gateway is the fake one. It adds one brand-new contact per run, and a stranger counts against the number's
new-contact allowance (5 a day until people reply) — `--reset` then re-seed (and restart the gateway) starts a
clean day. CI does all of this in the `e2e` job.

### Manual checklist (about ten minutes)

Sign in at `localhost:3001/login` as the test admin, with the seed in place.

- **Overview** — counts match the seed; no console errors.
- **Inbox** — Open shows Asha Rao and Bilal Khan, Closed shows Chitra Nair; *Mine* shows only Bilal; opening
  Asha clears her unread badge; add a note (it appears, nothing is "sent"); Resolve then Reopen.
- **Composer** — with the fake gateway up, reply to a thread and watch it go queued → sent; with it down the
  composer locks to notes and says why.
- **Contacts** — search "Farhan" narrows the list; tag chip filters; the do-not-contact toggle blocks a reply;
  *Tag many at once* previews a count before it applies; export (admin) downloads CSV and vCard.
- **Import** — upload `tests/fixtures/import-contacts.csv` (add a unique row, same bytes are refused), columns
  map themselves, *Preview* writes nothing, *Import* creates people and tags them.
- **Broadcast** — new campaign from a tag, from an import, from *Build a filter* (live count), preview, start,
  pause, resume, cancel; per-recipient results filter by status.
- **Numbers** — the seeded card shows its risk meter and health stats; advisory mode is behind its disclosure.
- **Saved audiences** — "Seed — replied" is listed; preview count works and a segment can be saved.

---

## One command: `npm run verify`

Runs everything that does not need a real WhatsApp number, prints a pass/fail table and exits non-zero if
anything failed.

```bash
npm run verify              # everything, about 12 minutes
npm run verify -- --fast    # typecheck, lint and vitest only, about 90 seconds
npm run verify -- --no-sim  # skip the 7-minute anti-ban simulation, about 4 minutes
npm run verify -- --no-e2e  # skip the scripted flow and the browser suite
```

| Stage | What it proves |
|---|---|
| database migrations (twice) | migrations apply, and re-applying is a no-op |
| typecheck + lint + vitest | the code compiles, follows the rules, and the 600+ unit and integration tests pass |
| web typecheck | the Next.js app compiles |
| anti-ban simulation | the engine survives nine scenarios against a virtual WhatsApp |
| scripted flow | login, contacts, broadcast, a fake number "sends" (`local:flow`) |
| seed test org | `local:seed` is idempotent |
| browser suite | every Playwright spec, against a throwaway fake-channel stack |

It starts its own stack with `GATEWAY_CHANNEL=fake`, so **nothing can reach WhatsApp**, and it refuses to run
if something is already listening on :3000 or :3001 (that could be a real gateway). Stop `dev:all` first.
The live walkthrough with your real number is separate: `npm run test:live` (see below).

---

## Test phone numbers: never invent real-looking ones

Anything that runs against the dev stack (the browser specs, `local:seed`, `local:flow`, the sample
Naukri workbook) uses only **+1 202 555 0100 to 0199**. Those numbers are reserved for fiction and can
never belong to a person, so a stray campaign or a linked real gateway cannot message a stranger. The
only real numbers anywhere are your own, read from `.env` (`LIVE_SEND_TO`, `LIVE_BROADCAST_TO`). Do not
use made-up Indian mobile numbers: they are valid-looking and may belong to someone.

---

## The live walkthrough (visible browser, real messages)

One Chromium window you can watch, driving the whole product against a **real** linked number:

```bash
npm run dev:all        # the real gateway — NOT GATEWAY_CHANNEL=fake
npm run test:live
```

It signs in → (if no number is connected, opens the link page and waits up to 10 minutes while you scan the
QR) → imports a synthetic Naukri-style `.xlsx` → sends one message to `LIVE_SEND_TO` and replies in the inbox →
mass-tags and hand-tags → broadcasts to `LIVE_BROADCAST_TO` → signs out. Real WhatsApp messages go to exactly
the numbers in `.env` and nowhere else; the file's filler rows are imported but never messaged.

Run it twice within 14 days and the second broadcast is skipped by the cooldown gate (by design); set
`LIVE_OVERRIDE_GATES=1` to lift it with an audited admin override. `LIVE_SLOWMO=0` removes the slow-motion delay.

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
| API and gateway refuse to start: "database ahead of the code" | A newer migration was applied from another branch (the dev database is at 0029 from the number-fallback branch). Use that branch, or ask before rolling the migration back |
| The browser stage of `verify` never starts, `EMFILE: too many open files` in `stack.log` | The machine's inotify instance limit (`fs.inotify.max_user_instances`, 128) is used up by other programs. Run `WATCHPACK_POLLING=true npm run verify`; the real fix is raising that system setting |
| Everything returns empty for a real org | Check the `rls:` line — a wrong tenant role shows up as silence, not an error |

Never `cp .env.example .env` over a working install. It destroys `ENCRYPTION_KEY`, and with it
every linked number and every stored message, permanently.

## The session audit: a timed, recorded pass over every screen (added 2026-10-22)

`tests/live/session-audit.live.ts` is one ordered Playwright test that signs in wrong, then right, walks the dashboard element by element, then every tab (Inbox with a sent message, Contacts with
an import, "Upload anyway" and searches, a campaign, Team, the AI assistant and its settings, Security, Billing), and signs out. Every step is timed, a failing step is recorded and the run goes on, and a
resource monitor (`tests/live/resmon.mjs`) samples CPU, memory, swap and each process once a second beside it. A visible Chromium records video.

```bash
npm run test:session        # the safe version: e2e organisation, fake number, the sample CSV (tests/fixtures/session-import.csv). Nobody is messaged.
npm run test:session:real   # REAL messages: hiring-studios organisation, kushal_test, LIVE_SEND_TO and every number in the CSV. Pass your own CSV: scripts/run-session.sh real <csv>
```

- The stack must be up (`npm run dev:all`, or the API, gateway and web started separately). The safe version needs the **fake** gateway (`GATEWAY_CHANNEL=fake`); the real version needs the **real** one, with the number connected.
- The real version reads `email` and `password` (lowercase) and `LIVE_SEND_TO` from `.env`, and starts the campaign with the audited admin override of the 14-day cooldown (the Inbox step messages the same person moments before).
- Output goes to `test-results/session-<mode>-<time>/`: `report.md` (every step, its time, CPU and free memory at that moment, notes), `steps.jsonl`, `resources.csv`, `session.webm`, screenshots, and `FAILED-nnn.png` for any failing step.
- Set `SESSION_SEND_WAIT_S=20` to fail fast on the two steps that wait for a gateway when none is running for that number's channel.
- Findings from the first runs: [`37-session-audit-findings.md`](37-session-audit-findings.md). Close heavy browser tabs and restart `next dev` if it has been up for hours before measuring (it grew to 4.5 GB and made the test browser die).
