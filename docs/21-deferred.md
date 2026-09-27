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

**NOT parked — and now built.** How files are **served** was the part that could not wait.
Storing an attachment is harmless; serving it is where the exploit lives. An HTML or SVG file
served from the app's own origin is stored XSS against a logged-in session, and the attacker
only has to message it. All of it landed with the first byte, in `apps/api/src/routes/media.ts`:
`Content-Disposition: attachment` on every response, content type from **magic bytes**
(`detectMediaType`) rather than the filename, never rendered inline, `X-Content-Type-Options:
nosniff`, and the same authentication as everything else. `tests/integration/media.test.ts`
holds a file whose name says PDF and whose bytes say HTML, and asserts it comes back as
`application/octet-stream`.

**Isolation does not extend to the filesystem, and this is the part to be careful about.**
Tenant isolation here is row-level security — forced on every tenant table and *measured* at
boot by `inspectDatabaseSecurity()`. RLS protects **rows**. Files live on a filesystem Postgres
cannot reach, so a stored attachment is protected only by whatever the download endpoint
remembers to check. The `media` row is covered; the bytes are not.

Two consequences, both now implemented:

1. **Every download resolves through the database** — file → message → conversation → org → the
   requesting principal — rather than trusting a path. The check that RLS performs for free on
   a row is written by hand for a file, in exactly one place: `resolveMedia()`.
2. **Storage keys are unguessable**: `org/<org>/media/<uuid>.<ext>`, built only by `mediaKey()`,
   never from the original filename and never sequential.

**On VirusTotal**, since it is the obvious reach:

- **Hash lookup** is privacy-safe — a digest reveals nothing — but nearly useless for this
  corpus. VT only knows files it has seen, and every CV is a unique document. The answer is
  "unknown" essentially every time.
- **Uploading the file is a data-protection breach.** VirusTotal's public API shares submitted
  samples with its security-community corpus, where paying subscribers can download them.
  Submitting a candidate's CV publishes their name, phone, address and salary history to third
  parties, with no consent and no way back. Enterprise private scanning exists, but it is paid
  and still a transfer to a third party. **ClamAV, locally, is the answer** — nothing leaves.

**What brings the parked half back:** enough stored media for retention to matter, a real
erasure request, or the first deployment onto a host where an unencrypted uploads directory is
not acceptable. Media now lands, so the clock on all three has started.

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

---

## D-13 · Access auditing — who *read* what · **LANDED**

**What:** recording reads, not just changes. Who opened this conversation, who downloaded this
attachment, who ran this export. The DPDP-shaped question.

**Trigger 1 fired: media landed, and this landed with it** rather than after, so there is no
gap at the start of the trail. Two actions exist today — `conversation.read` when a thread is
opened, and `media.downloaded` when a file is fetched, written *before* the transfer starts so
an abandoned download still counts. Both go in the same `audit_log`, as the table below says
they should. Listing the inbox is deliberately not recorded. Exports do not exist yet and join
this list when they do.

The volume question is unresolved rather than answered: nothing polls the thread endpoint
today, so it is one row per open. If P4's realtime work turns that into a poll, revisit it —
along with partitioning `audit_log` by month.

**Why it was parked, and what changed:** the audit log built today covers **state changes and authentication** — who
changed what, who signed in, who minted a key. That is the answerable half at this size. Read
auditing has a different cost shape: the table grows with *usage* rather than with *change*, so
a busy inbox writes an audit row every time someone opens a thread. Designing for that volume
before it can be measured means guessing.

It is also not yet useful. There is nothing sensitive to read: message bodies are already in
the inbox for anyone with access, and **attachments are not downloaded at all** (D-11). The
question "who read this CV?" cannot be answered because no CV is ever stored.

**What brings it back — any one of these:**

1. **Media lands.** The moment a candidate's CV is stored, "who opened it" becomes a real
   question, and it is far better to have the trail from the first file than to retrofit one
   and have a gap. This is the likeliest trigger and it is close.
2. **A DPDP access request**, or an obligation to show who has seen a data subject's record.
3. **More than a handful of agents**, where "who looked at this contact" stops being obvious
   from the fact that three people work here.

**Shape when it arrives**, so it is not re-derived:

| Decision | Leaning |
|---|---|
| What counts as a read | Opening a thread, downloading an attachment, running an export. **Not** every list query — a paginated inbox load is not a meaningful access event |
| Where it goes | The same `audit_log`, with `action` like `conversation.read`. A second table would split the answer to one question across two places |
| Volume | Revisit partitioning by month at the same time; `at` is already indexed for it |
| Sampling | Never. A sampled access log answers "probably nobody" to a question that deserves a real answer |

**Cost of deferring:** a gap in the trail for the period before it exists. That gap is harmless
while nothing sensitive is stored, and stops being harmless the day media lands — which is why
the first trigger above is the one to watch.

**Related, and deliberately out of scope:** the audit log lives in the same database as the data
it describes, so anyone holding the database can edit it. The `REVOKE UPDATE, DELETE` in
migration 0008 stops the *application* rewriting history, which is the realistic threat;
defending against a compromised database administrator needs append-only storage elsewhere —
a WORM bucket or an external log sink — and is a different problem.

