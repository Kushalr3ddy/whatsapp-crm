# WhatsApp CRM

A generic, self-hostable conversation and outreach platform for WhatsApp — shared inbox,
contacts, campaigns, automation, and a real API — that runs on one small VPS and costs
nothing to operate.

> **Status: P1 (skeleton) complete.** The design lives in `docs/`; the skeleton boots, the
> database migrates with tenant isolation enforced, and CI is green. No WhatsApp yet — that
> is P3. Build phases are tracked in [`docs/17-roadmap.md`](docs/17-roadmap.md); the running
> log of decisions is [`CONTEXT.md`](CONTEXT.md).

## What it is

A messaging CRM that treats WhatsApp as **one adapter behind a port**, not as the product:

- **Shared inbox** — two-way conversations, assignment, collision detection, internal notes.
- **Contacts** — custom fields, tags, segments, identity-based dedup. No domain assumptions.
- **Campaigns** — segment, schedule, drip, opt-out, per-recipient status, cost estimate.
- **Anti-ban engine** — warmup, Gaussian jitter, circadian pacing, contact-graph gates,
  risk scoring, auto-throttle and recovery. See [`docs/08-antiban.md`](docs/08-antiban.md).
- **Pluggable ingestion** — Excel/CSV, Google Sheets, REST, webhooks, scheduled syncs, with
  a mapping UI, dry run, and a per-row error ledger.
- **Public API + webhooks** — everything the UI can do, any other app can do.

Two WhatsApp transports, chosen per message by intent: **Baileys** (free, unofficial, for
bulk outreach) and the **Meta Cloud API** (paid, official, for anything business-critical).

## What it is not

It does not own your business domain. There is no `candidate` table, no `deal`, no `ticket`.
Domain objects live in whatever system owns them; the CRM references them by `external_ref`
and stores user-defined fields. That is what makes it reusable — as a standalone CRM, or as
a module inside a larger product ([`docs/16-integration-jobportal.md`](docs/16-integration-jobportal.md)).

## Honest warnings

Read these before deciding to use it.

- **Baileys is unofficial and against WhatsApp's Terms of Service.** Running it against a
  normal number can get that number banned, permanently, with no appeal. The anti-ban engine
  substantially reduces the risk; it cannot eliminate it. Reported industry figures put ~68%
  of Indian SMBs using unofficial automation hitting at least one ban within 12 months.
  Never point it at a number you cannot afford to lose. Anything your business depends on
  should go through the official Cloud API.
- **Bulk messaging is regulated.** India's DPDP Act requires affirmative, purpose-separated,
  timestamped consent and an opt-out that is as easy as opting in. The CRM gives you the
  tooling; compliance is still yours. See [`docs/09-security.md`](docs/09-security.md).
- **The official API costs money per template message.** Roughly ₹0.86 marketing and
  ₹0.145 utility/auth in India as of 2026; replies inside the 24-hour service window are free.

## Running it

Verified end to end on 2026-09-19: a real number linked, a real message sent and delivered.

### What you need

- **Node 22+** and **Docker** (for Postgres). Nothing else.

### Setup, once

```bash
git clone https://github.com/Kushalr3ddy/whatsapp-crm.git && cd whatsapp-crm
npm install
[ -f .env ] || cp .env.example .env     # never clobber an existing one
```

> The guard matters. A plain `cp .env.example .env` over a working install overwrites
> `ENCRYPTION_KEY`, and **that is the one secret with no recovery** — every stored message and
> every linked number becomes unreadable. Back it up somewhere that is not the repo and not the
> database, and name the backup something `.gitignore` already covers.

Then fill in the five required secrets in `.env`. Every one is a hard crash at boot if
missing — never a silent fallback:

```bash
openssl rand -hex 32     # APP_SECRET
openssl rand -hex 32     # ENCRYPTION_KEY
openssl rand -hex 32     # ENCRYPTION_INDEX_KEY   (must DIFFER from ENCRYPTION_KEY)
openssl rand -hex 32     # API_KEY
```

