# 20 · Orientation — start here if any of this is unfamiliar

Written for someone who has never used this language or this stack. Nothing here assumes you
know TypeScript, Node, Postgres or WhatsApp's API. If a term in another document looks like
jargon, it is probably explained here.

---

## 1. What this project is, in plain words

A tool that lets a small team talk to a lot of people on WhatsApp, from one shared screen,
without losing track of who said what — and without getting their phone number banned.

Three things it does:

1. **A shared inbox.** WhatsApp conversations appear in a web page instead of on one person's
   phone. Several people can answer, and nobody loses the history when someone leaves.
2. **Bulk outreach.** Send a message to 500 people, slowly and carefully enough that WhatsApp
   does not decide you are a spammer.
3. **Contact management.** Keep those people, their details, and their conversation history in
   one place, importable from a spreadsheet.

**It is not recruitment software.** That matters more than it sounds — see §4.

---

## 2. The numbering schemes (what all those codes mean)

Five different prefixes appear throughout these documents. They are not related to each other.

### `M1`, `M29`, `M30` … — **M is for Mistake**

Defects found in the **previous system** (`Mikhil31/WhatsAppCRM`), catalogued in
[`00-prior-art.md`](00-prior-art.md). There are 30-odd. Each one is a real bug that actually
happened, turned into a rule the new build must satisfy.

> **M7** — the old duplicate-check ran `WHERE email = $1 OR phone = $2` and passed an empty
> string when a value was missing. So every contact with a blank email matched every *other*
> contact with a blank email, and unrelated people were silently merged into one.

When a comment in the code says *"this is the M7 fix"*, it means: this line exists so that
specific disaster cannot happen again. They are cited constantly because forgetting them is
how you rebuild the same broken thing.

### `P0`, `P1`, `P2` … — **P is for Phase**

Build phases, in [`17-roadmap.md`](17-roadmap.md). The order work happens in.

| | | Status |
|---|---|---|
| **P0** | Write the design | done |
| **P1** | Skeleton — server boots, database migrates | done |
| **P2** | Contacts, tags, deduplication | partly |
| **P3** | **Channels — the Baileys adapter. First code that touches WhatsApp** | in progress |
| **P4** | Inbox (the screen agents use) | |
| **P5** | Data import (spreadsheets and other sources) | |
| **P6** | The anti-ban engine | |
| P7–P12 | Campaigns, official API, public API, automation, hardening, release | |

**A working prototype means finishing P3.** Everything after it is building on top of a thing
that already talks to WhatsApp.

### `F1`, `F2` … — **F is for Feature module**

One folder per product area in [`06-features/`](06-features/). F1 is channels, F3 is the inbox,
F6 is anti-ban. Each file lists what that module must do and how it gets tested.

### `FR-1`, `NFR-5`, `CON-3` — requirements

In [`02-requirements.md`](02-requirements.md). **FR** = functional requirement (something the
software must *do*). **NFR** = non-functional (how well it must do it — speed, uptime,
security). **CON** = a constraint imposed from outside that we cannot negotiate, like Meta's
pricing or WhatsApp's rules.

### `ADR-0001`, `ADR-0002` — Architecture Decision Records

In [`adr/`](adr/). One file per decision that would be expensive to reverse, recording *why* it
was made and what was rejected. They are never edited after the fact — a later decision
**supersedes** an earlier one, so the reasoning trail stays intact. ADR-0003 chose Fastify;
ADR-0004 replaced it with Express and explains what changed.

### `AC-1`, `TC-2.4` — acceptance criteria and test cases

Inside feature files. **AC** = "this is what done looks like". **TC** = "this is the test that
proves it".

---

## 3. The technology, explained from zero

### The language

**JavaScript** is the language web browsers run. **Node.js** lets you run JavaScript on a
server instead of in a browser. **TypeScript** is JavaScript with type labels added — you write
`name: string` instead of just `name`, and a checker catches mistakes before the code ever
runs. It compiles down to ordinary JavaScript.

*Why this language:* the library that talks to WhatsApp (Baileys) only exists for Node. Using
anything else would mean running two separate programs in two languages just to avoid writing
some TypeScript.