---

## D-14 · The linked number receives nothing — `Bad MAC` on every inbound

**What:** the companion WhatsApp session can **send** but cannot **receive**. Re-linking the
number is the fix; it is parked until there is a reason to spend the number's stability on it.

**The evidence, so nobody re-derives it.** Inbound stopped at **2026-09-20 09:12 UTC** while
outbound kept working — messages queued through the API reached the contact with status `sent`
the same evening. On a gateway restart WhatsApp delivered **17 `"tag": "message"` frames** and
every one failed:

```
Session error: Error: Bad MAC
ERROR: failed to decrypt message
  key: { remoteJid: "110762928373833@lid", fromMe: true, … }
  err: SessionError: No matching sessions found for message
```

All 18 failures were `fromMe: true` — echoes of **our own** sends syncing back. Baileys
discards what it cannot decrypt **before** `messages.upsert` fires, which was confirmed by
instrumenting that handler: it logged **zero** events across a restart that pulled 17 frames.
So the application sees silence, not an error, and nothing in our code is at fault.

The companion's Signal session state has diverged from the peer's. The usual causes are two
clients sharing one set of credentials, or a lost write to `channel_auth_state`.

**Why parked:** re-linking is not free. It burns a pairing on a number that is unofficial,
bannable and has no appeal route (`docs/08-antiban.md`), and the number is currently stable in
every other respect. Nothing being built right now needs inbound.

**What brings it back — any one of these:**

1. **Verifying media end to end.** This is the real cost: the download step has never met an
   actual WhatsApp file. `storeMedia`, typing, serving and auditing are all tested; the one
   link from provider to bytes is not, and no test can close that gap.
2. **Anything that consumes inbound** — P4's assignment and collision detection, P5 ingestion,
   or P6 scoring sender health on real inbound traffic.
3. **A second number being linked**, since whatever corrupted this session would be worth
   understanding before it happens twice.

**Cost of deferring:** the queued messages that failed with `Bad MAC` are almost certainly gone
already — WhatsApp stops re-delivering once retry receipts are exhausted — so that cost is
sunk rather than growing. What does grow is the media blind spot: every further layer built on
top of an unverified download is a layer that has to be re-checked when it is finally exercised.

**Two gotchas that came out of diagnosing it**, both now in `HANDOFF.md`: a corrupt session
looks like a *half-working* link rather than a broken one, because sending establishes its own
session; and this gateway appears to see traffic only in reconnect flushes, since
`markOnlineOnConnect: false` has WhatsApp notify the phone and queue for the companion.

---

## D-15 · A documentation site

**What:** the 25 files in `docs/` served as a real documentation site — searchable, linkable,
with a landing page — rather than markdown read on GitHub. Prompted by
[wacrm.tech](https://wacrm.tech), which is the presentation this project's docs do not have.

**The brief, so it is not re-derived:** Vercel's documentation theme is the reference — a
restrained, mostly monochrome palette, one accent colour, generous line height, a persistent
left nav, a right-hand table of contents, and code blocks that are the loudest thing on the
page. **Better than the reference, not merely similar:** this project's docs carry decision
records and rationale rather than feature tours, so the design has to make long prose readable
first and API reference second.

**Why parked:** it is presentation, and the content already exists and is already good. A site
makes the docs easier to *find*, which is a problem this project does not yet have — there are
no outside readers. Building it now would also mean maintaining a second artefact while the
docs themselves still change weekly.

**What brings it back — any one of these:**

1. **The repository going public**, or the licence decision landing (**D-3**). Nobody browses a
   private repo's docs site.
2. **The OpenAPI spec existing.** A generated spec wants somewhere to be rendered, and that is
   the natural anchor for the whole site (`docs/15-api.md`).
3. **JobPortal's team needing to self-serve** the integration rather than asking.
4. **The first outside user**, for whom `git clone` to read the docs is a poor first impression.

**Cost of deferring:** low, and that is the point. The content is portable markdown with
relative links; any static site generator consumes it as-is. The risk is only that the docs
drift into GitHub-specific formatting — so keep links relative and avoid anything that only
renders on github.com.

**When it is built:** generate from `docs/` rather than copying. Two sources of truth for a
sentence is how one of them becomes wrong, and this project has already had that happen with
the API document claiming an OpenAPI endpoint that did not exist.

---

## D-16 · The legal surface: terms, privacy policy, and recorded consent

**What:** the things a product has to put in front of a person before it may act for them —
terms and conditions accepted at signup, a privacy policy, and a **record** of who accepted
which version and when. Distinct from **D-2**, which is the regulatory machinery (data
residency, DPDP consent enforcement for messaging, DLT registration); this is the front door.

**Why parked:** there is no signup. Accounts are provisioned with `npm run admin`, by the
person who owns the deployment, for people they already employ. There is nobody to show terms
to yet, and terms written before the product's shape settles would be rewritten anyway.

**What brings it back — any one of these, and the first is close:**

1. **Self-service signup**, or any account created by someone other than the operator.
2. **The repository going public** (see **D-3**, licence) — a self-hosted product ships terms
   its operators can adapt, not none at all.
3. **The first tenant that is not us.** The moment this holds another organisation's contact
   data, acceptance stops being a formality and becomes the basis for processing it.

**Shape when it arrives, so it is not re-derived:**

| Decision | Leaning |
|---|---|
| Where acceptance lives | Its own table — `terms_acceptance(user_id, version, accepted_at, ip)`. **Not a boolean on `app_user`:** a boolean cannot answer "which version did they agree to?", and that is the only question that matters when the terms change |
| Versioning | Terms are versioned and immutable once published. Re-acceptance is a new row, never an update |
| Blocking | Unaccepted current terms blocks the app, not the login — someone must be able to sign in to accept them |
| Audit | `terms.accepted` in the existing `audit_log`, same as every other act |

**The disclosure that is specific to this product, and the reason this is not boilerplate:**
**Baileys is unofficial and using it violates WhatsApp's Terms of Service.** A number can be
banned permanently with no appeal. Any terms this project ships must say so plainly to the
operator — hiding it would be both dishonest and useless, since the operator is the one whose
number is at risk. `docs/08-antiban.md` already carries the technical half of that sentence;
this is the half that has to be said out loud to a human before they link a number.

**Cost of deferring:** low while the only users are the operator's own staff, and sharp the day
someone else's data arrives — acceptance cannot be backdated, so a gap is permanent.

---

## D-17 · Presence, typing indicators and collision detection (F3 realtime)

**What:** the live parts of the shared inbox — showing that another agent is *viewing* a thread,
that they are *typing*, and by extension collision detection (two people not answering the same
contact at once). F3's AC-3. Distinct from **live inbound** (a new message appearing without a
refresh), which is a separate concern and is anyway blocked by **D-14**.

