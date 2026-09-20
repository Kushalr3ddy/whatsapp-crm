# 21 · Deferred decisions

Things deliberately **not** decided yet, each with the condition that should bring it back.

A parked decision is not a forgotten one. The point of this file is that nobody has to
re-derive the reasoning, and nobody revisits something before the thing that would change the
answer has actually happened.

Format: what · why parked · **what brings it back** · what it would cost to do later.

---

## D-1 · A lightweight database browser (Drizzle Studio or similar)

**What:** a web UI for running SQL against the live database from any device — a phone, a
borrowed laptop — without installing anything.

**Why parked:** the need is real (checking data or debugging away from your own machine), but
every option carries a catch:

| Option | Catch |
|---|---|
| **Drizzle Studio** (`npm run db:studio`) | Works today, but the **UI is served from `https://local.drizzle.studio`** — a page on Drizzle's servers that connects to your local port. Data stays on your machine; the interface code does not. Needs internet, and puts a third party in the loop. |
| **pgweb** | Single Go binary, ~20 MB RAM. Self-hosted, no third party. Needs to be put behind authentication. |
| **Adminer** | One PHP file. Same shape as pgweb. |
| **Supabase dashboard** | Free SQL editor in the browser, no setup — but only if the database is hosted there. |
| **DBeaver / psql** | What to use on your own machine. Not the answer to "from my phone". |

Starburst-style query UIs (stages, metrics, execution plans) are enormously more than this
needs — that is a distributed-query problem, and this is one Postgres instance.

**What brings it back:**
1. **Consolidating infrastructure for Indian data-residency compliance.** When everything moves
   in-region under DPDP, *where the database browser's UI is served from* becomes a real
   question rather than a preference — a third-party page holding a live connection to a
   database of personal data is exactly the kind of thing that needs an answer. Choose the
   self-hosted option then, behind the same authentication as everything else.
2. Or: someone needs database access away from their own machine often enough to be annoying.

**Cost of deferring:** none. Every option is additive and none touches the schema or the
application. `psql` and DBeaver cover the day-to-day case now.

---

## D-1b · Drizzle's query builder (as opposed to Drizzle itself)

**Worth separating three things that all get called "Drizzle":**

| | Status |
|---|---|
| **Drizzle schema definitions** (`pgTable(...)`) | **In use, and load-bearing.** This is what migrations are generated from. Cannot be removed without giving up generated migrations. |
| **drizzle-kit migrations** | **In use.** `db:generate`, `db:migrate`. |
| **Drizzle's query builder** (`db.select().from().where()`) | **Parked.** Every query written so far uses raw SQL through the `sql` tag. |
| **Drizzle Studio** (the browser UI) | **Parked** — see D-1 above. |

**Why the query builder is parked:** raw SQL is faster to write for someone who already knows
SQL well, and several of the queries written so far — the single-statement inbound upsert, the
status-rank guard — are clearer as SQL than they would be assembled from method calls. The `sql`
tag parameterises properly, so this is not the injection risk that string-building would be.

**What it costs:** typed results. `db.execute(sql...)` returns an unknown shape that the
caller asserts by hand, which is why the code is full of
`(rows as unknown as Array<{ id: string }>)[0]!`. The query builder would type those
automatically. That is the actual trade, and it is a real one.

**What brings it back:** enough hand-written row assertions that one of them is wrong and a bug
gets through. At that point adopt the builder for simple reads and keep raw SQL for the complex
statements — both work on the same connection and in the same transaction, so this is not an
either/or.

---

## D-2 · Data residency, DPDP consent enforcement, DLT registration

**What:** hosting, database, storage and any inference inside India; enforced purpose-separated
consent; DLT registration for SMS.

**Why parked:** the deployment is **in-house beta only** (decided 2026-09-16). The job portal
is on the same footing.

**What brings it back:** the first real user who is not on the team. That is the line — beta
testing among colleagues is one thing, processing other people's personal data is another.

**What stays in place regardless**, because it protects phone numbers rather than a legal
position: `do_not_contact`, opt-out keyword handling, and the `consent_record` table. Recording
consent costs nothing now and is expensive to backfill; enforcement can be switched on later.

**Cost of deferring:** low, provided the tables exist. Retrofitting consent *records* onto
historical contacts is impossible — you cannot invent evidence of an agreement that was never
captured. Hence keeping the table from the start.

---

## D-3 · Licence (ADR-0001)

**Why parked:** it changes nothing technical.

**What brings it back:** making the repository public, or accepting the first outside
contribution — whichever comes first.

**Cost of deferring:** rises sharply after the first outside contributor, since changing a
licence then needs every contributor's agreement. Decide before, not after.

---

## D-4 · The AI agent (F12)

**Why parked:** the heaviest dependency, the least certain value, and an unresolved privacy
question. A self-hosted model needs 5–7 GB of RAM; a hosted one sends contact data to a third
party. Most of what the previous system used AI for — classifying "yes, interested" — is better
served by rules that are free, instant, deterministic and correctable.