### The pieces

| Thing | What it is | Why it is here |
|---|---|---|
| **Express** | Receives web requests and replies to them | It is the thing that makes `/health` return `{"status":"ok"}`. In Python this would be Flask. |
| **PostgreSQL** | The database — where everything is stored permanently | The only datastore. Reliable, free, and handles both ordinary tables and flexible JSON. |
| **Drizzle** | Lets you describe database tables in TypeScript | Generates the SQL that creates them, and gives you typed results back from queries |
| **Zod** | Checks that data has the shape you expect | Used on incoming web requests *and* on configuration, so a missing setting crashes at startup with a clear message instead of failing mysteriously later |
| **Baileys** | Talks to WhatsApp by pretending to be WhatsApp Web | The whole product depends on it. It is unofficial — see §5. |
| **Vitest** | Runs the tests | |
| **Docker** | Packages the app so it runs the same everywhere | Also how the local Postgres runs during development |
| **pino** | Writes log lines as JSON | Machine-readable, so you can search them |

### Words that appear constantly

**Migration** — a file containing SQL that changes the database structure, numbered so they
run in order. You never edit the database by hand; you write a migration, and every copy of
the system (yours, a colleague's, production) gets the identical change. `0004_channels.sql`
is the fourth one.

**Schema** — the shape of the database: what tables exist and what columns they have.

**Port and adapter** — a *port* is a description of what something must be able to do; an
*adapter* is one actual implementation of it. We define `ChannelProvider` (the port: "must be
able to send, receive, connect, report health") and then write a Baileys adapter, a Meta
adapter and a fake one. The rest of the program only ever knows about the port. That is why a
second messaging service can be added later without touching the rest of the code.

**Fake / stub** — a pretend version of something, used in tests. Our fake WhatsApp adapter
behaves like the real one but keeps messages in memory. It means the whole product can be
tested without a phone, a SIM card, or any risk of a ban. The old system's only way of testing
was to send a real message and look at a real phone.

**Contract test** — one set of tests that *every* adapter must pass. Write a new adapter, run
the same suite, and you know it behaves identically. This is what makes swapping pieces safe.

**Queue and worker** — a queue is a list of jobs waiting to be done. A worker is a separate
program that picks them up. Used because sending 10,000 messages takes days: a web request
cannot wait that long, so it adds jobs to the queue and answers immediately.

**RLS (Row-Level Security)** — a Postgres feature where the database itself filters rows by
who is asking. Set "I am org A" at the start of a transaction, and org B's rows become
invisible — even to a query that forgot to filter. A forgotten `WHERE` becomes an empty result
instead of a data leak.

**jsonb** — a Postgres column type that stores JSON *and* lets you search inside it. Different
from storing JSON as plain text, where the database sees only a meaningless string.

**GIN index** — an index that looks *inside* a value. A normal index is like a book's table of
contents; GIN is like the index at the back — word → which pages contain it. Used so you can
search inside a `jsonb` column without reading every row. Explained with measurements in
[`05-data-model.md`](05-data-model.md).

**Blind index** — a way to look up encrypted data without decrypting it. Store a one-way hash
alongside the encrypted value; to find a phone number, hash your search term and match the
hashes. The database never holds the readable value, and search still works.

**E.164** — the international standard format for phone numbers: `+919876543210`. Every number
is stored this way, so `+91 98765 43210`, `9876543210` and `098765 43210` are recognised as one
person rather than three.

**Idempotent** — doing it twice has the same effect as doing it once. Important because
WhatsApp retries delivering the same message notification for up to seven days; without this,
one message could be saved several times.

**Envelope encryption** — data is encrypted with a key, and that key is itself encrypted with
a master key. Lets the inner key be replaced without re-encrypting everything at once.

**WASM (WebAssembly)** — compiled code that runs inside JavaScript at near-native speed.
Baileys 7.x uses it for encryption maths. It is portable — no platform-specific builds.

**dist-tag** — a label npm puts on a package version. `npm install baileys` gives you whatever
is tagged `latest`. Our chosen version, `6.7.24`, is tagged `legacy` — which here means "the
stable line", not "abandoned": both were published sixteen minutes apart.

---

## 4. The one design rule that explains most of the decisions

**This tool knows nothing about your business.**

There is no `candidate` table, no `job`, no `deal`, no `patient`. There is a `contact` — a
person — with a `custom_fields` column where *you* decide what to store. Pipeline stages are
rows a user can edit, not values fixed in code.

The old system got this wrong: `candidate` *was* the contact table, with columns for salary and
notice period. That made it recruitment software forever. Ours can be used by a clinic, a
tuition centre or a sales team without changing a line.

When the job portal integrates with this later, **the portal owns candidates and jobs; this
owns conversations and sending.** They meet over a web API.

---

## 5. The uncomfortable part, stated plainly

**Baileys is not official, and using it can get a phone number permanently banned.**

It works by pretending to be WhatsApp Web. That breaks WhatsApp's terms of service. A banned
number has no appeal process — it is simply gone, with its history.

This is a deliberate, documented trade-off, not an oversight:

- WhatsApp's **official** API (Meta Cloud API) is safe and reliable, but costs money per
  message — roughly ₹0.86 for a marketing message in India.
- Baileys is free, but risky.

So the system uses **both**, and decides per message: anything the business depends on (login
codes, order updates, anything a client sees) goes through the paid official channel. Bulk
outreach goes through Baileys, wrapped in the safety engine described in
[`08-antiban.md`](08-antiban.md) — warmup periods, human-like delays, reply-ratio monitoring,
automatic braking.

**That engine reduces the risk. It cannot remove it.** Never point this at a number you cannot
afford to lose.

---

## 6. Running it

```bash
npm install                 # download dependencies
cp .env.example .env        # then fill in the required values
npm run db:dev:up           # start Postgres in Docker (data persists in a volume)
npm run db:migrate          # create the tables
npm run dev                 # start the API server on :3000
```

### The database

`npm run db:dev:up` runs Postgres in Docker with a **named volume**, so your data survives a
restart, a reboot, and even deleting the container. Two databases live inside it:

| | |
|---|---|
| `whatsapp_crm_dev` | Your data. **Linked WhatsApp numbers and their credentials live here** — wiping it means re-linking every number. |
| `whatsapp_crm_test` | For `npm test`, which truncates tables freely. Deliberately separate so tests can never destroy the above. |

```bash
npm run db:dev:status       # is it running, and what is in it
npm run db:psql             # open a SQL prompt
npm run db:dev:down         # stop it (data kept)
npm run db:dev:reset        # DELETE everything, including linked numbers (asks first)
```

### Two commands people confuse

| | What it does |
|---|---|
| `npm run dev` | Starts the **API server** on port 3000. Currently only `/health` and `/ready`. |
| `npm run wa:link` | Starts the **WhatsApp linking tool** and shows a QR code. This is the WhatsApp part. |

Then open `http://localhost:3000/ready` — it should report the database as `ok`.

```bash
npm run check               # types + linting + tests, all at once
npm test                    # just the tests
```

**If it refuses to start**, read the message. Configuration is validated at startup on purpose,
so a missing setting fails immediately and tells you which one, rather than breaking later in
a way that is hard to trace.

---

## 7. Where to go next

| If you want to | Read |
|---|---|
| Know what we are building and why | [`01-vision-scope.md`](01-vision-scope.md) |
| Understand the mistakes we are avoiding | [`00-prior-art.md`](00-prior-art.md) |
| See how the pieces fit together | [`04-architecture.md`](04-architecture.md) |
| Understand the database | [`05-data-model.md`](05-data-model.md) — every column explained |
| Know why each technology was chosen | [`10-stack.md`](10-stack.md) |
| Write code that fits in | [`11-conventions.md`](11-conventions.md) |
| Understand the ban-avoidance engine | [`08-antiban.md`](08-antiban.md) |
| Know what is built and what is next | [`17-roadmap.md`](17-roadmap.md) and [`../CONTEXT.md`](../CONTEXT.md) |