**Why parked:** it needs a transport the project does not have yet — a WebSocket (or SSE) channel
and a `conversation_participant` table — and its value is highest with several agents online at
once, which is not today's shape. The inbox already refreshes every 5 s by polling
(`apps/web/app/inbox/auto-refresh.tsx`), which is enough for one or two people.

**What brings it back — any one of these:**

1. **More than a couple of agents working one inbox**, where "did someone already reply?" starts
   to actually happen rather than being hypothetical.
2. **Live inbound being built** — once a realtime channel exists for new messages, presence and
   typing are cheap to add on the same channel, so they should land together rather than twice.
3. A concrete complaint of two agents double-replying.

**How hard later (so it is not re-guessed):** **moderate**, and most of the cost is the transport,
not the feature.

| Piece | Effort |
|---|---|
| `conversation_participant` table (`conversation_id`, `user_id`, `role`, `last_read_at`) + RLS | small — same pattern as `internal_note` (migration 0012) |
| A realtime transport (WS/SSE) the API and web share | **the real cost** — a new long-lived connection type; note the in-process-state caveat in `HANDOFF.md` (several replicas would each hold their own presence set, so this wants the shared cache layer from P9, or a Postgres `LISTEN/NOTIFY` fan-out like the gateway already uses) |
| Presence heartbeat + "viewing"/"typing" UI | small once the channel exists |

Because #2 makes presence nearly free once live inbound has a channel, the leaning is **not to
build presence on its own** — do it in the same slice as live inbound (which waits on **D-14**),
so the transport is paid for once.

**Cost of deferring:** none technically. The only loss is two agents occasionally replying to the
same contact, which polling's 5 s window narrows but does not close.

---

## D-18 · Inbox niceties: snooze, the Meta 24-hour window UI, keyboard shortcuts

**What:** three F3 acceptance criteria deferred as not-needed-now.

| Item | AC | What it is |
|---|---|---|
| **Snooze** | AC-6 | Hide a thread until a chosen time, then re-open it. Needs a `snooze_until` column and something to un-hide it on schedule. |
| **Meta 24-hour window countdown + template-only composer** | AC-9 | WhatsApp's *official* API only allows free-form replies within 24 h of the contact's last message; after that only approved templates. The UI would show the countdown and lock the composer. |
| **Keyboard shortcuts** | AC-10 | Hotkeys for reply / assign / resolve / next-previous thread. |

**Why parked:** none is load-bearing for the CRM working. Snooze is a workflow convenience; keyboard
shortcuts are a power-user speed-up; and the **Meta window UI is meaningless until the Meta Cloud API
adapter exists** — that is **P8 / D-5 territory**, and Baileys (the only transport today) has no such
window. Kushal called all three not required for now.

**What brings it back:**

1. **Snooze** — an operator asking to defer threads to "tomorrow" as a routine.
2. **Meta window UI** — the Meta adapter (P8) landing; build it *with* that adapter, not before.
3. **Keyboard shortcuts** — enough daily inbox volume that mouse-driving becomes the bottleneck.

**How hard later:** snooze is **small** (one column + a sweep query, reusing the same pattern as the
rest of the inbox); keyboard shortcuts are **small** and pure front-end; the Meta window UI is
**small on its own** but gated behind the much larger Meta adapter.

**Cost of deferring:** none — all three are additive and touch no existing behaviour.