**What brings it back:** rule-based classification demonstrably failing on real conversations,
or a volume of inbound that humans genuinely cannot keep up with.

**Cost of deferring:** none. The seam exists — `LlmDriver` defaults to `none`, and the agent is
just another producer writing into the same outbox, so every safety gate already applies to it.

---

## D-5 · Baileys 7.x (ADR-0002)

**Why parked:** pinned to `6.7.24`, the stable line. 7.x has sat in release-candidate status
across twelve iterations.

*Correcting an earlier claim: the objection was never the Rust dependency. `whatsapp-rust-bridge`
is WebAssembly, base64-inlined, with no native binaries, no install scripts and no platform
restrictions — it installs like any pure-JS package. The reason is RC churn alone.*

**What brings it back:** a stable 7.0.0, or 6.x breaking against a WhatsApp protocol change.

**Cost of deferring:** low by construction. The `ChannelProvider` port plus its contract suite
means evaluating 7.x is: write the adapter against the new version, run the same suite, compare.

---

## D-6 · UUIDv7 primary keys

**Why parked:** Postgres 16 has no native `uuidv7()`; it arrives in PG18. Keys currently use
`gen_random_uuid()`.

**What brings it back:** upgrading to Postgres 18, or index bloat from random keys becoming
measurable.

**Cost of deferring:** moderate. Changing key generation later affects new rows only, so old and
new coexist — workable, but it makes the ordering property unreliable until every old row ages
out.

---

## D-7 · Turborepo, and splitting the queue driver

**Why parked:** npm workspaces are enough at this size, and `pg-boss` avoids running Redis at
all in the lean preset.

**What brings it back:** build times becoming annoying (Turborepo), or needing to scale workers
horizontally, at which point `pg-boss` stops being appropriate and BullMQ on Redis is correct.

**Cost of deferring:** none. Both sit behind interfaces already.

---

## D-8 · Self-serve setup wizard, guided walkthrough, whitelabelling

**What:** a first-run wizard that provisions an org and its first admin in the browser, a guided
walkthrough for someone new, and the branding layer that makes the product not visibly one
company's.

**Why parked:** it is a coherent phase of its own rather than a feature, and none of it blocks
the in-house beta, where the two developers can provision by hand. It is also mostly **already
anticipated** elsewhere: P12's exit criterion is *"a stranger self-hosts it in under 10 minutes
from the README alone"*, and F11's Branding section already specifies product name, logo,
colours, favicon and sender display name as configuration rather than code.

**What brings it back:**
1. **A second deployment that neither developer runs** — the recruiter, another team, or a
   whitelabelled instance. The moment setup cannot be a phone call, it has to be a wizard.
2. Or: P12 proper, where the 10-minute self-host criterion has to actually be met.

**Cost of deferring:** low but not zero. The longer provisioning stays manual, the more
hand-created rows exist that no code path can reproduce — `sender_identity` already carries one
created by hand, and that single row caused two separate misdiagnoses before anyone worked out
where it came from. Keeping provisioning behind one `createOrgWithAdmin()` service, as decided,
is what keeps this cheap.

---

## D-9 · Generating `.env`, and a secrets driver

**What:** an idempotent `npm run setup:env` that generates the required secrets, and eventually
a `SecretsDriver` (Infisical, OpenBao, AWS Secrets Manager) plus a non-local `KmsDriver` so the
master key stops living in a file at all.

**Why parked:** two developers on laptops with a password manager is a genuinely adequate answer
today, and a secrets manager does **not** solve the thing that actually hurts — losing a key. It
moves where the key lives and adds rotation, audit and access control, none of which is pressing
at this size.

Note the asymmetry that makes this worth care rather than speed: `APP_SECRET`, `API_KEY` and the
database password are all regenerable, and losing them costs one inconvenient afternoon.
**`ENCRYPTION_KEY` is not regenerable** — losing it makes every stored message and every linked
number permanently unreadable ([22 · Encryption](22-encryption.md)).

That asymmetry is exactly why a naive generator would be **worse than no generator**: run over a
working install it would mint a fresh `ENCRYPTION_KEY` and silently destroy the data it was
meant to protect. When this is built it must fill in only absent values, never touch a key that
already has content, and exit non-zero rather than guess.

**What brings it back:**
1. **Deployment** — the key has to exist on a server that nobody should be hand-editing, which
   is the point `KMS_DRIVER` stops being decorative. `docs/18-providers.md` already specs it;
   `config.ts` does not yet read it.
2. Or: a third person needing to set the project up, where "ask one of the two devs" stops
   scaling.

**Cost of deferring:** none technically, but it carries a **standing manual obligation** in the
meantime — `ENCRYPTION_KEY` and `ENCRYPTION_INDEX_KEY` must be kept in a password manager, and
never in the same place as a database dump. A backup holding both the ciphertext and its key is
a backup of plaintext.

---

## D-10 · What belongs in the inbox — broadcast output, and unknown senders

**What:** two related questions about the inbox's contents, both raised by using it.

