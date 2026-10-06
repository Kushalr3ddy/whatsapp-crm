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

## D-2 · Jurisdiction-specific compliance (data residency, consent enforcement, DLT, …)

**What:** any *region-specific* legal machinery an operator's jurisdiction demands — data residency
(e.g. India's DPDP requiring in-region hosting), enforced purpose-separated consent, DLT
registration for SMS, and so on.

**Not the product's to bake in.** This is a **generic, self-hostable tool used worldwide**
(2026-09-29 decision), so it ships **no** jurisdiction's compliance regime. Each operator meets
their own region's rules on their own deployment. The product's job is to provide neutral tooling,
not to be a DPDP (or GDPR, or TCPA) appliance. See `09-security.md`.

**What stays in place regardless — because it is anti-ban, not merely legal:** `do_not_contact`
(built), opt-out handling (**D-27**), and not blasting non-opted-in purchased lists. A number that
ignores these gets **banned** whatever the jurisdiction (`08-antiban.md`). An **optional**,
operator-driven `consent_record` (D-2 no longer mandates it) is available for operators who want a
paper trail for their own regime.

**What brings it back:** an operator (or a future hosted offering) that chooses to target a
specific jurisdiction and wants first-class support for its rules — at which point it is that
deployment's concern, layered on, not a core requirement.

**Cost of deferring:** none for the core. The neutral primitives that matter for keeping a number
alive are already built or pinned as anti-ban work.

---

## D-3 · Licence

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

## D-5 · Baileys 7.x

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

## D-16 · The legal front door (terms, privacy) — the operator's to provide

**What:** the terms and privacy policy a product puts in front of a person, and a record of who
accepted which version. **This is a generic worldwide tool, so the product ships none of these
baked in** (2026-09-29 decision) — an operator provides their own, appropriate to their
jurisdiction and business. If a future hosted/self-service offering needs acceptance tracking, a
`terms_acceptance(user_id, version, accepted_at, ip)` table is the shape, but it is that
offering's concern, not the core's.

**What the product keeps regardless — because it is anti-ban honesty, not legal boilerplate:**
**Baileys is unofficial and using it violates WhatsApp's Terms of Service; a number can be banned
permanently with no appeal.** This warning must be shown plainly to the operator before they link a
number — hiding it would be dishonest and useless, since it is *their* number at risk. It already
appears in `README.md`, `08-antiban.md`, `GETTING_STARTED.md` and the link screen, and it stays
whatever else is stripped.

**What brings the acceptance-tracking part back:** self-service signup, or a hosted multi-tenant
offering — i.e. the day someone other than the operator creates an account.

**Cost of deferring:** none for the core. The one thing that genuinely matters now — the
ban-risk disclosure — is already surfaced everywhere it needs to be.

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

---

## D-19 · Rich message templates — user-managed, Meta-aligned, with media and import — **PRIORITY**

> **Priority (2026-09-29):** in the near-term build queue, not "someday". Body variation (D-26)
> lands with this.


**What:** the grown-up version of canned replies. Today `canned_reply` is a plain
shortcut + text body with `{{name}}` substitution (built, P4 chunk 2). The richer version is a
**template system a user manages themselves** — a tab to create, edit and organise templates —
that can carry **media** (an image/document header, like Meta's templates) and can be **imported**
from somewhere rather than all hand-typed. See `docs/06-features/F4-templates.md`.

**Why parked:** text is the priority now, and the plain canned replies already cover the everyday
"don't retype the same opener" need. The richer shape should be **modelled on Meta's own template
format** (WhatsApp message templates: category, header/body/footer, variables, buttons, and the
approval flow), and that reference work has not been done — designing it before looking at Meta's
examples would mean redoing it. It also overlaps the Meta adapter (P8) and the Meta-window UI
(D-18), so it wants to land near them, not before.

**What brings it back — any one of:**

1. **Referring to Meta's template examples** and deciding how closely to mirror them (so the same
   template can later be submitted to Meta for approval, not just used over Baileys).
2. Users asking to **manage their own templates** in the UI rather than an admin seeding rows.
3. **Media in templates** becoming a real need (an image header, a document) — which also depends
   on outbound media existing at all.
4. The **Meta Cloud API adapter (P8)** landing, since approved templates are how you message
   outside the 24-hour window there.

**What stays regardless:** the simple `canned_reply` table and its insert-with-`{{name}}` behaviour
are fine as they are; this is additive on top, not a rewrite of them.

**Cost of deferring:** none. Canned replies work now; this is enhancement.

---

## D-20 · SQLite support for single-machine deployments

**What:** the option to run this against **SQLite** instead of Postgres, for a customer who
installs it as a self-contained module on their own machine rather than pointing it at a
centralised database.

**Why parked:** the current build leans on Postgres in load-bearing ways, so this is a
re-architecture, not a config flag:

| Depends on | Used for | SQLite equivalent |
|---|---|---|
| **Row-level security** | tenant isolation (the whole multi-tenant model) | none — would move to app-level enforcement |
| **LISTEN / NOTIFY** | the gateway command channel (link/unlink/send) | none — would move to polling |
| **jsonb + GIN** | `contact.custom_fields` and search | JSON1, weaker; different indexing |
| **triggers, `set_config`, transaction-scoped tenant** | isolation plumbing | rework |

The deployment decision (2026-09-27) is **multi-tenant on a centralised Postgres**, which needs
all of the above — so SQLite is not wanted for the primary mode. It only makes sense for a
**single-tenant, one-customer-one-machine** install, where multi-tenancy and RLS are moot anyway.

**What brings it back:** a concrete need to ship a single-machine install (a customer who will
not run Postgres). At that point this is its own track — likely a `DbDriver` port with a Postgres
adapter (RLS + NOTIFY) and a SQLite adapter (app-level scoping + polling), decided deliberately
and recorded here, since it changes the security model.

**Cost of deferring:** none today. It grows with every feature that reaches for a Postgres-only
capability without a fallback in mind — so new isolation/notify logic should stay behind the
helpers that already wrap it (`setTenant`, the gateway command channel), not spread raw.

---

## D-21 · The full import mapping wizard

**What:** the complete mapping experience from `docs/07-ingestion.md`, on top of the **simple**
import tab being built now (upload .csv/.xlsx → pick the phone/name/email column → preview →
commit). The full version adds: multiple identity rules, per-column **transforms**
(trim/lower/upper/digits), **keep vs drop** unmapped columns, and **saved, reusable mappings** so
the same spreadsheet shape need not be re-mapped every time.

**Why parked:** the simple tab covers the real "upload a sheet of contacts" need with far less
UI. The wizard is worth building once there is a recurring import shape that the simple picker
cannot express, or enough imports that re-mapping each time is the annoyance.

**What brings it back:** a column layout the simple mapping cannot handle (several phone columns,
a name split across columns, transforms needed before matching), or repeated imports of the same
shape.

**Cost of deferring:** low — the API already accepts a full versioned mapping
(`mappingSchema` in `apps/api/src/routes/imports.ts`), so this is a UI-side expansion, not a
backend change. The simple tab posts a subset of that same mapping.

---

## D-22 · Row-level de-duplication with a diff-style review

**What:** de-duplication *within and against* an import, resolved by a person — not just the
file-level hash check that exists now. When an incoming row matches an existing contact (or
another row in the same file), **show the two side by side** (git-diff style, or something
friendlier — highlighted field differences) and let the user **choose which version wins**,
field by field or whole-row.

**Why parked:** the file-hash check (refuse the same bytes twice, `?force=true` to re-run) is
enough to stop the accident that actually happens — importing the same sheet twice. Row-level
merge review is a much larger interaction and belongs with the full wizard (**D-21**), not the
simple tab.

**What brings it back:** imports that legitimately overlap existing contacts often enough that
"which value is right?" needs a human answer rather than the current identity-rule precedence.

**What exists to build on:** identity resolution already matches a row to an existing contact
(`packages/core` import path), and the per-row ledger (`import_row`) records each outcome — so
the data to diff is already produced; this is the review UI and the merge-choice on top.

**Cost of deferring:** low. The current precedence (a sparse row cannot overwrite richer data,
M9) is a safe default; this replaces "safe default" with "user's explicit choice".

---

## D-23 · Inbox search (F3 AC-7) — **PRIORITY**

> **Priority (2026-09-29):** in the near-term build queue. One thing to settle first: the
> blind-index vs. trigram decision on encrypted message bodies (below) — contact-field search can
> ship without waiting on it.


**What:** search across message bodies and contact fields — the last substantial P4 inbox piece.

**Why parked:** not blocking, and it carries a real **design decision** that should be made
deliberately rather than in passing: message bodies are **encrypted at rest** (`body_enc`), so
plaintext cannot be indexed. The two options —

| Option | What it buys | Cost |
|---|---|---|
| **Blind index** (deterministic HMAC per token/word, already have `kms.blindIndex`) | exact-term match over encrypted bodies without decrypting | no partial/fuzzy match; tokenisation choices leak some structure |
| **`pg_trgm` / full-text on decrypted text** | fuzzy, partial, ranked | requires a searchable plaintext copy — reopens "why is it encrypted at all" |

Contact fields (name, external ref) are not encrypted and can use `pg_trgm` directly regardless;
the decision is really about the message bodies.

**What brings it back:** an operator needing to find an old thread by its content often enough
that scrolling is the bottleneck. Kushal asked to keep it as a reminder (2026-09-28).

**Cost of deferring:** none — additive, and contact-field search can land first without touching
the encrypted-body question.

---

## D-24 · Typing simulation (P6 anti-ban layer 3) — **LANDED 2026-09-29**

**Built.** Before each send the gateway emits a `composing` presence to the recipient, pauses a
beat proportional to the message length (`typingDelayMs` in `@crm/core` — Gaussian on the per-char
rate, clamped 0.7–8 s), then clears it with `paused`, at the one send chokepoint in `handleSend`.
Opt-in via `SEND_TYPING_SIMULATION` (default on), cosmetic and best-effort — a failed presence
update is swallowed and never fails the send. The `ChannelProvider` port gained an optional
`typing(sender, to, state)`, implemented by the Baileys adapter (`sendPresenceUpdate`) and the
fake (records the calls so a test can assert `composing` fired before the send). The beat is a
**compressed** pause, not literal 45-WPM typing time: a 30-second "typing…" bubble before every
send would stall the paced queue for no anti-ban gain, since the tell being removed is the
*instant* send, not a fast one. Original note kept below for the reasoning.

**What:** making an outbound send *look* human — emit a `composing` presence update to WhatsApp,
wait a realistic beat proportional to the message length, then send. The bot-behaviour half of
anti-ban, distinct from the pure pacing of layers 1–2 (warmup, ceilings, jitter, all built).

**Not to be confused with D-17.** D-17 is *agent* presence/typing in the shared inbox — showing a
teammate that a colleague is typing. This is the **sender** simulating typing at the WhatsApp
peer. Same word, opposite direction: D-17 is a human being shown to a human; this is a machine
pretending to a machine.

**Why parked:** Kushal set it aside (2026-09-28) to look at the rest of P6 layers 3–6 first. It is
gateway-side (the socket lives in `apps/gateway`), and it wants to land alongside the other
behavioural layers so the send path's human-rhythm logic is designed once, not bolted on in
pieces. Layers 1–2 already cap a burst; typing simulation is polish on *how* each individual send
looks, which matters less than the layers that decide *whether* and *when* to send at all.

**What brings it back — any one of:**

1. **Deciding to build P6 layers 3–6 as a slice** — typing simulation is the cheapest of the four
   and the natural first or last touch on the send path.
2. A real signal that instant, zero-delay sends are a ban vector for this number (health scoring,
   layer 6, would surface it).
3. Circadian pacing (layer 4) landing — once sends follow a daily rhythm, per-send typing is the
   obvious finish so a send inside an active window also *looks* live.

**How hard later:** **small.** Baileys exposes `sendPresenceUpdate('composing', jid)`; the work is
a length-proportional delay with jitter (reuse the Gaussian jitter already written for layer 2)
inserted at the one send chokepoint in the gateway, plus a test that the presence fires and the
delay is bounded. No schema change, no new table.

**Cost of deferring:** none — additive, touches only the gateway's send path, and layers 1–2
already provide the actual burst protection.

---

## D-25 · Outbound media (sending files) — **LANDED 2026-10-05**

> **Built.** `POST /api/v1/conversations/:id/attachments?filename=&caption=` takes the file as the raw
> request body (16 MB cap, `FILE_TOO_LARGE` otherwise). The type is decided from the bytes
> (`detectMediaType`): images, video, audio, PDFs and ZIP/Office containers are accepted; HTML, SVG and
> anything unrecognised is refused `415 UNSUPPORTED_FILE_TYPE`, never stored. `storeOutboundMedia`
> (`@crm/core`) stores it exactly like an inbound attachment (random key, per-org sha256 dedup) inside
> the request's tenant transaction, and the message is queued with `media_id` and the caption as its
> body, subject to the thread lock and `messages:send`. The gateway reads the file back from storage
> (`WorkContext.storage`) and `OutboundContent.freeform` now carries `media` (bytes + type + filename,
> replacing the unused `mediaUrl`); the Baileys adapter sends images/video/audio natively and the rest
> as a named document (`toBaileysContent`). It passes the same anti-ban pacing as any send. The web
> composer has a 📎 attach button (reply mode only). **Not built:** documents over 16 MB (WhatsApp allows
> ~100 MB), voice-note (`ptt`) sends, outbound media in campaigns, and templates with media (D-19).
> Original note kept below.

**What:** sending an image or document, not just receiving one. Inbound media is fully built —
downloaded, typed from magic bytes, stored, served, and shown in the thread — but the **send path
is text-only**: `POST /messages` takes only a `body`, and `handleSend` calls the provider with
`{ kind: 'freeform', body }` and no attachment.

**Why pinned rather than built now:** parked only to be scheduled deliberately, **not
deprioritised — this is the top of the queue.** It is the most visible half-built feature (you can
receive a CV but not send one back), and it is a contained vertical slice because the hard part —
storage, typing, unguessable keys, safe serving — already exists for inbound.

**What it takes (so it is not re-derived):**
- An **upload endpoint** (or multipart on `POST /messages`) that stores the file through the
  existing `StorageDriver` and creates a `media_asset` row, exactly as inbound does.
- Carry `media_id` on the queued `message` (the column already exists).
- Extend the send path: `OutboundContent` / `handleSend` pass the file to `provider.send`, and the
  Baileys adapter sends it as an image/document. The `ChannelProvider` port's `freeform(text,
  media?)` already anticipates this — `media?` is declared and unused.
- The composer in the web inbox gets an attach control.

**What brings it back:** it is the next build once the current one lands. No trigger needed beyond
scheduling it.

**Cost of deferring:** real but bounded — the product can receive files and not send them, which
is a visible gap for a CRM whose contacts send CVs. No data is lost by waiting; it is a missing
capability, not a defect.

---

## D-26 · Campaign body variation (spintax + per-recipient) — **LANDED (both halves)**

> **Built (2026-09-29):** the per-recipient rendering is done. `renderBody` in `@crm/core`
> (`body-variation.ts`) resolves **spintax** (`{Hi|Hey|Hello}`, nested, resolved first on the
> operator template) then fills **variables** (`{{name}}` / `{{contact.name}}` from the contact,
> inserted last so an odd display name can't corrupt the parse). `dispatchCampaign` renders each
> recipient's copy before encrypting it, so 500 sends are no longer 500 identical strings, and both
> campaign compose UIs hint at the syntax. **The identical-body guard is now built too** (2026-09-30):
> `dispatchCampaign` holds a sender to at most `IDENTICAL_BODY_DAILY_CAP` messages with the same
> `body_hmac` per rolling 24h (default 50), the excess left pending — moot when spintax varies the
> body, a real brake on a no-variation blast. The only remainder now is **richer variables beyond
> `{{name}}`** (e.g. custom fields), additive when wanted.

**What:** stop a campaign sending **byte-identical bodies** to everyone — spintax and
per-recipient variables so each rendered message differs, and the dispatcher refusing more than N
identical bodies in a window (`docs/06-features/F4-templates.md`, `08-antiban.md`). It is both a
template feature and an anti-ban signal.

**Why it was parked (and why it is fine to have waited):** the alpha *and* the beta are **closed**
(invited, controlled recipients, small volumes), so the identical-body ban signal is low-risk at
this scale and `do_not_contact` plus the other anti-ban layers cap the real exposure. It is now
prioritised because it rides with templates (**D-19**), which are prioritised — not because the
closed-alpha risk changed.

**What brings it back:** opening beyond the closed alpha/beta to real external recipients, or
campaign volumes large enough that repeated identical text becomes a fingerprint. Lands with D-19.

**Cost of deferring:** low while sends are small and to a known audience; it grows with volume and
openness. Worth stating plainly: **the engine's "refuse identical bodies" rule is not enforced
yet**, so this is a known soft spot, not a solved one.

---

## D-27 · Opt-out keyword handling (STOP / unsubscribe) — OUT OF ALPHA SCOPE (Kushal, 2026-10-06)

**What:** an inbound `STOP` / `UNSUBSCRIBE` (multi-language) that **automatically and irreversibly**
sets `do_not_contact` and drops the contact from every pending send. Distinct from the manual
`do_not_contact` flag, which exists — this is the *automatic* honouring of a person's reply.

**This is anti-ban first, compliance second.** Someone who cannot opt out just blocks or reports
the number instead, which tanks its quality rating and gets it banned (`08-antiban.md`) — so it
protects the number, not only a legal position, and is kept as engineering discipline whatever the
jurisdiction (the product bakes in no specific legal regime — see `09-security.md`).

**Why parked:** closed alpha/beta with invited recipients who can be opted out by hand, and the
manual `do_not_contact` gate already blocks sends — so the block/report risk is low at this scale.

**What brings it back:** the first recipient who is not on the team, or a public/open beta — once
strangers are messaged, an unhandled opt-out becomes a real block/report (ban) risk.

**What exists to build on:** `do_not_contact` / `dnc_reason` / `dnc_at` on `contact`, checked as
gate zero on every send. This is wiring inbound keyword detection to that gate, not new
infrastructure.

**Cost of deferring:** low while closed and small; **sharp** the day real strangers are messaged —
a missed opt-out becomes a block/report and a ban signal.

---

## D-28 · Dynamic audience segments ("segregation") — **MINIMAL SLICE LANDED 2026-09-30**

> **Built (2026-09-30), minimal slice as scoped with Kushal.** A `segment` table (migration 0017,
> RLS forced) stores an allowlisted `definition`; `@crm/core` `segments.ts` turns it into a **bound**
> SQL predicate (`buildSegmentPredicate` / `countSegmentMatches`) — the JSON-to-SQL seam is closed by
> construction: only known keys emit SQL, every value is a bound parameter, unknown keys are dropped
> (and the API's `.strict()` zod rejects them). Criteria in this slice: **has-tag**, **replied
> ever/never**, **last-contacted-within-N-days**, AND-combined, with `do_not_contact` and soft-deleted
> always excluded. `GET/POST/DELETE /segments` + `POST /segments/preview` (live count); campaigns gain
> a fourth targeting mode `from_segment_id`, resolved and **frozen** in `snapshotAudience`/`previewAudience`
> like every other audience. A `/segments` page builds one (tag/reply/recency), previews the count, and
> saves; the new-campaign form can target a segment. **Deliberately not built** (the "not a query
> language" line): custom-field equals, AND/OR grouping, nested trees, more operators — add only on a
> concrete need.

**What:** a saved **filter** that re-evaluates on read — "everyone tagged `pune` who replied in the
last 30 days" — table `segment` (`kind`, a `definition` jsonb, a cached count), and a campaign
targeting it (resolve to contacts and freeze at launch, the snapshot rule that already exists).

**Why parked (and why the near-term work covers the need without it):** selecting people is handled
for now by **contact search + tags + an explicit id list** (being built) and by **whole-import
targeting** (already built). The dynamic filter is only needed for *criteria-based* audiences, and
it carries the one real risk — a **filter engine** that turns saved JSON into SQL, which must be
parameterised over an **allowlist** of fields, never string-built (injection). That is worth doing
deliberately, not in a rush.

**What brings it back:** wanting to target by criteria ("who replied", "in this city") rather than
by hand-picking or by import. Keep the filter small when built (has-tag, field equals, replied/not,
last-contacted-within-N-days, AND/OR) — a CRM, not a query language.

**Cost of deferring:** none for the near term — hand-pick (search + tags + explicit list) and
whole-import targeting cover it.

---

## D-29 · An anti-ban "advisory mode" — warn but do not enforce — **BUILT 2026-10-06**

> **Built** as a per-number `enforcement` setting (admin-only, reason required, audited via `sender.enforcement_changed`; `POST /senders/:id/enforcement`). Advisory lets a number past the pacing / health / recovery / contact-graph / recipient-hours holds and the identical-body cap, counting each bypass (`advisory_bypass_count`, `advisory_last_bypass`) and showing a persistent red banner on the Numbers page. `do_not_contact`, consent and a disconnected socket stay hard. The recipient-experience gates (engagement lock, 14-day cooldown, duplicate-campaign) are built too and overridable per campaign by an admin (`POST /campaigns/:id/start` with `overrideGates` + `reason`). The text below is the original pin.

**What:** an operator toggle that keeps the anti-ban engine **computing and surfacing** its
signals — the at-risk / cooling-off banners, the pacing reasons, the health score — but stops it
**enforcing** them. In advisory mode a send is not held, paced, capped, or paused: it goes out, and
the operator watches the warnings and accepts the risk themselves. Today every gate blocks; this
would make (most of) them advisory.

**Why parked — and it is *resisted*, not merely unbuilt.** The whole engine exists because a
Baileys number is unofficial and a ban is permanent with no appeal (`08-antiban.md`), and the design
draws a deliberate line: the hard gates — per-sender daily cap, rate/burst, warmup ceiling — are
*"overridable by nobody, including an admin, with no code path to do so"*, because *"an override
would be used the first time someone is in a hurry, which is exactly when the ceiling matters"*
(the `daily_cap_override` comment in `pacing.ts`, which may only *lower* a limit). Advisory mode is
precisely that code path. It is defensible for someone who **knowingly** accepts the risk — a
throwaway number, a test, or an official Meta number where the ban risk does not apply — but it is a
loaded footgun, so it is a deliberate decision to make carefully rather than a quick flag.

**Non-negotiable if it is ever built:**
- **`do_not_contact` and missing marketing consent stay HARD even in advisory mode.** They protect
  the *recipient*, not the number — a person who cannot be un-messaged is a compliance and
  block/report problem, not a pacing preference (`08-antiban.md`, the two-classes-of-gate split).
- **Admin-scoped, audited, and loud.** An `audit_log` row on every toggle, and a persistent
  "advisory mode — anti-ban is NOT enforced" banner wherever a number or campaign is shown, so it
  can never be left on by accident.
- **Scope decided explicitly:** per-sender or per-org `enforcement: 'enforce' | 'advisory'`, checked
  at each gate in `handleSend` / `dispatchCampaign` — advisory computes the decision, records the
  warning, then proceeds.

**What brings it back:** a concrete, evidenced operator need to send past a ceiling knowingly; or
the **Meta Cloud API adapter (P8)** landing — the official channel has no ban risk, so its pacing is
legitimately looser, and *per-transport policy* is a cleaner home for "looser" than a global
override bolted onto the Baileys path.

**Cost of deferring:** none — the safe default (enforce) holds, and it is what protects the asset.
Building it early mostly adds a way to lose a number in a hurry. The **visibility** half an operator
actually needs already exists: the Numbers-page at-risk / cooling-off banners and the per-recipient
campaign results show *why* a number is quiet without turning enforcement off.

---

## D-30 · Media that fails to store is invisible to the operator

**What:** when a received file's bytes cannot be stored, the message is kept and marked
`mediaUnavailable`, and **only a log line** records why — nothing surfaces it for an operator and there is
no retry. Related: no size cap on an inbound download (D-11 holds the quota question).

**Why parked:** Kushal pinned it (2026-10-05) while other work was prioritised. Nothing is lost — the
message text survives — it is a missing signal, not a defect in what is stored.

**What brings it back:** the first real "where did that CV go?" or a media-heavy deployment.

**What it takes:** record the failure on the message (an `error_code` for media), show it in the thread,
and add a retry that re-downloads through the live socket while WhatsApp still has the file.

---

## D-31 · Per-org encryption keys (the DEK/KEK design), and key rotation — **PRIORITY (Kushal, 2026-10-06), still pinned**

**What:** `docs/22-encryption.md` describes a two-layer design — a master key (KEK) wrapping a per-org
data key (DEK) — plus rotation. Today `LocalKms` encrypts directly with one global key, holds exactly one
key version, and has no backfill job, so rotation is impossible in practice and one key covers every org.

**Why parked:** pinned by Kushal (2026-10-05). It is not a vulnerability at one tenant, only a missing
capability: no cheap KEK rotation, no crypto-shredding for tenant erasure, a larger blast radius.

**What brings it back:** a second tenant, a real key-rotation need, or any erasure obligation.

**Cost of deferring:** it grows with every message stored — the refactor is cheapest before there is real
history to re-encrypt (22-encryption.md, "Not built yet").

---

## D-32 · Encrypting contact identifiers (phone numbers and emails)

**What:** `contact_identity.value_normalized` holds phone numbers and emails in clear. `09-security.md`
lists `value_enc` among the encrypted columns — it does not exist. Encrypting needs the same
encrypt-plus-blind-index pattern message bodies use, with the UNIQUE constraint moved onto the digest.

**Why parked:** pinned by Kushal (2026-10-05). It also changes how contact search works (today a plain
`ILIKE`), so it should be decided together with D-23.

**What brings it back:** a deployment where a stolen database dump exposing every contact's number is not
acceptable, or any D-2 data-residency obligation.

---

## D-33 · P1 close-out and deployment

**What:** the compose file (`infra/compose/` is empty, so `docker compose --profile core up` does not
exist), the `email` and `secrets` drivers, and deploying anywhere — which is also when the production
database is chosen.

**Why parked:** held by Kushal (2026-10-05) — nothing needs it while the build is local.

**What brings it back:** the first deployment, or a second person who must run it.

**Note:** `ENCRYPTION_KEY` must be backed up separately from the database before any deployment.


**Decision (Kushal, 2026-10-06):** for now the `ENCRYPTION_KEY` lives locally in the `.env` file; back that file up separately from the database.

---

## D-34 · The Meta Cloud API adapter (P8) and the real-number pilot

**What:** the official, paid transport (templates, the 24-hour window, tier and quality tracking) and the
controlled pilot `docs/08-antiban.md` calls for — one number, a 7-day warmup, ≤ 50 messages/day, watched
daily — which is also the only way to confirm anti-ban #5–#8 behave on real WhatsApp.

**Why parked:** held by Kushal (2026-10-05) as pending.

**What brings it back:** a need for anything business-critical to go over the official channel (P8), or
the decision to take the engine from the simulation to a real number (the pilot).

---

## D-35 · Contact export to Excel (.xlsx)

**What:** the admin contact export (built 2026-10-06 as CSV and vCard) as an `.xlsx` too. Pinned by Kushal
("just csv for now"). CSV opens in Excel already; `.xlsx` adds typed columns and a styled header, using the
`exceljs` dependency the import already carries.

**What brings it back:** someone asking for a formatted workbook rather than a CSV.

---

## D-36 · Contact import from a vCard (.vcf)

**What:** loading contacts from a phone's `.vcf` export (names, numbers, emails). Pinned by Kushal. The
shape is known: parse the vCard to rows and feed the existing import pipeline, the way an `.xlsx` is
converted to CSV, so duplicates and phone normalisation behave identically.

**What brings it back:** the first operator with their contacts on a phone rather than in a spreadsheet.

---

## D-37 · Meta tier and quality tracking, feeding the health engine

**What:** per Meta sender, poll the Cloud API for its **messaging tier** (250/day → 1K → 10K → 100K →
unlimited; Meta re-evaluates about every 6 h, advancing on unique customers over a rolling 7 days) and its
**quality rating** (green / yellow / red, driven by blocks and reports). Store both on the sender, show them
on the Numbers page, and feed them into the same health scoring and pacing: yellow slows, red pauses, and the
daily ceiling follows the tier instead of the Baileys warmup curve.

**Why parked:** pinned by Kushal (2026-10-06). Meaningless without the Meta adapter (D-34); every send today
goes over Baileys, which has no tiers or quality ratings.

**What brings it back:** D-34 landing.

---

## D-38 · Meta template submission, approval status, and the template-only window

**What:** the Meta-specific half of D-19 and D-18: submit a template to Meta for approval, sync its status
(approved / rejected / paused) back, and surface a rejection reason. Outside the 24-hour customer-service
window, only an approved template may be sent, so the composer shows the window countdown and locks to
templates once it closes (`conversation.window_expires_at` already exists for this).

**Why parked:** pinned by Kushal (2026-10-06). Needs D-19's template model and the adapter first.

**What brings it back:** D-34 and D-19.

---

## D-39 · Per-transport pacing policy and the Meta inbound/status webhooks

**What:** (a) pacing limits chosen **per transport**, so an official Meta number is legitimately looser than a
Baileys one, instead of one global policy (this is also the cleaner home for what advisory mode, D-29, is a
blunt version of); (b) the Meta **webhooks** that carry inbound messages, delivery/read statuses and quality or
template updates into the same ingestion and receipt paths Baileys events use today.

**Why parked:** pinned by Kushal (2026-10-06). Part of the Meta adapter's surface.

**What brings it back:** D-34 landing.

---

## D-40 · Custom fields in imports, segments, and exports

**What:** custom fields (defined per org, built 2026-10-06) work on the contact screen, over the API, and as
`{{key}}` in campaign messages. Not yet: mapping a spreadsheet column onto a field during import, a segment
filter such as "city is Pune", and a typed column per field in the CSV export (it still dumps them as one
JSON cell). Also: renaming a field's label or editing a select's options after creation.

**Why parked:** the first version was kept small (Kushal, 2026-10-06).

**What brings it back:** the first import that carries columns an operator wants as fields.

---

## D-41 · The gateway runs outside row-level security — **PRIORITY (Kushal, 2026-10-06)**

**What:** the API sets the org on every request (`setTenant`), so the database itself refuses cross-org
rows. The gateway process mostly does not: `handleSend` and the sweeps (`sweepPendingWork`,
`dispatchCampaigns`' first query, read receipts, entropy, health scoring) query the database directly, so
there row-level security is not the safety net — only each query's own `WHERE org_id` is. (Per-campaign
work in `dispatchCampaigns` does use `tenantRunner`; the rest does not. Confirm the gateway's DB role
bypasses RLS when fixing.)

**Fix:** have the gateway enter the owning org's tenant transaction (`tenantRunner`) before each unit of
work — list work across orgs with a narrow privileged query, then run each job under `setTenant`. Add a
test that a gateway job for org A cannot touch org B's rows.

**Why parked:** harmless while one team (plus JobPortal) shares an install; becomes a real cross-org risk
the moment unrelated customers share one. Pinned as priority by Kushal.

**What brings it back:** now, as priority; certainly before any multi-customer hosting.