`DATABASE_URL` for the bundled container is:

```
postgresql://dev:dev@localhost:5434/whatsapp_crm_dev
```

`PUBLIC_URL=http://localhost:3000` is fine locally.

> **Back up `ENCRYPTION_KEY` and `ENCRYPTION_INDEX_KEY` in a password manager, now.** Losing
> `ENCRYPTION_KEY` means losing every linked number and every stored message, permanently — it
> is the only secret here that cannot be regenerated. Never store it alongside a database dump:
> a backup holding both the ciphertext and its key is a backup of plaintext.
> See [22 · Encryption](docs/22-encryption.md), and [D-9](docs/21-deferred.md) for why there is
> deliberately no generator script yet.

Start Postgres and create the schema — this does both databases, app and test:

```bash
npm run db:setup
```

### Running it, three processes

Each in its own terminal. They are separate on purpose: the gateway owns the WhatsApp sockets,
so restarting the API never drops a connection.

```bash
npm run dev          # API on :3000
```
```bash
npm run gateway      # owns the WhatsApp sockets — nothing sends without this
```
```bash
npm run web          # inbox UI on :3001
```

### Provisioning, once

Nothing works until an organisation exists. The `API_KEY` in `.env` is a **bootstrap**
credential — it can create an org and mint that org's first key, and is refused on every data
route.

```bash
npm run admin -- org --name "Your Company" --slug your-company --email you@example.com
```

That prints an org id and a generated password. Save both. Then mint the key the UI uses:

```bash
npm run admin -- key --org <org-id> --name web --scopes contacts:read,conversations:read,conversations:write,messages:send,senders:read,senders:write
```

Put it in `.env` as `CRM_API_KEY=`. `npm run admin` on its own lists the commands; `whoami`
lists organisations.

### Linking a number

A sender must exist first:

```bash
export CRM_API_KEY=$(grep '^CRM_API_KEY=' .env | cut -d= -f2-)
```

```bash
curl -X POST http://localhost:3000/api/v1/senders -H "Authorization: Bearer $CRM_API_KEY" -H "Content-Type: application/json" -d '{"label":"my number"}'
```

Then open **http://localhost:3001/link**, click **Link this number**, and scan the QR from
WhatsApp → **Settings → Linked Devices → Link a device**.

The QR expires in under a minute; click again for a fresh one. Once the socket opens the
sidebar reads **"1 number connected"** and the sender is promoted to `active` automatically.

### Sending

Open **http://localhost:3001/inbox**, pick a conversation, type, send. Or over HTTP:

```bash
curl -X POST http://localhost:3000/api/v1/messages -H "Authorization: Bearer $CRM_API_KEY" -H "Content-Type: application/json" -d '{"to":"+919876543210","body":"hello"}'
```

That returns **202, not 201** — accepted, not sent. The gateway does the sending, and the status
moves `queued → sent → delivered → read` in the thread. If nothing is linked the message stays
`queued` and goes out on its own once a number connects.