**1. Broadcast output would flood it.** A campaign to 500 contacts produces 500 outbound
messages across 500 conversations. Rendered the way the inbox renders anything else, it buries
every real conversation the moment a campaign runs — the inbox stops being a place where a
person answers people and becomes a send log.

**2. Unknown senders are mixed in with known contacts.** Anyone can message a linked number,
and today they appear in the same list as real contacts. WhatsApp privacy addresses make this
sharper: the contact has no phone at all, just a `wa_lid` identity, so there is nothing to
recognise them by.

**Why parked:** the second is not painful at this volume, and the first cannot be answered
properly until there is a campaign to look at — the right shape depends on whether people want
per-recipient detail in the inbox at all, which is genuinely unclear before anyone runs one.

**The options, so they are not re-derived:**

| Approach | Shape |
|---|---|
| **Filter** | One inbox, a toggle for "conversations with a human reply". Cheapest; the campaign is still in there |
| **Separate surface** | Campaign sends live under Broadcast and never enter the inbox until someone replies. A reply promotes the thread in. Closest to how people actually work |
| **Message-request tray** | Instagram's shape, applied to unknown senders: a separate tray until someone is accepted or replied to. Solves (2), not (1) |

Current leaning: **separate surface** for broadcast, because a campaign send is not a
conversation until somebody answers it; and the **tray** for unknown senders, but only once
volume makes it worth the extra place to look.

**What brings it back:** P7, at the point the first campaign is about to be sent to more than a
handful of people. Or: enough unsolicited inbound that finding a real conversation becomes
annoying.

**Cost of deferring:** none structurally — `conversation` already carries `status`, and a
campaign send is already distinguishable by `message.sent_by`, so either shape can be built
later without a migration. The cost is only that the first campaign run will be ugly if it
arrives before this is decided.

---

## D-11 · Media at rest — encryption, retention, scanning, compliance

**What:** everything about received files *except* storing and serving them, which is built as
the filesystem `StorageDriver` with provider-neutral keys.

**Parked, deliberately:**

| Question | Why it waits |
|---|---|
| **Encryption at rest** | Message bodies are encrypted; files would not be. A CV is *more* sensitive than the message carrying it — name, phone, address, salary. Encrypting costs cheap range requests and streaming, so it is a trade to make deliberately rather than by default |
| **Retention** | Specced at one year in `09-security.md`, with a nightly hard-delete job that does not exist |
| **DPDP / erasure** | A deletion request has to reach the files, not only the rows — see D-2 |
| **Antivirus** | `SCANNER_DRIVER=clamav`, opt-in, ~1 GB RAM for daemon plus signatures, against a `lean` target of ~1 GB total |
| **Size caps and quotas** | WhatsApp permits ~16 MB images and ~100 MB documents. Candidate CVs accumulate quickly |

**NOT parked — build with the first byte:** how files are **served**. Storing an attachment is
harmless; serving it is where the exploit lives. An HTML or SVG file served from the app's own
origin is stored XSS against a logged-in session, and the attacker only has to message it. So
from the outset: `Content-Disposition: attachment`, content type from **magic bytes** rather
than the filename, never rendered inline, and served behind the same authentication as
everything else. Twenty lines at build time; very painful once file URLs are in circulation.

**On VirusTotal**, since it is the obvious reach:

- **Hash lookup** is privacy-safe — a digest reveals nothing — but nearly useless for this
  corpus. VT only knows files it has seen, and every CV is a unique document. The answer is
  "unknown" essentially every time.
- **Uploading the file is a data-protection breach.** VirusTotal's public API shares submitted
  samples with its security-community corpus, where paying subscribers can download them.
  Submitting a candidate's CV publishes their name, phone, address and salary history to third
  parties, with no consent and no way back. Enterprise private scanning exists, but it is paid
  and still a transfer to a third party. **ClamAV, locally, is the answer** — nothing leaves.

**What brings it back:** enough stored media for retention to matter, a real erasure request, or
the first deployment onto a host where an unencrypted uploads directory is not acceptable.

**Cost of deferring:** encryption is the expensive one to retrofit — it means rewriting every
stored file, and the storage key layout should therefore allow a per-file marker from day one
so a mixed estate is readable during a migration.

---

## D-12 · Resume parsing and ATS-friendliness scoring

**Not deferred — out of scope for this repository, permanently.**

Recorded so it is not re-proposed. `docs/01-vision-scope.md:39` is explicit: *"Nothing
domain-specific in the schema. No `candidate`, no `job`, no `deal`."* Judging whether a résumé
is ATS-friendly is recruitment-domain by definition, and putting it here would break the single
rule that makes this product reusable by anyone who is not a recruiter — which is exactly how
the previous system became un-reusable.

**Where it belongs:** a module beside the job portal, consuming this CRM over HTTP, in the same
relationship this CRM already has with it (`docs/16-integration-jobportal.md`). This side
receives the file, stores it and exposes it through the API; the other side fetches it and makes
a judgement about it.

**What this repository owes that module:** a stable way to fetch an attachment and know which
contact it came from. Nothing more.