More requests to try by hand, with real responses, in
[15 · Public API](docs/15-api.md#trying-it-by-hand-insomnia-postman-curl).

### Checking it still works

```bash
npm run check        # typecheck (server + web) + lint + 169 tests
```

`npm run` lists every script. [20 · Orientation](docs/20-orientation.md) explains the stack and
every term used in the docs, assuming no prior knowledge.

### Things that will catch you out

- **`npm run web:build` fails while `npm run web` is running** — both write `apps/web/.next`.
  Stop the dev server first.
- **Two databases in one container.** `whatsapp_crm_dev` holds real data *including WhatsApp
  credentials*; `whatsapp_crm_test` is what the suite truncates. Data lives in a named Docker
  volume and survives a restart.
- **Nothing sends without the gateway.** A queued message is not a failure — it is waiting.

### Deployment

Not done yet, and it is the point at which the production database gets chosen. The intended
shape is the `lean` preset: one app process, Postgres, Caddy — **~700 MB–1 GB RAM**, every v1
feature, no Redis, no object store, no telemetry.

| Preset | RAM | Shape |
|---|---|---|
| `lean` (default) | ~0.7–1 GB | One process, pg-boss queue, filesystem storage, static web |
| `standard` | ~2.5–3.5 GB | Split processes, Redis/BullMQ, MinIO, observability |
| `scale` | 8 GB+ | Replicas, managed Postgres, sharded gateways |

Work out what *your* load needs with the interactive
**[capacity calculator](docs/capacity-calculator.html)** — toggle each component, slide the
usage, see RAM, CPU, disk and monthly cost. Open the file in a browser; it needs no server.
Figures and reasoning in [`docs/19-capacity.md`](docs/19-capacity.md).

Every external resource is swappable between free self-hosted and managed/paid:
storage, auth, queue, email, SMS, LLM, KMS, secrets, telemetry. See
[`docs/18-providers.md`](docs/18-providers.md).

## Documentation

**Picking this up in a new session? → [HANDOFF.md](HANDOFF.md)** — current state, the pending
live test, decisions already made, and the gotchas already paid for.

**New to the project or the stack? → [docs/20-orientation.md](docs/20-orientation.md)** explains
everything from zero: the technology, the jargon, and what all the `M`/`P`/`F` codes mean.
[docs/README.md](docs/README.md) is the full index with a suggested reading order.

| | |
|---|---|
| [20 Orientation](docs/20-orientation.md) | **Start here** — the project and the stack, assuming no prior knowledge |
| [00 Prior art](docs/00-prior-art.md) | What the previous system got wrong, and the rule each defect became |
| [01 Vision & scope](docs/01-vision-scope.md) | What this is, who it is for, explicit non-goals |
| [02 Requirements](docs/02-requirements.md) | Numbered functional and non-functional requirements |
| [03 Competitive analysis](docs/03-competitive-analysis.md) | 12 competitors: table stakes, gaps worth filling |
| [04 Architecture](docs/04-architecture.md) | Topology, ports and adapters, key flows |
| [05 Data model](docs/05-data-model.md) | Every table, every column, and why |
| [06 Features](docs/06-features/) | One file per module, F1–F12, with acceptance criteria |
| [07 Ingestion](docs/07-ingestion.md) | Connector framework, mapping, identity resolution |
| [08 Anti-ban](docs/08-antiban.md) | The engine, every number in it, and the research behind them |
| [09 Security](docs/09-security.md) | Threat model, controls, DPDP/GDPR |
| [10 Stack](docs/10-stack.md) | Every technology choice and the alternative that lost |
| [11 Conventions](docs/11-conventions.md) | Code standards, the comment rule |
| [12 Testing](docs/12-testing.md) | The pyramid, and the ban-simulation harness |
| [13 Deployment](docs/13-deployment.md) | Compose profiles, upgrades, backup and restore |
| [14 Runbooks](docs/14-runbooks.md) | One entry per alert |
| [15 API](docs/15-api.md) | The public API guide |
| [16 Job portal integration](docs/16-integration-jobportal.md) | The nine seams, mapped to endpoints |
| [17 Roadmap](docs/17-roadmap.md) | V1/V2/V3, build phases, exit criteria |
| [18 Providers](docs/18-providers.md) | Swappable drivers: config, cost, migration path |
| [19 Capacity](docs/19-capacity.md) | Presets, footprints, sizing tiers |
| [Capacity calculator](docs/capacity-calculator.html) | Interactive — toggle the stack, size the box |
| [Structure](STRUCTURE.md) | What lives where, and the dependency rule |

## Licence

Undecided — see [ADR-0001](docs/adr/ADR-0001-licence.md).
