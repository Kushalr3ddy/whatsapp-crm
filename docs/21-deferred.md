# 21 · Deferred decisions

Things deliberately **not** decided yet, each with the condition that should bring it back.

A parked decision is not a forgotten one. The point of this file is that nobody has to
re-derive the reasoning, and nobody revisits something before the thing that would change the
answer has actually happened.

Format: what · why parked · **what brings it back** · what it would cost to do later.

**Marks.** ✅ = built (fully or as the slice that was scoped). ~~Struck out~~ = not needed in this
repository: it belongs to the other project or to its own module (Kushal, 2026-10-10), kept only so it
is not re-proposed.

---

## Status at a glance (updated 2026-10-20)

✅ done · ◐ partly built · ▶ working on it · 🔺 priority · ⏸ parked (not working on it for now) · 📌 pinned (not started)

| Pin | What | Status |
|---|---|---|
| D-1 | A lightweight database browser (Drizzle Studio or similar) | 📌 pinned |
| D-1b | Drizzle's query builder (as opposed to Drizzle itself) | 📌 pinned |
| D-3 | Licence | 📌 pinned |
| D-4 | The AI agent (F12) | ✅ built 2026-10-21 (settings, auto-reply, campaign tools, queue); its guardrails are D-81 |
| D-5 | Baileys 7.x | 📌 pinned |
| D-6 | UUIDv7 primary keys | 📌 pinned |
| D-7 | Turborepo, and splitting the queue driver | 📌 pinned |
| D-8 | Self-serve setup wizard, guided walkthrough, whitelabelling | ◐ partly built (what-next buttons) · ⏸ parked |
| D-9 | Generating `.env`, and a secrets driver | 📌 pinned |
| D-10 | What belongs in the inbox — broadcast output, and unknown senders | 📌 pinned |
| D-11 | Media at rest — encryption, retention, scanning, compliance | ◐ partly built (serving; rest parked) |
| D-13 | Access auditing — who *read* what | ✅ done |
| D-14 | The linked number receives nothing — `Bad MAC` on every inbound | ✅ done |
| D-15 | A documentation site | 📌 pinned |
| D-17 | Presence, typing indicators and collision detection (F3 realtime) | ✅ done |
| D-18 | Inbox niceties: snooze, the Meta 24-hour window UI, ~~keyboard shortcu | 📌 pinned |
| D-19 | Rich message templates — user-managed, Meta-aligned, with media and im | 📌 pinned |
| D-20 | SQLite support for single-machine deployments | 📌 pinned |
| D-21 | The full import mapping wizard | ▶ working on it · ◐ partly built (columns step, several phones, joined names; PR #83) |
| D-22 | Row-level de-duplication with a diff-style review | 📌 pinned |
| D-23 | Inbox search (F3 AC-7) | 📌 pinned |
| D-24 | Typing simulation (P6 anti-ban layer 3) | ✅ done |
| D-25 | Outbound media (sending files) | ✅ done |
| D-26 | Campaign body variation (spintax + per-recipient) | ✅ done |
| D-27 | Opt-out keyword handling (STOP / unsubscribe) | 📌 pinned |
| D-28 | Dynamic audience segments ("segregation") | ◐ partly built (minimal slice) |
| D-29 | An anti-ban "advisory mode" — warn but do not enforce | ✅ done |
| D-30 | Media that fails to store is invisible to the operator | ◐ partly built (reasons recorded; manual retry missing) |
| D-31 | Per-org encryption keys (the DEK/KEK design), and key rotation | ◐ partly built (key rotation) |
| D-32 | Encrypting contact identifiers (phone numbers and emails) | 📌 pinned |
| D-33 | P1 close-out and deployment | 📌 pinned |
| D-34 | The Meta Cloud API adapter (P8) and the real-number pilot | 📌 pinned |
| D-35 | Contact export to Excel (.xlsx) | ◐ partly built (CSV and vCard; no .xlsx) |
| D-36 | Contact import from a vCard (.vcf) | 📌 pinned |
| D-37 | Meta tier and quality tracking, feeding the health engine | 📌 pinned |
| D-38 | Meta template submission, approval status, and the template-only windo | 📌 pinned |
| D-39 | Per-transport pacing policy and the Meta inbound/status webhooks | 📌 pinned |
| D-40 | Custom fields in imports, segments, and exports | ◐ partly built (import into fields) |
| D-41 | The gateway runs outside row-level security | ✅ done |
| D-42 | Human takeover from an AI agent, inside a conversation | ◐ partly built: assigning the chat to a person is the takeover; no pause state |
| D-43 | Extra restriction-alert channels (webhook, email, canary self-test) | 📌 pinned |
| D-44 | Baileys 7 upgrade | 📌 pinned |
| D-45 | Link a `@lid` address to its phone number | ✅ done |
| D-46 | UI responsiveness — the app feels laggy when used fast | 📌 pinned |
| D-47 | Signup page, billing gate and beta-tester override | ⏸ parked |
| D-48 | Security test suite (OWASP) | 📌 pinned |
| D-49 | Revamp the browser (e2e) suite to industry standard, covering every UI | 📌 pinned |
| D-50 | Test the frontend and backend independently (modularity check) | 📌 pinned |
| D-51 | Deleted-message tracking | 📌 pinned |
| D-52 | Deleting previous campaigns | ⏸ parked |
| D-53 | Assignment model and message authorship | ✅ done |
| D-54 | Typing indicator and the "just replied, send anyway?" warning | ✅ done |
| D-55 | Licence enforcement ("DRM"): usage is blocked when an org has not paid | 📌 pinned |
| D-56 | Telemetry: metrics, tracing and error tracking beyond logs | 📌 pinned |
| D-57 | Run the import commit as a background job | 📌 pinned |
| D-58 | Public site and launch-readiness checklist | 📌 pinned |
| D-59 | File support in chat (Kushal, 2026-10-16) | 🔺 priority again 2026-10-21: **files in campaigns first** · ◐ partly built (rounds 1 and 2) |
| D-60 | Number fallback: message the first number that has a WhatsApp account | ✅ done |
| D-61 | Lighter web tier: plain React with refresh buttons instead of Next eve | 📌 pinned |
| D-62 | Ship as a single executable, if possible | 📌 pinned |
| D-63 | Centralised file store: S3-compatible storage alongside local | ◐ partly built (S3 driver) · 📌 pinned |
| D-64 | Database portability: move the database-side logic into the app so oth | 📌 pinned |
| D-65 | Bugs found running the alpha container on a VM (2026-10-17), not fixed | ◐ partly fixed (1 of 8) · ⏸ parked |
| D-66 | Motion on most pages, not just the sign-in screen | ◐ partly built (sign-in and Overview motion) |
| D-67 | Save a number or name onto a `@lid` chat, like "add contact" in WhatsA | 🔺 priority · ◐ partly built (channels ignored; mapping investigated) |
| D-68 | Campaign with no tagged people: tell the user to tag them first | ✅ done |
| D-69 | Chats available inside the job portal (and any other web app) | 📌 pinned |
| D-70 | Contacts page: refresh, admin-chosen columns, tidier layout, sort and  | ▶ working on it · ◐ built: tag fixes, Refresh, expandable rows, date range and order · ⏳ columns chosen by an admin is D-79 |
| D-71 | A big background picture for each tab | 📌 pinned |
| D-72 | Mobile-friendly UI | 📌 pinned |
| D-73 | "Message these people" right after an import | ◐ partly built (buttons) · ⏸ parked |
| D-74 | Add-number form: country-code dropdown and a numbers-only phone field | ✅ done |
| D-75 | Number assignment: who each WhatsApp number belongs to | 📌 pinned |
| D-76 | Notifications tab, number requests and approvals | 📌 pinned |
| D-77 | Admin controls: user scopes and number limits | 📌 pinned |
| D-78 | Email: invitations to join an organisation, via SMTP or an email API ( | 📌 pinned |
| D-79 | Contacts: columns chosen by an admin for the whole team | 📌 pinned |

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

## ~~D-2 · Jurisdiction-specific compliance (data residency, consent enforcement, DLT, …)~~

> ~~**Struck out (Kushal, 2026-10-10).** Region-specific legal machinery is the operator's, in the other project or its own module, not this repository's.~~ What stays here is only the anti-ban side (`do_not_contact`, D-27).

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

## D-4 · The AI agent (F12) — ✅ built 2026-10-21 (Kushal's "AI speedrun"; guardrails left for D-81)

**Built (PRs #86 to #93, all titled `ai-speedrun:`):** a provider-neutral model layer (`@crm/llm`: an OpenAI-format driver that covers
Gemini, Groq, OpenAI, OpenRouter and Ollama, plus native Anthropic; `none` stays the default); settings with a consent box; a bot user
that can own chats but cannot sign in; **auto-reply** on open chats assigned to it, with a hand-over tool; **campaign tools** (create,
pause, resume, edit; start only if the org allows it) and a one-contact `send_message`; "Write with AI" on the campaign form; the
**request queue** (one at a time per org, cancel while waiting); anti-ban warnings in the thread with an admin-only do-not-contact
override. User guide: `docs/CRM-user-tutorial.pdf`. Design and the list of what exists: `docs/06-features/F12-ai-agent.md`.

**Original reasons it was parked (kept for the record):**

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

> **In plain terms.** Two separate "maybe later" upgrades to how the code is built and how background jobs run.
>
> - **Turborepo** is a build helper for projects made of many packages (this one has an API, a gateway, a
>   web app and shared libraries). It remembers what it already built and skips it next time, so builds get
>   faster. Today `npm` workspaces are enough, because the project is small and builds are quick.
> - **The queue driver** is the part that hands background work (sending a message, importing a file) to
>   something that does it. Right now that something is **pg-boss**, which keeps the job list inside the
>   Postgres database we already have, so there is no extra server to run. **BullMQ** is the heavier option
>   that uses Redis and copes with many workers at once. We only switch when one machine of workers is not
>   enough, and because the queue sits behind an interface, switching does not touch the rest of the code.
>
> Nothing is broken and nothing needs doing until builds feel slow or the work outgrows one worker.

**Why parked:** npm workspaces are enough at this size, and `pg-boss` avoids running Redis at
all in the lean preset.

**What brings it back:** build times becoming annoying (Turborepo), or needing to scale workers
horizontally, at which point `pg-boss` stops being appropriate and BullMQ on Redis is correct.

**Cost of deferring:** none. Both sit behind interfaces already.

---

## D-8 · Self-serve setup wizard, guided walkthrough, whitelabelling — **PARKED (Kushal, 2026-10-20): not working on this for now**

**What:** a first-run wizard that provisions an org and its first admin in the browser, a guided
walkthrough for someone new, and the branding layer that makes the product not visibly one
company's.

**Why parked:** it is a coherent phase of its own rather than a feature, and none of it blocks
the in-house beta, where the two developers can provision by hand. It is also mostly **already
anticipated** elsewhere: P12's exit criterion is *"a stranger self-hosts it in under 10 minutes
from the README alone"*, and F11's Branding section already specifies product name, logo,
colours, favicon and sender display name as configuration rather than code.

**Raised to priority 2026-10-20 (Kushal)**, after starting over from a wiped machine and finding the manual setup
(secrets in `.env`, `db:setup`, a command-line `admin org`, then `dev:all`) slow and easy to get wrong. First slice: a **first-run
wizard** in the browser, shown when the database has no organisation, that creates the org and first admin (through the
existing `createOrgWithAdmin()` service) and shows the password once. Branding and the guided walkthrough come after.

**What brings it back:**
1. **A second deployment that neither developer runs** — the recruiter, another team, or a
   whitelabelled instance. The moment setup cannot be a phone call, it has to be a wizard.
2. Or: P12 proper, where the 10-minute self-host criterion has to actually be met.

**Cost of deferring:** low but not zero. The longer provisioning stays manual, the more
hand-created rows exist that no code path can reproduce — `sender_identity` already carries one
created by hand, and that single row caused two separate misdiagnoses before anyone worked out
where it came from. Keeping provisioning behind one `createOrgWithAdmin()` service, as decided,
is what keeps this cheap.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-1 ([#64](https://github.com/Kushalr3ddy/whatsapp-crm/issues/64)): "what to do next" links after each step. The ideal flow he describes: log in, link a number, import a sheet, open the tagged sheet, send messages.

✅ **"What next" after linking a number built 2026-10-20 (issue #64):** once a scan works, the card suggests "Import your contacts" and "Open campaigns" (suggestions only). The rest of the guided flow and the first-run wizard are still open.

**Plan written 2026-10-20:** see [`32 · Setup, signup, teams and billing`](32-onboarding-and-billing.md). The first-run wizard is phase 1 and the signup page is the same form behind an invite code (phase 2). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20:** parked again; the plan in [`32`](32-onboarding-and-billing.md) stays as the reference. Not working on it for now.

**Added 2026-10-20 (Kushal):** a **tutorial / walkthrough for first-time users after they sign up** (step-by-step tips on the first visit to each page, dismissible, with a way to replay it). Part of the guided flow listed here.

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

## D-11 · Media at rest — encryption, retention, scanning, compliance · ✅ serving built, the rest parked

**What:** everything about received files *except* storing and serving them, which is built as
the filesystem `StorageDriver` with provider-neutral keys.

**Parked, deliberately:**

| Question | Why it waits |
|---|---|
| **Encryption at rest** | Message bodies are encrypted; files would not be. A CV is *more* sensitive than the message carrying it — name, phone, address, salary. Encrypting costs cheap range requests and streaming, so it is a trade to make deliberately rather than by default |
| **Retention** | Specced at one year in `09-security.md`, with a nightly hard-delete job that does not exist |
| ~~**DPDP / erasure**~~ | ~~A deletion request has to reach the files, not only the rows — see D-2~~ Struck out (legal, 2026-10-10) |
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

**Update 2026-10-16:** an S3-compatible driver now exists (D-63), so **moving files to a bucket is the next
trigger**. Decide encryption at rest *before* pointing a real deployment at one: encrypting in the application
before upload (with the same key ring as message bodies) means a stolen bucket yields nothing, but it costs
range requests and means rewriting every stored file if done afterwards.

**Cost of deferring:** encryption is the expensive one to retrofit — it means rewriting every
stored file, and the storage key layout should therefore allow a per-file marker from day one
so a mixed estate is readable during a migration.

---

## ~~D-12 · Resume parsing and ATS-friendliness scoring~~

> ~~**Struck out (Kushal, 2026-10-10).** Lives in the job-portal project / its own module. Already out of scope here; recorded so it is not re-proposed.~~

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

## D-13 · Access auditing — who *read* what · ✅ **LANDED**

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

## D-14 · The linked number receives nothing — `Bad MAC` on every inbound · ✅ **CLOSED 2026-09-28**

> **Closed.** The number was re-linked, inbound was verified and media was proven end to end against a real
> WhatsApp file. The text below is the diagnosis, kept so the evidence is not re-derived.

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

## ~~D-16 · The legal front door (terms, privacy) — the operator's to provide~~

> ~~**Struck out (Kushal, 2026-10-10).** Terms, privacy and acceptance tracking are not built here.~~ The Baileys ban-risk warning shown before linking a number stays; that is honesty about risk, not legal boilerplate.

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

## D-17 · Presence, typing indicators and collision detection (F3 realtime) — ✅ **BUILT** (viewing: PR #28, 2026-10-12; typing and the send-anyway warning: D-54, PR #32, 2026-10-13)

> **Built:** who has a chat open, by a 12 s heartbeat polled with the inbox (no websockets), shown in the thread
> header and on the inbox row; a typing indicator; a soft "send anyway?" warning beside the owner/participant lock.
> Presence, typing and viewers polling are plain `fetch` calls to a route handler (`/inbox/[id]/live`), **not**
> server actions, because Next runs server actions one at a time and the polling queued in front of the person's
> own Send. Live push (SSE) was not needed. The original description below is kept for the reasoning.

> **Priority.** Raised 2026-10-10 together with D-53 (assignment model and message authorship): knowing who
> is looking at a chat, who is typing, and who wrote each message is one feature set. Build them in the same
> slice, on one realtime channel.
>
> **What the screen should show:** "Asha is viewing" and "Bilal is typing…" on a thread (and a small dot
> on the conversation list), a warning in the composer when someone else is already typing, and presence
> only for people who can see the thread. **What it must not do:** show anything to the contact; this is
> teammates only (the WhatsApp "typing…" the contact sees is D-24, a different thing).
>
> **State today (verified 2026-10-10):** nothing realtime. The inbox refreshes by polling every 5 s, and the
> thread lock (409 `THREAD_ASSIGNED`) is the only collision protection.

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

## D-18 · Inbox niceties: snooze, the Meta 24-hour window UI, ~~keyboard shortcuts~~

**What:** three F3 acceptance criteria deferred as not-needed-now.

| Item | AC | What it is |
|---|---|---|
| **Snooze** | AC-6 | Hide a thread until a chosen time, then re-open it. Needs a `snooze_until` column and something to un-hide it on schedule. |
| **Meta 24-hour window countdown + template-only composer** | AC-9 | WhatsApp's *official* API only allows free-form replies within 24 h of the contact's last message; after that only approved templates. The UI would show the countdown and lock the composer. |
| ~~**Keyboard shortcuts**~~ | ~~AC-10~~ | ~~Hotkeys for reply / assign / resolve / next-previous thread.~~ **Struck out (Kushal, 2026-10-10): not needed.** |

**Why parked:** none is load-bearing for the CRM working. Snooze is a workflow convenience; keyboard
shortcuts are a power-user speed-up; and the **Meta window UI is meaningless until the Meta Cloud API
adapter exists** — that is **P8 / D-5 territory**, and Baileys (the only transport today) has no such
window. Kushal called all three not required for now.

**What brings it back:**

1. **Snooze** — an operator asking to defer threads to "tomorrow" as a routine.
2. **Meta window UI** — the Meta adapter (P8) landing; build it *with* that adapter, not before.
3. ~~**Keyboard shortcuts** — enough daily inbox volume that mouse-driving becomes the bottleneck.~~ (struck out)

**How hard later:** snooze is **small** (one column + a sweep query, reusing the same pattern as the
rest of the inbox); keyboard shortcuts are **small** and pure front-end; the Meta window UI is
**small on its own** but gated behind the much larger Meta adapter.

**Cost of deferring:** none — all three are additive and touch no existing behaviour.

---

## D-19 · Rich message templates — user-managed, Meta-aligned, with media and import — deferred (priority withdrawn 2026-10-16)

> **Priority withdrawn (Kushal, 2026-10-16):** it was marked priority on 2026-09-29; it is back on the
> deferred list, not in the near-term queue. Body variation (D-26) was built without it.
>
> **How much it matters for anti-ban (assessed from this repo's own signal table in
> [08 · Anti-ban](08-antiban.md); not measured on a real number):**
>
> - **On the Baileys path, templates do not protect a number; the risk is the opposite.** The strongest
>   ban signals are reply ratio, contact-graph distance and block/report rate, and none of them is touched
>   by having a template library. The one signal templates do touch is *identical message bodies*
>   (rated High), and a library makes it easier to reuse one fixed body for everyone.
> - **That signal is already covered without templates:** spintax and `{{name}}` render a different body per
>   recipient (D-26), and a number may queue at most 50 identical bodies per rolling 24 h
>   (`IDENTICAL_BODY_DAILY_CAP`). So the floor is in place today.
> - **What a template system could add for anti-ban:** (1) several wording variants per template with weights
>   (the `template_variant` table), which varies messages more than spintax inside one text; (2) one place
>   to review the wording that goes to strangers, since content pattern matching is one of the detection
>   layers; (3) version history, so a drop in delivery or a restriction can be traced to a specific text.
> - **On the official Meta path it is not optional.** Outside the 24-hour window only an approved template
>   may be sent, its category sets the price and affects the quality rating, and marketing sends hard-stop at
>   a Low rating (`RB-03`). That is where templates matter for keeping a *number* healthy, and it arrives with
>   the Meta adapter (P8, D-34, D-38).
>
> **Net:** low to moderate value for the Baileys-only alpha, required once the Meta adapter exists.

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

> **See D-64** for the measured inventory of what depends on Postgres, and the shape a portable layer would take.

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

## D-21 · The full import mapping wizard — **WORK ON NOW (Kushal, 2026-10-20)**

> **Priority:** raised on 2026-10-10 while building the live walkthrough: production imports come from a Naukri
> Excel export, and its real layout is not in hand yet. Build this once that file (or a real sample of it) is
> available, so the wizard is shaped by the actual columns rather than a guess. Until then the synthetic
> Naukri-style workbook in `tests/live/naukri-sample.ts` stands in.

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


### A real Naukri recruiter export (2026-10-16)

Kushal supplied a real download from a recruiter (160 applicants to one job). **No row values are stored in
this repository**: the header row is in [`tests/fixtures/import-header-samples.json`](../tests/fixtures/import-header-samples.json)
and what follows is aggregate only. The file was a personal-data file (names, emails, phones, dates of birth,
home addresses), so keep it out of the repo and out of chat transcripts.

**Shape.** One sheet named `MySheet`, **82 columns**, one row per applicant, file named
`<Job Title>_<yyyymmddhhmmss>_<n>.xlsx`. Real Naukri headers, in order: `Job Title`, `Date of application`,
`Name`, `Email ID`, `Phone Number`, `Current Location`, `Preferred Locations`, `Total Experience`,
`Curr. Company name`, `Curr. Company Designation`, `Department`, `Role`, `Industry`, `Key Skills`,
`Annual Salary`, `Notice period/ Availability to join`, `Resume Headline`, `Summary`, then education
(`Under Graduation degree`, `UG Specialization`, `UG University/institute Name`, `UG Graduation year`, the
same four for post graduation and doctorate), `Gender`, `Marital Status`, `Home Town/City`, `Pin Code`,
`Work permit for USA`, `Date of Birth`, `Permanent Address`, then 33 recruiter-workflow columns (last activity,
pipeline stage, downloaded/viewed/emailed with who and when, calling status, five comment triples), `Source`,
ten `Ans(<screening question>)` columns specific to the job, and `Candidate profile` (a link).

**What is in it, as a mapping problem.**

| Finding | Detail | Consequence |
|---|---|---|
| **A third of phone cells hold two numbers** | 57 of 160 `Phone Number` cells (36%) are `9XXXXXXXXX, +<digits>`: a bare 10-digit number, a comma, then a second number with a `+`. The second part ranges from a lone country code (`+91`) to long strings. 103 cells are one bare 10-digit number and 1 is 12 digits | The importer's normaliser strips everything but digits and `+`, which glues the two together; **tested with fiction-range numbers, every two-number cell fails to normalise** (`2025550123, +12025550123` fails; `2025550123` alone passes). On this file that is about **36% of the people rejected as unusable phones** |
| Phones are stored as **text**, with no spaces or country code on the single ones | 10 digits, Indian default country needed | `defaultCountry: IN` is essential; already the default |
| `Name` is one column | 38 of 160 are ALL CAPS, 25 are a single word | Display-name tidying (title case) is a nice-to-have; no first/last split to handle here |
| `Email ID` | 46 of 160 contain capitals or spaces | Already lowercased and trimmed by the mapping |
| **`NA` means empty** | Used in almost every optional column (0% real data in the 33 workflow columns, 2% in doctorate, 19% in work permit) | An `NA` must be treated as blank, never imported as a value |
| Values are display text, not typed | Dates `19-Jun-2026`; experience `19 Year(s) 0 Month(s)`; salary `Rs 11.37 Lakhs` (also `Rs 9 Lakhs`); notice `1 Months`, `15 Days or less`, `Serving notice period` | Any numeric use (filtering by experience or CTC) needs parsing; the screening-answer columns hold clean numbers (`1137000`, `19`, `Yes`) and are easier to use than the display columns |
| Personal data beyond what messaging needs | Date of birth, permanent address, pin code, gender, marital status | The wizard should let a person **drop** these columns (`unmapped: drop`) rather than keep them in `import_row.raw`; with `keep` they are stored per row |
| The columns worth keeping as custom fields | `Current Location`, `Total Experience`, `Annual Salary`, `Notice period`, `Key Skills`, `Job Title` (the job applied for) | Needs D-40 (map a column to a custom field) |

**Built 2026-10-16: phone cells are lists, and `NA` is blank.** A phone cell is split on comma, semicolon,
slash, pipe and line breaks; each part is normalised; every valid, distinct number becomes a phone identity
on the same contact, the first as primary. Rules that are easy to get wrong:

- a part that is only a bare country code (`+91`) is ignored, as an empty second number;
- a bad part is dropped **only if another part is valid**, so one good number is never lost to a bad neighbour,
  and the original cell stays on the row ledger (`unmapped: keep`);
- a cell with nothing usable still fails the row, with the reason (text such as `not-a-phone` and too-short
  numbers are mistakes, not blanks);
- the same number written twice (`98…` and `+9198…`) is stored once;
- `NA`, `N/A`, `N.A.`, `nil`, `null`, `none`, `-`, `--` and `—`, as a **whole cell**, count as blank in phone,
  email, external-id and name columns. The one cost is a person whose entire name is "NA".

Code: `normalisePhoneCell`, `splitPhoneCell` and `isBlankMarker` in `packages/shared/src/phone.ts`, used by
`packages/core/src/ingestion.ts`. Tests: `packages/shared/src/phone.test.ts` and the "cells that hold more than
one number" block in `tests/integration/imports.test.ts` (fiction-range and existing fixture numbers only).
**Known limit:** if a row's second number already belongs to a different existing contact, that number is not
moved (the insert is skipped); the row still matches by its first number that is already on file. Merging such
contacts is D-22.

**Also built 2026-10-16: column scoring and a "rows to fix" box on the import screen.**

- **Column scoring.** On upload the server looks at the values in the first 200 rows of every column
  (`profileColumns` / `suggestColumns` in `packages/shared/src/column-guess.ts`): the phone column is the one
  whose cells parse as phone numbers (at least 60%, most matching cells wins, a phone-like header only breaks a
  tie), and the same for email; name follows the header and avoids those two. The response carries
  `suggestions` and per-column `columns` shares. The panel pre-selects from them, shows "N% of the values in
  <column> look like phone numbers", and warns in red when the chosen column is under 50%. A column called
  `Mob` or `Ph`, or `Contact Person` holding names, is now handled.
- **Rows to fix.** After Preview or Import, a small box lists the rows that could not be imported (sheet row
  number, the value as typed, the reason) and, more softly, rows that imported without one of their numbers
  (for example `9…, 1111111111` where the second is junk). It comes from the existing row ledger (a dry run
  already records it): `GET /imports/:id` now also returns `warnings`, and the run summary carries a `warnings`
  count. The ledger's `error` text column holds the note on a successful row. The sheet row shown is the
  ledger's data-row number plus one, because the header is row 1.
- Tests: `column-guess.test.ts`, the "column suggestions and rows to fix" block in
  `tests/integration/imports.test.ts`, and `tests/e2e/import-problems.spec.ts`.

Still true of the sample, not yet addressed: display values are text (`19 Year(s) 0 Month(s)`, `Rs 11.37 Lakhs`),
the personal-data columns can only be dropped by choosing `unmapped: drop` (the wizard UI for it is D-21), and
the columns worth keeping as fields need D-40.

### Column vocabulary from public sources (2026-10-16)

Because production data will not all come from Naukri, nine other header sets were collected from public
pages: header rows only, each marked published, reported or assumed in the same fixture. Many vendors show
their import template only as a download behind a login (Keka, Homerun, Lever, Zoho Recruit and Kredily list
fields in prose but not the exact headers), so most are "reported", not copied from a file.

What the importer's current auto-detect does with them (`apps/web/app/import/import-panel.tsx`: the first
header containing phone, mobile, number, contact or whatsapp is the phone; the first containing "name" is the
name; the first containing "mail" is the email). It finds a phone column in all of them. The gaps the wizard
has to close:

| Gap seen | Example | Effect today |
|---|---|---|
| **Several numbers in one cell** | Naukri `9XXXXXXXXX, +<digits>` (the real file above) | **Fixed 2026-10-16**: each valid number is imported |
| **Name split across two columns** | `First Name` + `Last Name` (datablist, LinkedIn, ATS templates) | Only the first name is kept |
| **Several phone columns** | `Phone 1`, `Phone 2`; `Contact No.` + `WhatsApp No` + `Alt Mobile` | Only one column can be mapped in the UI (the API mapping already accepts several phone rules) |
| **A phone-like word in a non-phone header** | `Contact Person`, `Total Number of Reviews` | Could be picked as the phone; the person can correct it |
| **No email column at all** | WhatsApp bulk-sender sheets, JustDial lists | Fine; email is optional |
| **Extra columns worth keeping** | `Current CTC`, `Notice Period`, `Total Experience`, `City` | Land in `import_row.raw` only; custom fields are D-40 |

That is the evidence for the wizard's first features: **split a multi-number cell, map more than one phone
column, concatenate columns into a name, treat `NA` as blank, drop columns, and map a column onto a custom
field.**

---|---|---|
| **Name split across two columns** | `First Name` + `Last Name` (datablist, LinkedIn, ATS templates) | Only the first name is kept |
| **Several phone columns** | `Phone 1`, `Phone 2`; `Contact No.` + `WhatsApp No` + `Alt Mobile` | Only one number is imported; the others are dropped |
| **A phone-like word in a non-phone header** | `Contact Person`, `Total Number of Reviews` | Could be picked as the phone; the person can correct it |
| **No email column at all** | WhatsApp bulk-sender sheets, JustDial lists | Fine; email is optional |
| **Number written as text, spaced or with `+`** | `+91 98…`, `098…` | Handled by phone normalisation |
| **Extra columns worth keeping** | `Current CTC`, `Notice Period`, `Total Experience`, `City` | Land in `import_row.raw` only; becoming custom fields is D-40 |

That table is the evidence for the wizard's first three features: **concatenate columns into a name,
map more than one phone column, and map a column onto a custom field.**

**Added 2026-10-17 (Kushal):** make the **column selector and the preview bigger** on the Import screen (the pickers, the
"keep these columns" box and the sample table are small for a sheet with ~80 columns). Picking columns to keep as custom
fields is built (PR #56); the size and layout of this step are what is left.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-2 ([#65](https://github.com/Kushalr3ddy/whatsapp-crm/issues/65)): show how many rows the file has. **Kushal's decision:** drop the Upload button; choosing or dropping a file uploads it straight away, and an invalid file or one without enough rows shows an error. Issue-10 ([#72](https://github.com/Kushalr3ddy/whatsapp-crm/issues/72)): the Match columns step is confusing. **Decisions:** add a big line after phone, name and email are chosen saying to select the columns to be stored (today only a small "Keep these columns on each contact" label), and a line above the preview: "Preview of all the columns you have selected from the excel/csv: <file name>".

✅ **Alpha-feedback issues 2 and 10 built 2026-10-20 (issues #65, #72):** choosing or dropping a file uploads it at once (no Upload button) with the row count and file name shown, and a file with no people is explained; the columns step has a plain "Which column is which?" and a big "Select the columns to be stored" line, and the preview shows only the chosen columns under "Preview of all the columns you have selected from <file>". The rest of the wizard is still open.

**2026-10-20: work on this now.** Built: upload on choosing a file, the clearer columns step and the trimmed preview. Still to do: several phone columns, joining first and last name, and dropping personal-data columns.

**Added 2026-10-20 (Kushal):** make the **column selector and the preview wider and bigger, with a slightly bigger font** on the Import screen. **Do not do it if it breaks the mobile layout later** (D-72): check phone width first, and prefer a layout that is roomy on a desktop and still scrolls cleanly on a phone.

**2026-10-20:** Kushal wants to see a **preview (mockup) of the remaining changes before any building**: several phone columns, joining first and last name, dropping personal-data columns, and the wider selector. Preview first, then go ahead.

✅ **Built 2026-10-21 (the previewed design):** the Match columns step is now divided into sections (file, phone columns, name and email, columns to store, preview, tag and import). **Several phone columns** can be ticked and are tried in order (a person with two numbers keeps both); a **first-name column plus a last-name column** are joined as written, never shortened (`Anita Sharma`; a one-letter first name becomes `a.sharma`); **personal-looking columns** (date of birth, pay, address, government ids) are marked and cannot be ticked while "never store columns marked personal" is on; the columns box scrolls; text is slightly bigger. Still open from this pin: dropping personal-data columns by an admin-set list, saved mappings, per-column transforms.

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

## D-23 · Inbox search (F3 AC-7) — **PINNED, research later (Kushal, 2026-10-20)**

> **Priority (2026-09-29):** in the near-term build queue. One thing to settle first: the
> blind-index vs. trigram decision on encrypted message bodies (below) — contact-field search can
> ship without waiting on it.


> **Decision (Kushal, 2026-10-13): date-range-scoped search, decrypt-and-scan, no plaintext copy.**
> Search runs **only inside a date range the person chooses**: a preset (last week, last month, this
> month, last 3 months, this year) or a custom day, month or year range. The server decrypts that
> window's messages in the API process and matches there. Nothing is stored in plaintext and no new
> index is built. Contact search stays as it is (those fields are not encrypted). Not chosen, and why:
> a plaintext search column or a "recent chats unencrypted" table would put the most sensitive, most
> recent conversations in a stolen backup, which undoes the encryption at rest.
>
> **Measured** (2026-10-13, this machine, Node, AES-256-GCM): decrypt and scan **100,000 messages in
> about 0.8 s** (about 8 microseconds each), CPU only; a million would be about 8 s before database
> transfer. A month or a quarter of one org's messages is comfortably inside a second.
>
> **Research** (best practice for searching encrypted data): the standard Postgres full-text index
> cannot be built over encrypted columns; the two real families are blind token indexes (HMAC'd words
> or trigrams, as in SysReptor and CipherStash; they leak which rows share a token and lag behind
> writes) and client-side search (WhatsApp, iMessage, Tutanota; a poor fit for a shared server-rendered
> inbox). A blind token index is the upgrade path if volume ever outgrows decrypt-and-scan.
>
> **Open decisions (ask before building):**
> 1. **Which presets and ranges**, and the default when none is chosen (suggest: last 30 days, shown
>    clearly, with "search a wider range" one click away).
> 2. **A ceiling:** the widest range allowed, and a cap on messages scanned per search (so one
>    "everything since 2020" cannot hold the API). What the person sees when the cap is hit.
> 3. **Caching** (recommendation below). Whether to cache a search's results at all; whether to cache
>    an **empty** result; and what an overlapping range means (the same words searched over a wider or
>    shifted range).
> 4. **Substring or whole word**: does "pun" need to find "Pune"? Decrypt-and-scan does either.
> 5. **Notes and file names**: notes are plaintext already; whether they are searched with bodies.
> 6. **Audit:** whether searches are written to the audit log (a search over customer chats is a read
>    worth accounting for, like D-13).
>
> **Recommendation on caching.** Do not cache search *results* at first. At the measured speed a
> bounded range is cheap, and a result cache has real correctness traps: it goes stale the moment a
> message arrives, an empty result is the most likely to be wrong a minute later, and an overlapping
> range cannot be built from a cached neighbour without re-checking the edges and anything new. If it
> proves slow, cache one layer lower: a **memory-only, bounded, per-org cache of decrypted bodies**
> (never written to disk, gone on restart). Then every range overlaps for free, nothing about
> "which range was searched" has to be reasoned about, and a new message is simply absent from the cache
> until read. If a result cache is wanted anyway: key it on org, normalised query and exact range, give
> it a short life (tens of seconds), cache empty results only for that same short life, and never answer
> a different range from it.

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

**2026-10-20: more research and planning needed before building.** Design is decided but six decisions are open (see above).

**2026-10-20:** back to pinned; the research and planning wait. (A question about where files could be stored, raised under this number, was written up under D-63.)

---

## D-24 · Typing simulation (P6 anti-ban layer 3) — ✅ **LANDED 2026-09-29**

> **In plain terms.** When a person messages on WhatsApp, the other side briefly sees "typing…" before the
> message arrives. A bot that sends instantly never shows that, and WhatsApp can notice. Typing simulation
> makes each automated send show "typing…" for a short, length-based moment first, then send, so it looks
> like a person. It is one of the anti-ban behaviours. It is **not** the "someone is typing" indicator
> between teammates in the inbox; that is D-17.

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

## D-25 · Outbound media (sending files) — ✅ **LANDED 2026-10-05**

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

## D-26 · Campaign body variation (spintax + per-recipient) — ✅ **LANDED (both halves)**

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

## D-28 · Dynamic audience segments ("segregation") — ✅ **MINIMAL SLICE LANDED 2026-09-30**

> **In plain terms.** A *segment* is a saved rule that picks people automatically, such as "everyone tagged
> `pune` who replied in the last 30 days". A tag is a fixed list you maintain by hand; a segment is a
> question the system re-asks every time, so the answer is always current. (The word "segregation" in the
> title was Kushal's shorthand for this: separating the contacts into groups.) What is built is the small
> version: tag, replied or never replied, and contacted within N days, combined with AND. It is used when you
> create a campaign, where it shows a live count of matches and can be saved as an "audience" for reuse. Rules
> like "city equals Pune" or OR-groups were left out on purpose, so it stays a CRM filter and not a query
> language.

> **Update 2026-10-10:** segments are now built **inline in the new-campaign form** (a filter with a live count,
> optionally saved for reuse); the standalone screen became **Saved audiences**, reached from Broadcast. One-off
> filters are `segment.saved = false`. Custom-field filters remain pinned (D-40).

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

**Added 2026-10-20 (Kushal): the name "segment" is confusing; low priority.** It is jargon for a saved rule that picks a group
of contacts (tags, replied or not, last messaged within N days), re-checked each time it is used. It is **not required for the
core to work**: a campaign can go to a tag or to an import without it. What it adds is "A saved audience" and "Build a filter"
(with a live count) on the new-campaign page. The Segments screen is already folded into Campaigns, so the word shows up in only
a few places: the audience picker, the `/segments` page folder, the `/api/v1/segments` routes, the `segment` table and the docs.
To decide later: (1) rename what people see to **"Saved audience"** (the picker already says so) or "Smart list", and leave the
API and table names (renaming those is a migration and a breaking API change, rarely worth it alone); or (2) keep it and make it
earn its place with filters on custom fields such as city and skills (D-40, D-70).

---

## D-29 · An anti-ban "advisory mode" — warn but do not enforce — ✅ **BUILT 2026-10-06**

> **Update 2026-10-09:** do-not-contact is now actually enforced on every send path, and an admin can lift it per message or campaign (audited, with a reason); advisory mode still does not bypass it. The line below saying it stays hard is superseded.
>
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

## D-31 · Per-org encryption keys (the DEK/KEK design), and key rotation — ✅ **ROTATION BUILT 2026-10-13**; per-org keys still pinned (was **PRIORITY, Kushal, 2026-10-06**)

> **Built (rotation only, as chosen 2026-10-13):** a key ring (`ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY`,
> `ENCRYPTION_KEYS_PREVIOUS`); the gateway re-encrypts `message.body_enc` and `channel_auth_state.value_enc`
> onto the current key in the background, per org, a batch per sweep, pausable, resumable; the API and gateway
> refuse to start if data sits on a key version the ring cannot read; `npm run keys -- status | generate`; and
> the **Security** page in the web app walks an admin through it. Tests: `tests/integration/key-rotation.test.ts`.
> **Still pinned:** per-org data keys wrapped by a master key (the DEK/KEK design), and crypto-shredding a
> tenant by destroying its key. The blind-index key (`ENCRYPTION_INDEX_KEY`) deliberately cannot rotate.

**What:** `docs/22-encryption.md` describes a two-layer design — a master key (KEK) wrapping a per-org
data key (DEK) — plus rotation. Today `LocalKms` encrypts directly with one global key, holds exactly one
key version, and has no backfill job, so rotation is impossible in practice and one key covers every org.

**Why parked:** pinned by Kushal (2026-10-05). It is not a vulnerability at one tenant, only a missing
capability: no cheap KEK rotation, no crypto-shredding for tenant erasure, a larger blast radius.

**What brings it back:** a second tenant, a real key-rotation need, or any erasure obligation.

**Cost of deferring:** it grows with every message stored — the refactor is cheapest before there is real
history to re-encrypt (22-encryption.md, "Not built yet").

**Note 2026-10-20:** one encryption key per organisation is a prerequisite for letting untrusted organisations share a database; it is listed as "later" in the roadmap in [`32`](32-onboarding-and-billing.md).

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

**Update (Kushal, 2026-10-13/14): hosting is cloud-only, and the plan is written.** [`docs/29-free-hosting-plan.md`](29-free-hosting-plan.md)
is the whole analysis. Constraints: no machine at home (the shelved homelab is out of reach); the AWS, Azure and
GCP free accounts were used in college and a card may not work; Oracle is burnt. **Finding:** no free, always-on
cloud host with 2 GB or more needs neither a card nor a first-time account. **Recommendation:** a 4 GB VPS paid by
UPI (about ₹600 first term, ~₹1,000/month renewal, in an India region), after a 72-hour test with one spare
number to see whether WhatsApp restricts the datacenter IP. **Open:** whether UPI works for him, whether
₹600–1,000/month is acceptable, whether the old GCP account is still active (the e2-micro Always Free tier is open
to existing customers), and whether Hiring Studios is a real company (startup credits). **What must be built on
our side either way:** production builds, a compose file, Caddy, migrations at start, a backup job, and an Arm/x86
test run (`infra/docker` and `infra/compose` are empty). Nothing is deployed.

---

## D-34 · The Meta Cloud API adapter (P8) and the real-number pilot

**What:** the official, paid transport (templates, the 24-hour window, tier and quality tracking) and the
controlled pilot `docs/08-antiban.md` calls for — one number, a 7-day warmup, ≤ 50 messages/day, watched
daily — which is also the only way to confirm anti-ban #5–#8 behave on real WhatsApp.

**Why parked:** held by Kushal (2026-10-05) as pending.

**What brings it back:** a need for anything business-critical to go over the official channel (P8), or
the decision to take the engine from the simulation to a real number (the pilot).

---

## D-35 · Contact export to Excel (.xlsx) · ✅ CSV and vCard export built (2026-10-06); `.xlsx` not

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

## D-41 · The gateway runs outside row-level security — ✅ **BUILT 2026-10-13** (was **PRIORITY, Kushal, 2026-10-06**)

> **Built:** every piece of gateway work now runs through a handle pinned to the owning org (`apps/gateway/src/tenant.ts`): each statement drops to `crm_app` and sets `app.org_id`, so Postgres refuses another org's rows. The sweeps list org ids with one privileged query and fan out per org; id-driven work (a send, a link, a connection event, a receipt) looks up its org first. Tests: `tests/integration/gateway-tenancy.test.ts`, and the whole gateway suite now runs as `crm_app`. **Still open:** the Baileys credential store (`channel_auth_state`) is read and written by the provider with only a sender id, outside this handle; it is encrypted and keyed by sender, but not yet tenant-scoped.

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

---

## D-42 · Human takeover from an AI agent, inside a conversation — ◐ partly built 2026-10-21

> **2026-10-21:** the working version is simpler than the design below. A chat belongs to whoever is its assignee, and the assistant only
> answers an **open chat assigned to it**, so assigning the chat to a person (or resolving it) is the takeover, and a reply it was
> still writing is dropped. Not built: the `automation_state` column, hand-back notes for the AI to read, and a "Take over" button.

**What:** when an AI agent is talking with a contact (a candidate, say), a person can stop it and continue the chat
from there, and optionally hand it back. Requested by an end user, 2026-10-09.

**Shape (design notes, nothing built):**
- A per-conversation `automation_state` (`auto` | `paused_by_human`) with who, when and an optional reason.
- A visible "Take over" / "Hand back" control in the thread header; the thread shows who has control.
- While paused the AI worker must not send, and inbound messages are routed to humans only; the composer unlocks.
- Every switch is audited. The thread lock (assignee) and all anti-ban pacing still apply to a human's messages.
- Hand-back can carry a note ("candidate asked for a call tomorrow") for the AI to read.

**Why parked:** the AI / automation runtime (F9) does not exist yet, so there is nothing to take over from. The
conversation model, thread lock and audit log it would build on all exist.

**What brings it back:** the first AI agent that sends on a number (F9), which must ship with this control.

---

## D-43 · Extra restriction-alert channels (webhook, email, canary self-test)

**What:** the silent-restriction tracker (docs/27, built 2026-10) alerts **in the app only**: a banner, a timeline and
a nav badge. Not built, by choice: an outbound webhook (Slack / Discord / JobPortal), email, and a **canary
self-test**, a few test sends a day from each number to a team-owned phone, the most reliable way to catch a delay on
an otherwise idle number.

**Why parked:** Kushal chose in-app only (2026-10-09). Email needs a provider configured; webhooks wait for F8.

**What brings it back:** an operator who is not looking at the app when a number is restricted.

---

## D-44 · Baileys 7 upgrade

**What:** moving from `baileys` 6.7.24 to the 7.x line. **Not required** (assessed 2026-10-09): npm `latest` is
7.0.0-rc14, still a release candidate, and 6.7.24 is the `legacy` tag, not deprecated and already patched for the known
advisory. Reports exist of 7.x rcs failing QR pairing where 6.7.23 worked, and of 463 timelocks on rc13.

**What would break:** inbound identity (LID becomes the primary address, the phone number moves to `remoteJidAlt`; our
`storeInboundMessage` keeps one identity per message, so phone contacts would fork into `wa_lid` duplicates); stored
sessions migrate one way to LID addressing (snapshot `channel_auth_state` first; a rollback is a re-link); more auth-state
key types (`lid-mapping`, `device-list`, `tctoken`, ...) and a heavier Postgres key store; `isJidUser` is now `isPnUser`;
`chats.phoneNumberShare` is replaced by `lid-mapping.update`; `fetchLatestBaileysVersion` is brittle; new WASM/libsignal
dependencies. The imports we use compile unchanged, and only `packages/channels/baileys/src/{index,auth-adapter}.ts`
touch Baileys.

**What brings it back:** a stable 7.0.0, or WhatsApp breaking 6.x. Do D-45 first. Needs a throwaway number to test.

---

## D-45 · Link a `@lid` address to its phone number — ✅ **BUILT 2026-10-10 (PR #6)**

> **Built:** the adapter reads `key.senderPn` / `participantPn` and `chats.phoneNumberShare`, the gateway links the
> address to the phone before storing the message, and `linkLidToPhone` adds the identity or merges two contacts.
> Limits stand: WhatsApp only sometimes supplies the number. The text below is the original pin.

**What:** messages from a `...@lid` address carry no number, so the contact shows none. Baileys 6.7.24 already exposes
the number sometimes: `message.key.senderPn` / `participantPn`, and the `chats.phoneNumberShare` event (`{lid, jid}`).
Our adapter ignores both. Reading them would attach a phone identity to the `wa_lid` contact and merge it into the
existing phone contact when one matches. WhatsApp does not always supply it (people who hide their number may never
resolve), and 6.x has no on-demand lookup.

**Why parked:** offered to Kushal, not yet scheduled (optional PR 6 of the 2026-10-09 plan). It is also the same change
D-44 would force, so doing it first de-risks the upgrade.

---

## D-46 · UI responsiveness — the app feels laggy when used fast

**What:** Kushal reports (2026-10-10) that the web app lags when he clicks through it quickly. His idea: keep Next.js
only for the few screens that need live updates (the inbox/thread) and make the rest (campaigns, contacts, import,
numbers, saved audiences) plain client-side React pages.

**What we know (not yet measured):** the inbox polls by `router.refresh()` on a timer
(`apps/web/app/inbox/auto-refresh.tsx`), which re-runs every server component for that route; the thread composer and the
Numbers link panel also poll; every page is a server-rendered round trip through the web server to the API, and local
use is `next dev`, which compiles each route on first visit. Which of these dominates is **unverified** — the first step is
to measure, not to rewrite.

**Candidate steps, cheapest first:** (1) measure on a production build (`next build && next start`) — dev mode alone may
explain much of it; (2) cut polling work: refresh only the thread list or message list, not the whole route, and back off
when the tab is hidden; (3) cache/dedupe the API reads the layout repeats on every navigation; (4) client-side data
fetching with a cache (e.g. SWR/React Query) for the list-heavy pages, so moving between them does not re-render on the
server; (5) only then the bigger split — a plain React SPA for the non-live pages — which is a large change that touches
auth forwarding (the UI forwards the user's session) and every server action.

**Why parked:** needs a measurement first, and a rewrite is a scope call for Kushal.

**What brings it back:** decide after step 1–2 numbers; step 5 only if they are not enough.

---

## D-47 · Signup page, billing gate and beta-tester override — **PARKED (Kushal, 2026-10-20): not working on this for now**

> **2026-10-17:** a **front-end-only** sign-up page exists at `/signup` (PR #53): it checks the fields in the browser and says nothing
> was created. The open decisions below still gate connecting it to a backend.

**What:** there is **no signup page** today — accounts and orgs come only from `npm run admin` (or the admin API).
Kushal wants a simple one (2026-10-10): a person signs up, and then (a) if they have **paid**, they land in the app
(or are sent to Billing to pay), and (b) a **beta tester** is sent to sign in, because an admin can **override the
payment requirement** for them so they can use the product without paying.

**Open decisions (ask before building):** which payment provider and whether payment is real in alpha (Billing is a
placeholder page today); whether signup creates a new *org* (self-serve tenant) or a user inside an existing org;
email verification (email is an optional driver, so a non-email path is needed); how a beta override is stored
(a per-org flag set by an admin, audited, with a reason — same shape as the DNC and gate overrides); abuse limits
(signup is the first unauthenticated write endpoint: rate limit, CAPTCHA/bot cost, org-slug squatting).

**Why parked:** it touches money, tenancy and the first public write route, so it needs Kushal's calls above first.

**What brings it back:** Kushal choosing the payment provider and the signup-creates-org question.

**Plan written 2026-10-20 (priority):** invite-only beta first, teammates added by an org admin (reset password, revoke access, never delete), payments after reading [`33 · Payment providers`](33-payment-providers.md); the design is in [`32 · Setup, signup, teams and billing`](32-onboarding-and-billing.md). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20:** parked again (it had been raised to priority with the billing plan). Not working on it for now; docs [`32`](32-onboarding-and-billing.md) and [`33`](33-payment-providers.md) are the reference.

---

## D-48 · Security test suite (OWASP)

**What:** a deliberate, repeatable security test pass against the running app, mapped to the **OWASP Top 10** and
**ASVS** for the API and the web UI. Candidate free / open-source tooling to evaluate (to be checked online before
choosing, not yet verified): **OWASP ZAP** (baseline + API scan in CI), **Nuclei** (template-based checks),
**Semgrep** (static rules for Node/TS/Next), **osv-scanner / `npm audit`** (dependencies), **gitleaks** (already in
CI), **Schemathesis** (property-based API fuzzing once an OpenAPI spec exists), and a hand-written suite for what
tools miss in *this* app: cross-org access (IDOR) on every route, CSRF on session routes, session fixation/expiry,
login throttling, file upload and download headers, and authorization by role/scope.

**Why parked:** needs the tool survey and a decision on what runs per-PR versus nightly; some pieces want an OpenAPI
spec (P9) first.

**What brings it back:** before any real customer data, and before the deployment decision (D-33).

---

## D-49 · Revamp the browser (e2e) suite to industry standard, covering every UI element

**What:** the Playwright suite grew feature by feature. Rebuild it on current best practice: **page objects /
fixtures** instead of copy-pasted selectors, role- and label-based locators only (no CSS), per-test isolated data
(no shared dev DB noise), **accessibility checks** on every page (`@axe-core/playwright`), a **coverage map** of
every page, control and state (empty, loading, error, permission-denied) so "all UI elements" is measurable,
cross-browser and mobile-viewport projects, deterministic waits (no sleeps), trace/video on failure, and a
smoke / full split so PRs stay fast. The live walkthrough (`tests/live/`) stays separate and manual.

**Why parked:** large, and best done after the UI settles (D-46 responsiveness may change the page structure).

**What brings it back:** the UI stops moving, or a regression the current specs miss.


---

## D-50 · Test the frontend and backend independently (modularity check)

**What:** prove the two halves really are separable. **Backend alone:** exercise the API purely over HTTP with no
browser and no web app (contract tests against an OpenAPI description, once it exists; Schemathesis-style
generation). **Frontend alone:** run the web app against a **mocked API** (e.g. MSW or a recorded fixture server) so
every page renders and behaves with no real backend, which also proves the UI only talks to the API over its
documented contract (`CRM_API_URL`). Add an automated **boundary check** (e.g. `dependency-cruiser`/ESLint import
rules) that fails if `apps/web` imports server code from `packages/*`/`apps/api` or the reverse.

**Why parked:** depends on the OpenAPI spec (P9) for the contract half; the boundary check could be done sooner.

**What brings it back:** P9, or the day a second client (JobPortal, a mobile app) consumes the API.

---

## D-51 · Deleted-message tracking

**What:** WhatsApp lets a person "delete for everyone", which reaches us as a revoke event for a message we
already stored. Today we do not act on it: the thread keeps showing the original text as if nothing happened.
Pinned (Kushal, 2026-10-10): record that a message was deleted, by whom (the contact, or one of our own
agents from the phone), and when.

**Shape when it arrives, so it is not re-derived:** the gateway turns the revoke into an event, the message row
gets `deleted_at` and `deleted_by` (the body is kept encrypted for audit unless an operator purges it), the
thread shows "this message was deleted" in place of the text with the original reachable by an admin, and a
`message.deleted` row goes in the audit log. Open question for Kushal: keep the original visible to agents, or
hide it as WhatsApp does for the recipient. Edited messages are the sibling case and could share the work.

**Why parked:** pinned, not scheduled.

**What brings it back:** Kushal's go-ahead, or the first "where did that message go?" from an agent.

---

## D-52 · Deleting previous campaigns — **PARKED (Kushal, 2026-10-20): not working on this for now**

**What:** campaigns can be cancelled but not deleted, so old drafts, cancelled runs and test campaigns pile up
in the Broadcast list (the dev database holds dozens). Pinned (Kushal, 2026-10-10): an operator needs to
delete previous campaigns.

**Shape when it arrives:** delete is allowed only for `draft`, `cancelled` and `completed` campaigns, never
a running or paused one. Prefer a soft delete (`deleted_at`, hidden from the list) so the messages already
sent, the per-recipient results and the audit trail stay intact; offer a purge for drafts that never ran. It
must not release the recipient-experience gates (a contact messaged by a deleted campaign is still inside
the 14-day cooldown), and it writes a `campaign.deleted` audit row. A "delete all cancelled" bulk action
would also clean up test runs.

**Why parked:** pinned, not scheduled.

**What brings it back:** Kushal's go-ahead.

**2026-10-20:** parked again. Not working on it for now.

---

## D-53 · Assignment model and message authorship — ✅ **BUILT** (authorship PR #26; owner + participants PR #27; 2026-10-11)

> **Built:** every outbound message records the signed-in agent (`sent_by_user_id`) and the thread names them
> ("Campaign" for bulk sends, "API" for an integration). The owner is the existing `assignee_user_id`; participants
> are a `conversation_participant` table, **admin-only to add or remove**, may reply, and count under "Mine";
> reassigning drops the old owner. **Not built from the table below:** per-person workload counts and capacity,
> bulk reassign, "reassigned" events shown inline in the thread, `collaborator`/`watcher` roles.

**The questions, answered so they are not re-asked:**

| Question | Today | Proposed |
|---|---|---|
| **Two or more chats assigned to one person?** | **Works.** `conversation.assignee_user_id` is per chat, so one person can own any number. There is no view of workload and no cap. | Keep. Add a count per person on the assignee list and in a "My chats" header, and optionally a per-agent capacity (Chatwoot and Respond.io both have one) that auto-assignment respects. |
| **One chat assigned to several people?** | **Not possible.** The column holds one user. | Keep **one owner** and add **participants**: a `conversation_participant` table (`conversation_id`, `user_id`, `role` = owner / collaborator / watcher, `added_by`, `added_at`, RLS like `internal_note`). The owner is who the chat is "assigned to"; collaborators are added by @mention or by the owner. This is also the table D-17 already wanted, so it is paid for once. |
| **What does the thread lock do with several people?** | Only the assignee (or an admin) may reply. | Owner and collaborators may reply; watchers may only add notes. Unassigned chats are open to everyone. A reassignment writes an audit row and an inline event in the thread. |
| **Who is typing / viewing?** | Nothing. | D-17: presence on the same realtime channel, per participant. |
| **Who wrote each message?** | **Stored in the schema, never written, never shown.** `message.sent_by` and `message.sent_by_user_id` exist, but replies from the UI record `sent_by = 'api'` and leave the user empty, and the thread shows no author on outbound messages (only notes show one). | Record the signed-in user on every reply (`sent_by = 'agent'`, `sent_by_user_id`), `campaign:<id>` for broadcast sends, `api` for an API key, `bot` later. Show a small author name and avatar on each outbound bubble and a "via campaign X" label on broadcast messages. Inbound messages show the contact, and the number they arrived on. |

**Edge cases to decide when it is built:**
- When the owner leaves the org or is deactivated, the chat becomes unassigned (the column already
  `SET NULL`s) and an audit row says why; collaborators stay.
- A contact with chats on two numbers is two conversations, so two possible owners. Keep that, and show the
  other conversation as a link in the contact panel.
- An admin and an API key bypass the lock today; keep that, and record who acted either way.
- Bulk reassign (everything of a leaving agent to another) belongs with this work.

**Why parked:** pinned as a priority, not scheduled; it needs Kushal's go-ahead on the owner-plus-participants
shape before any migration.

**What brings it back:** Kushal's go-ahead. Authorship (writing `sent_by_user_id` and showing it) is a
small first slice that needs no realtime and can ship alone.


---

## D-54 · Typing indicator and the "just replied, send anyway?" warning — ✅ **BUILT 2026-10-13** (PR #32)

> **Built:** typing pings from a reply box with text (every 3 s, 8 s lifetime); "Priya is typing…" in the header
> and on the inbox row; `POST /messages` returns `409 COLLISION` naming the person when another agent replied in
> the last 15 s or is typing, and the composer offers Send anyway (`acknowledgeCollision`). API keys are exempt.
> Text replies only; sending a file does not check. Migration 0026 adds `conversation_presence.typing_at`.

The second slice of [D-17](#d-17). The first slice (who has a chat open, by heartbeat) shipped in PR #28; this is
the rest of what D-17 describes, split out so it is tracked on its own.

**What it is:**
- **Typing indicator:** "Priya is typing…" in the thread header and on the inbox row while someone has a
  non-empty draft in the composer. The composer would send a throttled signal (about once every 3 s while keys
  are being pressed) and the indicator expires about 6 s after the last one.
- **Collision warning:** when you press send and someone else typed or replied in the last few seconds, ask
  "Priya just replied. Send anyway?" instead of sending straight away.

**Why it was not in the first slice:** Kushal chose viewing-only first (2026-10-11) to see whether presence is
useful before adding keystroke traffic. Typing is chattier than a 12 s heartbeat, so it wants a look at load.

**Shape to decide when it is built:** the same polling channel as presence (probably a `typing_at` column on
`conversation_presence`, no new table) versus live push (SSE), which only pays off if 5 to 15 s of lag feels
wrong. The reply lock stays the hard rule; this stays a soft warning.

**What brings it back:** Kushal's go-ahead. Raised to priority with D-17 and D-53.

---

## D-55 · Licence enforcement ("DRM"): usage is blocked when an org has not paid — pinned, **to be revisited last** (Kushal, 2026-10-13: "will come to it in the end") — **PINNED, research later (Kushal, 2026-10-20)**

**What:** if an org (or a self-hosted install) has not paid, the product should stop being usable, not just show a
billing page. Companion to [D-47](#d-47) (signup, billing gate, beta override): D-47 decides who gets in and
how they pay; this is the enforcement that makes "unpaid" actually mean "blocked", everywhere, including the
API and the gateway.

**Open decisions (ask before building):**
- **Hosted or self-hosted?** For a hosted install the entitlement is a per-org state we control, and it is fully
  enforceable. For a self-hosted install the buyer holds the code and the database, so nothing is unbreakable; the
  honest options are a signed licence key checked at startup and on a timer (offline, expiring), or a periodic
  phone-home. Which of those matches the licence in [D-3](#d-3)?
- **What "blocked" means:** read-only (inbox and exports still open so a customer can leave with their data),
  sends and campaigns stopped, or fully locked? A grace period after a lapsed payment?
- **Where it is enforced:** it must sit on the paths that cost money or risk a number, not just the UI: the API
  write routes, the API-key path (an integration must not bypass it), and the gateway's send chokepoint so an
  already-queued campaign stops too. One check, not one per route.
- **The override:** the beta-tester override from D-47 (an audited per-org flag with a reason) is the one way
  through; nothing else should skip it.

**Why parked:** it touches money, tenancy and the licence, and needs the payment provider (D-47) and the
hosted-versus-self-hosted call before any design is honest.

**What brings it back:** Kushal's go-ahead with D-47, and the hosted/self-hosted answer.

**Plan written 2026-10-20 (priority):** limits for seats and numbers in one place, read-only when payment lapses, the operator override as the "paid" switch; see [`32`](32-onboarding-and-billing.md) section 5 and [`33`](33-payment-providers.md). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20: more research and planning needed.** Research how projects whose **source code is available** enforce payment and licences, and what actually works against copying: study open-source and source-available products that sell licences (for example OpenVPN, Proxmox, Grafana, and others with open core or enterprise keys) and write down how each does it: signed licence files, phone-home checks, feature flags for paid tiers, enterprise-only code, and the licence terms that carry the real weight when the code can be read. Decide what is realistic for a product whose code is visible, then plan.

**Research written 2026-10-20:** see [`34 · Licensing and enforcement`](34-licensing-and-drm.md). Kushal's requirement: only the developers authorise who may use the software, and use is highly restricted outside the organisation. That rules out open-source and the public source-available licences; the fit is a **proprietary, all-rights-reserved licence with a private repository and a signed agreement per customer**, ideally **hosted by us**, plus an offline-checked signed licence token for limits (seats, numbers, expiry) with soft-then-read-only lapse. The "what other products do" table there is from memory and marked verify; more examples (and the actual licence pages of Proxmox, Grafana, OpenVPN, GitLab) still need reading.

**2026-10-20:** back to pinned; the research in [`34`](34-licensing-and-drm.md) stays as the starting point, and more examples wait.

---

## D-56 · Telemetry: metrics, tracing and error tracking beyond logs — pinned (Kushal, 2026-10-13)

**Decision:** logging is enough for now; telemetry is pinned, not scheduled. Kushal's rule (2026-10-13): "if
logging is there that's enough, else add logging."

**What exists today (so nobody re-checks):**
- Structured JSON logs (pino) to stdout, UTC, sensitive fields redacted by allowlist; pretty in development.
  In dev, `npm run dev:all` also writes `.dev-logs/{api,gateway,web}.log` (not rotated); `npm run verify` writes
  `/tmp/crm-verify-<time>/`. In production they go wherever the container runtime captures stdout.
- A request id on every API request, present in the logs and in error bodies.
- `GET /health` and `GET /ready` (database check).
- Product state in Postgres that doubles as telemetry: `audit_log`, `sender_health_event`, per-number health and
  risk score, per-message `hold_reason`, campaign progress.
- A `TELEMETRY_DRIVER=none|prometheus|otlp` setting that reserves the names; nothing reads it.

**What is missing:** metrics, traces, error tracking, alerting (see D-43), dashboards, log shipping and rotation.

**Shape to build when it comes back:** a `/metrics` endpoint with the few numbers that matter (queue depth, sends
and holds by reason, per-number risk score and delivery ratio, re-encryption progress), log rotation plus a
deployment note on where logs go, and error tracking only once a vendor is chosen. Most useful as the
observability for the real-number pilot, which is a week-long watch.

**What brings it back:** the real-number pilot, a hosted deployment (D-33), or the first incident that logs alone
cannot explain.

---

## D-57 · Run the import commit as a background job — pinned (2026-10-15)

**What:** `POST /imports/:id/run` does the whole import inside the HTTP request. Behind a Cloudflare tunnel
the request is cut at 100 seconds (a 524, see [30 · Cloudflare Tunnel](30-cloudflare-tunnel.md)), which at the
measured 2.4 ms per row is about 40,000 rows. The import would likely still finish on the server, but the
person sees an error, retries, and meets "already committed".

**Shape when it arrives:** the run endpoint returns at once with the run id; the gateway (or a sweep) works
through the rows in batches; the UI polls `GET /imports/:id` for progress. Most of the plumbing exists:
`import_run.status` and `counts`, the per-row `import_row` ledger, and its `UNIQUE (import_run_id, row_number)`
that makes a killed run resumable from the last committed batch.

**Why parked:** real files so far are well under the ceiling, and the alpha can state it.

**What brings it back:** the real-number pilot with a large export, or the first 524.

---

## D-58 · Public site and launch-readiness checklist — pinned (Kushal, 2026-10-15)

**What:** a list of things a public-facing site or page normally needs, pinned so it is not lost. Kushal's list,
verbatim in intent:

| # | Item | # | Item |
|---|---|---|---|
| 1 | Custom 404 page | 11 | Sticky mobile CTA |
| 2 | CTA above the fold | 12 | Loading states |
| 3 | Meta title per page | 13 | Form error states |
| 4 | Meta description per page | 14 | Thank-you page |
| 5 | Open Graph image | 15 | Privacy policy page |
| 6 | Favicon set | 16 | Terms page |
| 7 | `robots.txt` | 17 | Cookie banner |
| 8 | `sitemap.xml` | 18 | Analytics installed |
| 9 | Alt text on every image | 19 | Real contact address |
| 10 | Mobile breakpoints | | |

**Read this against what the product is.** The CRM is a signed-in application, so most of this list (a CTA,
Open Graph, a sitemap, a thank-you page, a cookie banner, analytics) belongs to a **public marketing or
sign-up page** that does not exist yet (signup is D-47). Items that apply to the app itself today: 1 (the app
has no custom 404), 3 (page titles), 6 (favicon), 9, 10 (mobile breakpoints), 12 (loading states), 13 (form
error states) and 7 (`robots.txt`, to keep a private tool out of search engines). Items 15 and 16 interact
with D-16, which was struck out as not this repository's to ship; they come back only with a hosted offering.

**Why parked:** pinned, not scheduled. Nothing here blocks the alpha.

**What brings it back:** a public landing or signup page (D-47), or the hosted offering (D-33).

## D-59 · File support in chat (Kushal, 2026-10-16) — 🔺 **PRIORITY AGAIN (Kushal, 2026-10-21): files in campaigns first** (was pinned, research later, 2026-10-20)

> **2026-10-21 (Kushal): "bring file support to campaigns back to priority."** First slice: a campaign can carry one image or GIF (the message
> text becomes its caption), chosen on the new-campaign form and sent to every recipient through the same pacing as text; the AI assistant's
> `create_campaign` tool should be able to attach a file that already exists. This needs the campaign to point at a stored file (a `media_asset`),
> the dispatcher to send media with a caption, and a preview on the campaign page. The rest of this entry (multiple files, drag-and-drop, paste,
> bigger uploads, voice notes, a Files tab, manual Retry) stays pinned behind it.

**What:** sending and receiving files in a conversation, taken as one feature: what works today, what is
rough, and what is missing. Raised as a priority on 2026-10-16.

**What exists:**

- **Receiving:** the gateway downloads inbound files through the socket, types them from magic bytes, stores
  them under an unguessable key, dedupes per org by sha256, and the thread shows a download link
  (filename, type, size). Served only through the authenticated route, always as a download, never inline.
  Access is audited (`media.downloaded`). Proven end to end against a real WhatsApp file (D-11, D-14).
- **Sending (D-25):** the composer's attach button posts one file (raw body, 16 MB cap); images, video, audio,
  PDF and ZIP/Office files are accepted, HTML and SVG are refused; it passes the same anti-ban pacing as text.
- **Found 2026-10-15:** through the web UI, any file over **1 MB** failed (`Body exceeded 1 MB limit`),
  because uploads go through a Next.js server action. Fixed in #39 (`bodySizeLimit: 25mb`), so before that
  the 16 MB cap only held for API callers.

**What is missing or rough:**

| Item | Today |
|---|---|
| Composer | One file at a time. No multiple files, no drag-and-drop, no paste of an image (the input has no `multiple`, and nothing handles drop or paste) |
| Large documents | Capped at 16 MB; WhatsApp allows about 100 MB |
| Voice notes | Not sendable (`ptt`) |
| Inline preview | Deliberately none: images are download-only, which is a security choice (D-11), so a preview means a separate, safe thumbnail path |
| A file that fails to store | Round 1 (PR #60): retried three times and the thread says why it failed. Still missing: a manual **Retry** button. It needs the original WhatsApp message kept (so the file can be fetched again) and a way for the API to ask the gateway to do it (they are separate processes) |
| Files in campaigns | Not supported; text only. **Pinned 2026-10-17 (Kushal): add images and GIFs to campaigns** (one picture or GIF sent with the campaign message, caption = the message). Not this round; needs the campaign model to carry a media file, and WhatsApp sends a GIF as a looping video, so the type handling from round 1 comes first |
| Files in templates | Waits on D-19 |
| At rest | Not encrypted, no retention job, no virus scan (**D-11**) |

**Open decisions (ask before building):** which of the rows above are the actual pain (multi-file and
drag-and-drop? bigger documents? seeing images in the thread?); whether inline preview is wanted at the cost
of a thumbnail pipeline; whether files should be encrypted at rest before more are stored (it is expensive
to retrofit, D-11).

**Why a priority:** a CRM whose contacts send CVs needs the file path to be dependable; the 1 MB defect shows
it had not been exercised through the UI.

**Decided 2026-10-16 (Kushal): chat files get a *virtual* folder, not a physical one.**

Where a file sits is not what ties it to a chat. A file belongs to a chat only through the database:
`message.media_id` to `media_asset`, then `message` to `conversation` to `contact` (that chain is also what
authorisation walks on every download). A physical `chats/<conversationId>/` directory was rejected because:

1. **It breaks dedup.** Files are deduplicated per org by sha256, so a CV forwarded into five chats is stored
   once today; a folder per chat would store it five times.
2. **A chat is not stable.** Contact merges and `@lid` linking (`packages/core/src/identity-linking.ts`) move
   messages between conversations, which would mean moving files and rewriting every `storage_key`.
3. **Nothing needs it.** The key never has to say which chat a file is in.

So the keys stay opaque (`org/<orgId>/media/<uuid>.<ext>`, built only by `mediaKey()`), and the per-chat "folder"
is a **Files tab on each chat**, plus one **Files list** for the org with filters (type, date, contact, direction),
both queried from `media_asset` joined through `message`. Downloads keep going through `GET /api/v1/media/:id`
(authenticated, attachment-only, audited). Not built yet. Content-addressed keys (`org/<orgId>/blobs/<sha256>`)
are a possible later layout once files live in a bucket.

**Cleanup design (not built; today nothing deletes a file and nothing calls `storage.list`):**
- *Orphans:* a `media_asset` that no message points at, after a grace period, is deleted with its object. With
  dedup, a file shared by two chats survives until the last reference goes.
- *Delete one chat:* remove that chat's messages' references, then collect orphans.
- *Erase one org:* `storage.list("org/<orgId>/")` and delete (the only intended caller of `list`).

**Still open:** encrypt files at rest before or after the bucket move (D-11, D-63); retention window (docs/09 says
a year); an inbound size cap and a per-org quota (inbound is uncapped, D-30); virus scanning (ClamAV, about 1 GB
RAM); which of the gaps in the table above to build first.

**What brings it back:** now, as a priority; the choices above come first.

**2026-10-20: more research and planning needed before round 3.** Rounds 1 and 2 are merged (file types, failed-download reasons, image previews). Round 3 is multi-file, drag-and-drop, paste, bigger uploads, voice notes, the Files tab, manual Retry, and images and GIFs in campaigns. Plan it properly before building.

**2026-10-20:** where files can be stored (Microsoft 365, Google, bring-your-own bucket, managed by us for a monthly fee) is written up under D-63.

**2026-10-20:** back to pinned; round 3 and the research wait.

---

## D-60 · Number fallback: message the first number that has a WhatsApp account — ✅ **BUILT 2026-10-16**

> **Built.** A contact can hold several phone numbers (the importer now reads cells like `98…, +91…`, D-21). The
> first is the primary and is the one messaged. Before the first send to a contact **with more than one number**,
> the gateway asks WhatsApp whether the primary has an account, and uses the next number that does.

**How it works** (`apps/gateway/src/number-fallback.ts`, called from `handleSend` after the pacing gates and the
pre-send pause):

- **The lookup** is Baileys' `onWhatsApp` (a contact-sync query on the sending number's session), exposed on the
  channel port as the optional `isRegistered(sender, phoneE164)`: `true`, `false`, or `null` when it could not be
  asked. Baileys returns only numbers that exist, so "absent" means no account and "no result" means unknown.
- **Order:** primary first, then the others in the order they were added. A known, fresh answer is used without
  asking. **One lookup per number**, stored on `contact_identity` (`wa_registered`, `wa_checked_at`, migration
  0029), trusted 30 days if it has an account and 7 days if not.
- **The first number with an account wins.** If it is not the primary it is **promoted to primary**, so every later
  message goes straight to it; the switch is written to the audit log (`contact.number_switched`, actor `system`).
- **If none has an account** the message is **not sent** and fails with `no_whatsapp_number`, instead of going to a
  number that cannot receive it and costing the sender its delivery ratio.
- **It never acts on "could not tell".** A closed socket or a failed query leaves the primary in use; nothing is
  switched or stored on a guess.
- **A contact with one number triggers no lookup at all**, because there is nothing to fall back to. That keeps
  lookups to the minority of contacts that need them (36% of rows in the real Naukri sample).
- **Switch:** `SEND_VERIFY_FALLBACK_NUMBERS` (default `true`); `false` always messages the primary.

**Why it is shaped this way:** a stream of existence lookups from one session is the pattern community reports link
to restricted numbers (anecdote; not measured here), so it is one number per send, cached, only when a fallback
exists, and inside the paced send path rather than a sweep at import time.

**Not built, and not tested on a real number:** a permanent *send* error as a second trigger for the switch; showing
"sent to the second number" in the thread; refreshing a stored answer on a schedule; ordering numbers at import
(the order written is kept). Tested with the fake channel only (`tests/integration/gateway-work.test.ts`, "number
fallback"): the `onWhatsApp` path has **not** been run against the real linked number.

---

## D-61 · Lighter web tier: plain React with refresh buttons instead of Next everywhere — pinned (Kushal, 2026-10-16)

**What:** replace the server-rendered Next.js app with a plain React single-page app on most screens, and keep
live updating only where it earns its cost. Pages that do not need to move on their own (contacts, import,
broadcast, saved audiences, security) get a small **refresh button** instead of polling or server rendering; the
inbox and the number-linking screen stay live. Motivation is resources: the Next server is its own always-on
process.

**What it costs today** (measured, `docs/19-capacity.md`, 2026-10-11): the web process is about **170 MB** of RAM
and is **not optional**, next to the API (about 265 MB) and the gateway (about 340 MB with one number). Every page is
also a server-rendered round trip, and the inbox refreshes by re-running every server component of the route on a
timer. That is the same thing D-46 reported as laggy, and 2026-10-15 measurement found the contacts page growing
with people x tags (fixed in #40).

**Shape when it arrives:**
- A static React bundle served by the API (or any file server), no Next process. The API already accepts the
  browser's cookie session with CSRF (the web app forwards the same cookies on the person's behalf today), so the
  SPA can call the API directly and the server-side forwarding layer, the server actions and the 25 MB
  server-action limit (added in #39) all go away.
- Live pieces (inbox, link screen) poll a small JSON endpoint instead of re-rendering a route; a refresh button
  elsewhere. SSE or websockets only if polling proves too coarse (see D-17/D-54, which settled on polling).
- It overlaps D-50 (test the front and back end independently): a static SPA against the HTTP API is exactly that
  boundary.

**Open decisions (ask before building):** which pages are "few" that stay live; whether the SPA keeps Next as a
build tool only, or moves to Vite; what to do about the work already in the server actions (the import flow, the
problem box, the contacts page); and whether the saved 170 MB matters yet (it does at the 2 GB box, less at 4 GB).

**Why parked:** large (it touches every screen and the auth hand-off), and it needs the "measure first" step D-46
asked for: a production build is already about 0.8 s on the heaviest page.

**What brings it back:** a smaller box than 4 GB, the D-46 lag on a production build, or D-50.

---

## D-62 · Ship as a single executable, if possible — pinned (Kushal, 2026-10-16)

**What:** one file that runs the app, instead of a Docker image plus a process supervisor. Today the alpha is one
container running three processes (`infra/docker/entrypoint.sh`): API, gateway and the Next web server, with
Postgres separate.

**What "single executable" can realistically mean here:** one **application** binary plus an external Postgres.
Postgres cannot be folded in (the system leans on row-level security, `LISTEN/NOTIFY` and a role switch, D-20).

**What is in the way, and the options** (research 2026-10-16 from the Node, Deno and Bun docs and comparison
pages; none of this was tried on this codebase):

| Option | Status | Fit |
|---|---|---|
| **Node single executable applications (SEA)** | Built into Node, but runs **one embedded CommonJS script**; native addons and files read from disk need workarounds | This code is ESM TypeScript with the native `@node-rs/argon2`; needs a bundling step to one CJS file |
| **`@yao-pkg/pkg`** | A packager that uses the same Node ABI, described as the most compatible with npm and native addons | The lowest-risk way to try |
| **Deno `compile`** | Embeds assets with `--include`; native Node addons need `--self-extracting` | Different runtime (V8 still); Baileys compatibility untested |
| **Bun `bun build --compile`** | Fastest, smallest binaries, but JavaScriptCore rather than V8, and trouble reported with packages that load `.node` files | Riskiest for Baileys and argon2 |
| **Next.js `output: 'standalone'`** | Smaller deployment, but still needs a Node runtime; not an executable | Helps size only |

**The blockers that matter:** the Next web server does not fit in an executable, so **D-61 comes first** (a static
SPA is just files the API serves); the API and gateway can already run in one process (`PROCESS_ROLE=all`), but
they were split on purpose so an API restart does not drop WhatsApp sockets (`docs/04-architecture.md`), which a
single binary must either keep as two entry points or accept losing; and the native argon2 and Baileys' crypto
are exactly what packagers trip on.

**Why parked:** depends on D-61, and the Docker image already gives a one-command install, which is what the alpha
needs.

**What brings it back:** D-61 landing, or a target that cannot run Docker.

## D-63 · Centralised file store: S3-compatible storage alongside local — ✅ driver built 2026-10-16, default stays local (Kushal, 2026-10-16)

**What:** one shared place for files that the API, the gateway and any future second host can all reach, and that
survives the machine being replaced. Local disk is fine while everything runs in one container; it stops working
the moment two processes run on different hosts.

**Built:** an S3-compatible `StorageDriver` (`packages/providers/storage/s3`, package `@crm/storage-s3`, using
`@aws-sdk/client-s3`) behind the existing port, so nothing above it changed.

- **Choose it with `STORAGE_DRIVER=s3` (or `minio`).** `filesystem` is still the default and what the alpha uses.
- **Settings:** `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (all required once chosen), `S3_ENDPOINT`
  (unset for AWS; set for Cloudflare R2, Backblaze B2 or MinIO; required for `minio`), `S3_REGION` (default
  `auto`), `S3_FORCE_PATH_STYLE` (default on for `minio`, off for `s3`). A missing one stops the app **at boot**
  with the name of what is missing; it never falls back to local disk. Blank values (as the compose file passes
  them) count as unset.
- **Behaves like the filesystem driver:** the content type is stored as object metadata (no sidecar); `delete`
  answers truthfully (it checks existence first, since S3 deletes silently); `list` treats a prefix as a
  directory (`org/a` never matches `org/ab/...`); every method validates the key through the same
  `assertValidKey`. **Difference:** `list` reports `application/octet-stream` for every object, because a bucket
  listing carries no content type; `stat` gives the true one.
- **Still no signed URLs, on purpose** (D-11): every download is resolved through the database and streamed by the
  API, so the bucket can stay private.

**Tested:** the shared contract suite (`tests/contract/storage-driver.ts`, 25 tests) passes against the S3 driver
using **moto, an S3 emulator**, in CI as a service container and locally through `S3_TEST_ENDPOINT`. MinIO's own
images could no longer be pulled from Docker Hub or Quay when this was written (both refused), so it was not used.
**Not tested:** against a real Cloudflare R2, Backblaze B2 or AWS bucket, and not with the API and gateway running
on `STORAGE_DRIVER=s3` end to end (they see only the port, which the contract covers).

**Not built (follow-ups, in this order):**
1. **Decide encryption at rest** (D-11) before any real deployment points at a bucket.
2. **A copy job** from the local directory to the bucket. **Switching an existing install to S3 does not move its
   files:** they stay on disk and stop being found, because rows keep `storage_driver` and `storage_key` as they
   were. Do not switch a database that has files without copying first.
3. The **Files tab and Files list** (D-59), then the **cleanup job** (D-59), then **retention** (D-11).

**Open decisions (ask before building):** R2, B2, AWS or a self-hosted MinIO; one bucket for all orgs (the keys
are already org-prefixed) or one per org; whether to also keep a local copy during the move.

**Why a priority:** raised together with file support in chat (D-59); the alpha's local disk will not survive a
move to a split deployment (D-33).

**Other places to keep files (2026-10-20, Kushal asked: what if a customer has Microsoft 365 Premium with 5 TB, or Google premium storage, or should we charge monthly for managed storage?).** Everything goes behind the existing storage driver (`packages/providers/storage`, built for local disk and S3-compatible); a new place is a new driver, not a rewrite.

| Option | What it is | Good | Watch out for |
|---|---|---|---|
| **Local disk** (today's default) | Files on the server | Simple, free | One machine; backups are yours |
| **Any S3-compatible bucket** (built) | AWS S3, Cloudflare R2, Backblaze B2, Wasabi, Hetzner, MinIO | Cheap, standard; R2 has no egress fee; customer can bring their own bucket | A consumer with only Microsoft 365 or Google storage usually has no bucket |
| **Customer's OneDrive / SharePoint (Microsoft 365)** | Microsoft Graph API; an app-folder permission (`Files.ReadWrite.AppFolder`) keeps the app inside `Apps/<app name>`; or a SharePoint document library for a company | Uses storage they already pay for (a 5 TB plan) | OAuth tokens that expire and must be protected; throttling; chunked upload for big files; the folder stays **visible** to the user; a personal account ties files to one person (if they leave, files go), so prefer a company SharePoint site; Microsoft's docs disagree on which account types the app-folder scope covers, so verify |
| **Customer's Google Drive / Workspace** | Drive API with a narrow scope (`drive.file`) or the hidden app-data folder | Same: their storage | Same OAuth and quota issues; Google's app-data folder is hidden from the user (a plus and a minus); quotas not verified here |
| **Dropbox / Box** | Their APIs | Some customers live there | More drivers to maintain |
| **WebDAV / SFTP** | Nextcloud, many NAS boxes, some SharePoint setups | One driver reaches many self-hosted options | Speed and reliability vary |
| **Managed by us** | We keep their files in our bucket and **bill monthly** by storage used (for example per 50 GB) | Nothing for the customer to set up; we control backups and encryption | We carry the cost and the risk: egress fees, a per-org quota, retention, backups, and **encryption at rest first** (D-11); price it with a margin |
| **Hybrid** | Recent files with us, older ones moved to the customer's storage | Controls our cost | More moving parts |

For any customer-owned cloud the design is the same: files are **served through us** (no raw links, so the access check and the audit log still apply), the tokens are encrypted, a failed upload is visible (D-30) and retried, and a per-org setting chooses the driver. **Questions for Kushal:** which customers actually ask for this; managed storage as a paid add-on or included; and whether the first extra driver is "bring your own S3-compatible bucket" (cheapest to build) or Microsoft 365 (most requested by small offices). Sources: [Microsoft Graph app folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder). The Google Drive details were not found in this research and must be read from Google's documentation. (Raised under the label D-23; it is about files, so it lives here and in D-59.)

**2026-10-20:** back to **pinned** (Kushal). The S3-compatible driver stays built and the default stays local; the storage-options write-up above is the starting point when this returns.

---

## D-64 · Database portability: move the database-side logic into the app so other databases can work — pinned (Kushal, 2026-10-16)

**The question asked:** was the code written only for Postgres, and should every function, trigger and bit of
database-side logic move into the JavaScript so it could run on, say, SQLite (which has no such features)?

**Answer: it is written for Postgres, deliberately and deeply.** Measured on `main`, 2026-10-16:

| What leans on Postgres | How much |
|---|---|
| **Row-level security** (the tenant isolation: 24 policies, `ENABLE`/`FORCE` on every tenant table) and the role switch that makes it apply (`SET LOCAL ROLE crm_app` plus `set_config('app.org_id', …)` in `apps/api/src/tenant.ts`, `apps/gateway/src/tenant.ts`, `packages/db/src/security-check.ts`) | The foundation of multi-tenancy. A forgotten `WHERE org_id` is a denied read, not a leak. SQLite has nothing equivalent |
| **`LISTEN`/`NOTIFY`**: the gateway's command channel (`apps/gateway/src/main.ts`, `work.ts`), woken by the trigger function `notify_gateway()` and three triggers (`channel_session_link_requested`, `channel_session_unlink_requested`, `message_queued`) | How the API tells the gateway to send, link or unlink without polling. SQLite has no notifications; it would be polling |
| **Database functions**: `notify_gateway()` and `envelope_key_version()` (an indexed expression) | 2, in 3 of the 29 migrations |
| **`FOR UPDATE … SKIP LOCKED`** in campaign dispatch (`packages/core/src/campaigns.ts`) and `FOR UPDATE` in the campaigns route | Safe concurrent claiming of campaign recipients |
| **Postgres types and operators** in the schema and the queries: `jsonb` and `->>`, arrays, `bytea`, `uuid`, `timestamptz` casts, `gen_random_uuid()`, `now()`, `interval`, `ON CONFLICT`, `RETURNING`, `LATERAL`, partial indexes, `FILTER (WHERE …)`, `unnest`/`ANY` | 41 files of application code use raw SQL (the `sql` template tag) at about 254 `execute()` call sites; the schema is Drizzle's **`pg-core`** (`packages/db/src/schema.ts`); the driver is `postgres` (`packages/db/src/client.ts`) |
| **Privileges and roles**: a restricted `crm_app` role, `REVOKE UPDATE, DELETE` on the audit log | Part of the security model, not a convenience |

So moving "the functions and triggers into JS" is **not a small refactor**. The two functions and three triggers are
the easy part (the notify trigger becomes an in-process call or a polling loop). The hard parts are **tenant
isolation**, which is enforced by the database today and would have to be enforced by hand on every query
(exactly the failure mode M-series defects came from), and **every raw query**, which would need a portable form.
It would also lose guarantees that are tested today: the "no `org_id` filter at all" isolation tests and the
append-only audit log.

**Shape if it is ever done (a decision, not a plan):**
1. A `DbDriver` seam like the other ports (`docs/18-providers.md`): Postgres adapter keeps RLS and `NOTIFY`; a second
   adapter does application-level tenant scoping and polling.
2. Replace raw SQL with a portable query layer (Drizzle's query builder, which D-1b already parks) one module at a
   time, with the integration suite run against both.
3. Treat tenant isolation as an application-enforced property with its own cross-tenant test sweep (D-48).
It matches **D-20** (SQLite for single-machine installs): a single-tenant, one-machine SQLite mode is far smaller
than a portable multi-tenant core, because with one tenant there is no isolation to re-implement.

**Why parked:** the product is multi-tenant on Postgres by decision (2026-09-27), the alpha runs on a Postgres
container, and nothing asks for another database. It is a re-architecture, not a flag.

**What brings it back:** a concrete need to ship a single-machine install without Postgres (D-20), or a managed
database that cannot run these features.

**Cost of deferring:** it grows with every new raw query and trigger. New database-side logic should stay behind the
helpers that already wrap it (`setTenant`, the gateway command channel) rather than spread.

---

## D-65 · Bugs found running the alpha container on a VM (2026-10-17), not fixed — **PARKED (Kushal, 2026-10-20): not working on this for now**

Found by using the app for real (sign in, link a number, import, Team, Numbers) on a throwaway VM. Fixed and merged
the same day: the missing phone after linking, the terminal-only Numbers/Security/sign-in text, Import-before-Preview,
multi-email cells (#46, #47). **Still open:**

1. **False "possible ban" alarm.** Pressing **Try again** after an unscanned QR makes the gateway log the number out,
   WhatsApp answers 401 (nothing was ever linked), and the app shows two red notices ("WhatsApp logged this number
   out: check the phone first", "refused the saved login"), logs "number logged out by WhatsApp - possible ban" and
   left the number at "Degraded", risk 60. Nothing was banned. Likely fix: do not log out a number that has no stored
   credentials; do not raise the ban alarm for a 401 on a link attempt that never connected.
2. **Dead-end card** after that: no Link/Try again button until the page is reloaded.
3. **QR lasts about 55 s and sits below the fold** on a tall card; easy to miss.
4. **Browser tab title is "Inbox" on every page** (root layout metadata).
5. **Import counts:** the preview counted a row that the commit then merged as a duplicate of an earlier row; the
   summary does not mention the merge ("27 would be created", "26 created", 29 read, 2 errors).
6. **A bad email fails the whole row** even when the phone is good. Option: import the contact and warn about the email.
7. **Contacts shows inbound-only contacts by raw `...@lid` ids** with "no contact details".
8. **Security wizard step 2** (put the new key in the server's settings and restart) is manual by design; the web never
   sees the current key. A button that applies it would need a deliberate security decision first.
9. **Login over plain `http://` cannot keep a session** (Secure cookie); there is no test-install setting for it.
10. **Alpha container connects to Postgres as a superuser**, so row-level security is not enforced (log warning); fine
    single-tenant, not for several orgs.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-9 ([#71](https://github.com/Kushalr3ddy/whatsapp-crm/issues/71)): after scanning the QR the Linked numbers card still says "Not connected" until the page is reloaded. **Decisions:** auto-refresh when the link succeeds; once linked, grey out "Link this number", "Scan a QR" and "Type a code"; "linked" and "connected" mean the same, so use only "Linked".

✅ **Issue-9 built 2026-10-20 (PR #73):** the Linked numbers card refreshes itself the moment a scan succeeds; "Link this number", "Scan a QR" and "Type a code" are greyed out once linked; the word is "Linked" everywhere (Linked / Not linked / Linking…). The other bugs listed in this pin are still open.

**2026-10-20:** parked. These will be retested on a **new VM later, with Claude having full access over SSH**, so the fixes are done against a real deployment. Still open: the false "possible ban" alarm, the QR below the fold, tab titles, import count wording, a bad email failing a whole row, raw `@lid` ids in Contacts, the stale "Degraded" score. Only the stale "Not connected" card is fixed.

---

## D-66 · Motion on most pages, not just the sign-in screen — pinned (Kushal, 2026-10-17)

The sign-in screen has an animated background and Kushal likes it. He wants the same life across **most pages**: quick,
subtle motion inside the app (pages ease in, buttons press, cards lift on hover, stat numbers count up, skeleton
loaders while data loads, small toasts, a typing indicator and presence dots in the inbox), with the showy kind kept to
sign-in. Decided with it (2026-10-17): **one sans-serif font throughout**, a small set of consistent hand-drawn SVG icons
(no icon library, no UI library), light and dark on every page, and everything honouring `prefers-reduced-motion`.
Direction (clean light, brand sidebar, soft and friendly, or a mix) is chosen from the mockups in `mockups/` (git-ignored)
before any page is restyled. Direction A and Inter were chosen; the sign-in screen, Overview and shared styles carry the motion in PR #53. Most other pages still to do.

**Added 2026-10-19 (Kushal): loading animations for the few tasks that take a long time** (an import commit, a campaign
starting, a number linking, a big search). A visible animation with a plain-words label ("Importing 160 contacts…"), not just
a disabled button, so nobody thinks it froze. D-57 (import as a background job) is the same wish for imports.

**Added 2026-10-20 (Kushal):**
- **Look at how other SaaS products animate** (sign-in, onboarding, dashboards, loading, empty states) before choosing more motion; collect examples.
- **Sign-in transition:** when Sign in is clicked, the button **expands to cover the whole screen** and the app opens on the dashboard (a "burst" reveal).
- **Sign-in screen animation:** after the cash flows back to the organisation, a **revenue box pops up** (extends the lead scene in `apps/web/app/login/lead-scene.tsx`; no currency symbol, as before).
- **Theme changer at the top right** of the page, not the bottom left of the sidebar, with a **sun / moon icon** next to the Light / Dark text.
- **The "N" badge in the bottom corner** (the Next.js development indicator, shown only while running `next dev`): hide it, or confirm it does not appear in a production build (`devIndicators` in `apps/web/next.config.ts`).

---

## D-67 · Save a number or name onto a `@lid` chat, like "add contact" in WhatsApp — **PRIORITY (Kushal, 2026-10-20): the @lid mapping**

Some chats arrive from WhatsApp with a hidden `…@lid` id instead of a phone number, so they show as a raw id in the
inbox and Contacts (see D-65). Kushal wants, at the top of such a chat, an **Add number / contact** action that works like
saving a new contact in WhatsApp: type the phone number and a name, and the chat is joined to that person (merged with an
existing contact if the number is already known). He also suspects the automatic lid-to-number mapping is not working;
check that first (does the gateway ever learn the number for a lid, and is it stored?). Pinned to come back to; not started.

**2026-10-20: more research and planning needed.** First find out why the automatic `@lid` mapping is not working. Research questions to answer before any build:
- **Which chats should never become contacts?** `@newsletter` addresses (channels), communities, groups and WhatsApp broadcast lists. Groups and `status@broadcast` are already skipped on the way in; check newsletters and communities too, and decide whether broadcasts should be ignored everywhere.
- **Unknown numbers.** What happens when a stranger who is not a contact messages in: spam, promotions, random people? Does it create a contact and a conversation? Options to weigh: a separate "unknown senders" inbox (see D-10), a block or mute action, rate-limiting or auto-archiving, and keeping spam out of campaign audiences.
- **The `@lid` mapping itself:** does the gateway ever learn the real number, and is it stored?

**Decisions (2026-10-20, Kushal):**
- **Ignore `@newsletter` chats and similar** (channels, communities, WhatsApp broadcast lists). Today only groups (`@g.us`) and `status@broadcast` are skipped on the way in (`packages/channels/baileys/src/index.ts` ~503); nothing skips newsletters or other broadcast addresses, so they would create contacts and conversations.
- **Alert the user on a message from an unknown number** (someone who is not a saved contact): a clear notice on the thread or in the inbox saying "message from an unknown number", with the pushed name if there is one, so spam and promotions are recognised and not mistaken for a customer. Related: D-10 (unknown senders).
- **Find out why the automatic `@lid` mapping is not working.**

**Findings from reading the code and the Baileys build (2026-10-20; not run, so unconfirmed in practice):**
1. The mapping has only two sources today. (a) `key.senderPn` / `participantPn`, which Baileys copies from the stanza's `sender_pn` / `participant_pn` attribute, **present only when WhatsApp includes it, which it often does not for privacy addresses**. (b) The `chats.phoneNumberShare` event (`index.ts` ~378), which fires only when the other person shares their number.
2. **Not used at all:** Baileys' `contacts.upsert` and `contacts.update` events. A `Contact` there carries **both `lid` and `jid`**, which is exactly a lid-to-number pair, plus `notify` (the name the person set for themselves) and `name` (the name saved on the linked phone). Nothing in the repo listens to them, so every pair WhatsApp already sends is thrown away. The history sync is another source.
3. **Baileys can give the person's own chosen name.** Every inbound message carries `pushName` (the display name the sender set for themselves; the same as `notify`), which the gateway does not store. A profile picture (`profilePictureUrl`), an about text (`fetchStatus`) and a business name (`verifiedName`, `getBusinessProfile`) can also be fetched. The phone number cannot be read from a name; only from the pairs in (1) and (2).
4. So the likely reasons the mapping seems broken: WhatsApp does not send `sender_pn` for these chats, we ignore the contact events that do carry the pair, and the display name is never saved, so a lid chat shows as a raw id.

**Next steps (research, then plan):** confirm on a real linked number which events arrive for a lid chat (log, do not store); decide to store `pushName` on the contact; add listeners for contacts events; write the ignore list; design the unknown-sender notice; then the "add a number to this chat" action.

**2026-10-20:** the only research item that is priority is **why the `@lid` mapping is not working** (findings above). The rest of this pin (ignoring newsletters, the unknown-number alert, the add-a-number action) follows from it.

**Results of the live investigation (2026-10-20, one real linked number, shapes only; supersedes findings 1-4 above where they differ).** A diagnostics switch logged what arrived, never a number, name or text:
- **The `@lid` mapping works when WhatsApp sends the number.** 13 of 13 real incoming messages from `@lid` addresses carried the sender's phone number (`senderPn`) and the sender's own chosen name (`pushName`). The database confirms it: that person is one contact holding **both a phone identity and the `@lid` identity**, with all 15 of their messages in one conversation. No failure reproduced in this sample.
- **The contacts events do not help**, contrary to the earlier guess: 14 `contacts.update` events arrived, all with a name the person chose (`notify`), **none with a `@lid`/number pair**. No `phoneNumberShare` event arrived at all. So the only working source today is `senderPn`; if WhatsApp omits it for some chat (privacy settings, first contact), the mapping has nothing to use. That is the remaining gap, and it was not seen this time.
- **Newsletters leak in.** Two incoming messages came from a `@newsletter` address (a channel the number follows), and the database now holds a **contact and a conversation named with the raw newsletter address** (29 characters, no phone). This is the confirmed bug behind "ignore `@newsletter` chats". Groups and the status list were already skipped (one group message arrived and created nothing).
- **Noise to ignore:** 361 of the 377 logged messages were `fromMe` echoes or empty stubs (our own sends and history sync) with no content; they are already skipped.
- **`pushName` is present on every real incoming message and is not stored.** Saving it would give each contact the name they chose for themselves instead of just their number.
- **Fix list now:** (1) skip `@newsletter`, other broadcast lists and communities in `#emitInbound` (`packages/channels/baileys/src/index.ts`), with a test in `mapping.test.ts`; (2) store `pushName` as the contact's name when the contact has none; (3) the unknown-number alert on first contact; (4) the add-a-number action for a `@lid` chat that arrives **without** `senderPn`. The diagnostics commit stays on the local branch `diag/lid-events`, unpushed.

**Decisions after the findings (2026-10-20, Kushal):**
- **Saving the sender's own chosen name (`pushName`) is optional**, a setting and not automatic. Off means the contact is named by number as today.
- **Why a `@lid` chat can show a raw id while WhatsApp Web and the phone show the number.** The phone and WhatsApp Web know the person from your address book and from WhatsApp's own servers. A linked device through Baileys is handed only the privacy address (`@lid`) for some chats, plus the real number **only when WhatsApp chooses to include it** (it did for 13 of 13 messages in the test). When it does not, our code has nothing to map. This is partly a **Baileys 6.7.24 limitation**: newer Baileys (7.x) keeps its own lid-to-number table and can look a number up, which is part of why D-44 (Baileys 7 upgrade) matters here. So "add a number to a `@lid` chat that arrives without one" is a real gap, and the better answer may be the upgrade, with the manual add-a-number action as the fallback. Revisit after D-44 is looked at.
- Still to do from the fix list: skip newsletters, broadcast lists and communities; the unknown-number alert.

✅ **Built 2026-10-20: channels, broadcast lists and communities are ignored** (`isNotAPerson` in `packages/channels/baileys/src/index.ts`: `@g.us`, `@newsletter`, any `@broadcast`). A message from one no longer creates a contact or a conversation. A newsletter contact created earlier on a dev database is not removed by this and can be deleted by hand.

---

## D-68 · Campaign with no tagged people: tell the user to tag them first — ✅ built in PR #56 (Kushal, 2026-10-17)

When someone starts a new campaign and no contact has the tag they would pick (or no tags exist at all), the page should
say so and point them to Contacts to tag people, instead of leaving them with an empty list. Today the "A tag" tab is
simply hidden when no tags exist (`apps/web/app/broadcast/new/audience-picker.tsx`). Also noted the same day: an imported
Naukri file only brings in name, phone and email, so its other columns (location, skills, experience…) do not show on
Contacts; that is D-21 (map a column to a custom field), already a priority.

---

## D-69 · Chats available inside the job portal (and any other web app) — pinned (Kushal, 2026-10-17)

The conversations should be usable **from the job portal**, not only inside this CRM's own screens: the CRM should plug
into the portal (and into any other web app) so recruiters can read and answer a candidate's WhatsApp chat right where
they already work, on the candidate's own page. Not designed yet. Things to settle when it comes back: the shape of the
plug-in (an embeddable chat panel for one contact or conversation, the existing API and `packages/sdk` driven by the
portal's own screens, or both); how the portal's user signs in without a second login (a short-lived token the portal
asks for on the user's behalf); how a portal candidate is matched to a CRM contact (by phone or by the portal's own id,
kept in `external_ref`); whether the portal can only read a chat or also send; and that everything stays within the
anti-ban pacing and do-not-contact rules no matter where a message is sent from.

**Added 2026-10-17 (Kushal): the front end should be pluggable into other codebases and applications**, not just the chat.
The CRM's screens (inbox and thread, contact list, import, campaigns) should be droppable into an existing app as
components or an embeddable widget, themeable to the host's look, without taking this whole Next.js app with them.
Questions for later: ship them as a framework-free web component or an npm package of React components; keep them
talking only to the public API (so a host never reaches into the database); how a host overrides colours, fonts and
which actions show; and how this fits D-61 (plain React instead of Next) and D-62 (single executable).

Pinned to come back to; not started.

---

## D-70 · Contacts page: refresh, admin-chosen columns, tidier layout, sort and search by date — **WORK ON NOW (Kushal, 2026-10-20)**

Five wishes about the Contacts page, from testing the import with a real Naukri file (the first wish, a bigger column
selector and preview on Import, was filed under **D-21** instead):

1. **A refresh button** on Contacts, to reload the list without reloading the whole page. Related to D-46 (UI lag) and
   D-61 (plain pages with refresh buttons).
2. **Columns on Contacts, chosen by an admin.** Which fields show as columns in the list (name, phone, tags, and any custom
   field such as location or experience) is set once by an admin for the whole team, rather than fixed in the code.
   Custom fields are built (D-40, PR #56 for imports).
3. **Better formatting.** Today each row crams the name, numbers, tags, fields editor and actions together ("a
   clusterfuck of information"). Needs a calmer layout: a table with the chosen columns, details tucked into a side
   panel or an expandable row, tags as small chips (small rounded labels on the screen, like the tag name on a contact), consistent spacing. Copy the contact lists in the research apps
   (`docs/03-competitive-analysis.md`).
4. **Sort and search by the date a contact was added or imported**, and sort by any chosen column.
5. **Do the sorting and searching in the browser** with SQLite on the end user's side, to keep load off the server. Open
   question: this means shipping the contact list to the browser (size, privacy, staleness, and what an agent with limited
   access is allowed to hold locally), so it needs a decision before a build. Not the same as D-20 (SQLite as the
   server's database). The server-side alternative is a date filter and a sort parameter on `GET /contacts`.

Pinned to come back to; not started.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-3 ([#66](https://github.com/Kushalr3ddy/whatsapp-crm/issues/66)): the "Tag many at once" dropdown stretches out of its box; a UI fix. Issue-4 ([#67](https://github.com/Kushalr3ddy/whatsapp-crm/issues/67)): add a **"No tag"** option at the bottom of the tag list; choosing it warns that without a tag those contacts will have to be found and tagged again later; "choose a tag…" stays visible but greyed out. Issue-5 ([#68](https://github.com/Kushalr3ddy/whatsapp-crm/issues/68)): clicking a tag chip must filter (the tag ID in the address bar does not matter to users); once contacts are tagged or selected, suggest starting a campaign with them; if they are only selected and untagged, tag them first; if a campaign already exists that contains them as a subset, ask whether to use this tagged group or create a new one (see D-68, D-73). Issue-6 ([#69](https://github.com/Kushalr3ddy/whatsapp-crm/issues/69)): removing a tag with the × asks "Are you sure?" and says the contact may have to be searched for and tagged again.

✅ **Alpha-feedback issues 3-6 built 2026-10-20 (this PR, issues #66-#69). A "chip" here means a small rounded label on the screen, such as a tag name on a contact or in the Tag filter row:** the Tag many at once selects fit their box; a "No tag" option explains what it means; a tag chip shows it is loading and is marked current; with a tag filter on, the page suggests starting a campaign and names any campaign already using the tag (`GET /campaigns?tagId=`); removing a tag asks "Are you sure?" first. The rest of D-70 (refresh, admin-chosen columns, layout, date sort and search) is still open.

**2026-10-20: work on this now.** Built: the tag fixes.

✅ **Built 2026-10-21 (PR 1 of D-70, Kushal's decisions):** a **Refresh** button; the list is a line of columns (name, phone/email, tags, added) where each row **opens** to show the rest (adding a tag, do-not-contact, last imported, custom fields); a **Dates and order** box to limit by the day *added* or *last imported* (from / to, both included) and to order by newest, oldest, last imported or name. **Sorting and searching stay on the server** (the browser-side SQLite idea, wish 5, was set aside by Kushal): `GET /contacts` takes `from`, `to`, `dateBy` and `sort`, and returns `lastImportedAt`. The date range is part of the one shared rule (`searchPredicate`), so "tag everyone matching the current filter" tags exactly the people listed. Limits: paging by cursor only follows "newest added first" (other orders show the first 50); days are read in the database's time zone (UTC); ordering by last imported adds up every import row, which is fine at alpha size and wants an index on `import_row(contact_id)` for a big book. **Admin-chosen columns** were moved to D-79.

---

## D-71 · A big background picture for each tab — pinned (Kushal, 2026-10-19)

Each main page gets a **huge, faint illustration (an SVG) behind its content** that shows what the page is about: a contact
book on Contacts, a phone being linked (a phone and a QR code) on Linked numbers, speech bubbles on Inbox, a funnel or
megaphone on Campaigns, a file and arrow on Import, and so on. It sits at low contrast in the corner or centre so text stays
readable, works in light and dark, is drawn in the app's own style (the hand-drawn SVG set and green accent from D-66, no
illustration library), and does not move for anyone who asked for reduced motion. Related: D-66 (life across the pages).
Questions for later: one illustration per page or a shared set, and whether the empty states reuse them.

Pinned to come back to; not started.

---

## D-72 · Mobile-friendly UI — pinned (Kushal, 2026-10-20)

Every page should work well on a phone, not just a laptop: the inbox (list and thread as two screens with a back button, a
composer that sits above the keyboard, tap targets big enough), Contacts, Import, Campaigns and Linked numbers (including
scanning the QR with a second device), the sidebar as a bottom bar or slide-out menu, tables that become cards, and no
sideways scrolling. Some of it exists already (the sidebar has small-screen rules and the sign-in page is responsive), but it
was never tested or designed phone-first. Related: D-66 (look and motion), D-70 (the Contacts layout), D-61 (lighter web
tier). Questions for later: a responsive web app only, or an installable one (a PWA with home-screen icon and push
notifications for new messages); what to test on (real phones, and Playwright's mobile viewport, which D-49 also wants).

**Added 2026-10-21 (Kushal): mobile compatibility comes later.** Do the phone-width work as its own piece after the desktop
work (D-21, D-70) settles; until then new screens only need to not be made worse on a phone. The Import wizard sections (#83)
should get a phone-width look as part of it.

Pinned to come back to; not started.

---

## D-73 · "Message these people" right after an import — pinned (Kushal, 2026-10-20) — **PARKED (Kushal, 2026-10-20): not working on this for now**

After an import finishes, offer a quick way to send one message to everyone who was just imported: a **Message these people**
button on the result box that opens a new campaign with the audience already set to that import (and with a short, quick form
rather than the full campaign page). Most of the machinery exists: a campaign can already target "An import" as its audience
(`fromImportRunId`), the import is tagged with the file name by default, and sending goes through the same pacing and
do-not-contact rules as any campaign, so this is mostly a shortcut and not a new way to send. Things to settle: whether it is a
real campaign underneath (recommended, so it is paced, listed and auditable) with the page simplified, or something lighter; a
confirmation showing how many people it reaches and that some may be skipped (do-not-contact, recently messaged); and that a
big import cannot be blasted by accident. Related: D-68 (tag people first), D-57 (import as a background job), D-52.

Pinned to come back to; not started.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-1 ([#64](https://github.com/Kushalr3ddy/whatsapp-crm/issues/64)): after an import finishes the page just ends ("looks sus"). Show suggestions, never force: after linking a number, suggest Import or Campaigns; after an import, buttons to see the tagged contacts and to send them a message. Kushal: this may mean starting on the import wizard (D-21) too.

✅ **First slice built 2026-10-20 (issue #64):** a finished import shows "View the N imported contacts" and "Message these people" (opens a new campaign on that import). The faster one-step quick message is still open.

**2026-10-20:** parked again. The buttons after an import are built; the quick one-step message is the part that waits. Not working on it for now.

---

## D-74 · Add-number form: country-code dropdown and a numbers-only phone field — ✅ **BUILT 2026-10-20**

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md), issue-8 ([#70](https://github.com/Kushalr3ddy/whatsapp-crm/issues/70)). The optional phone field on Add a number makes people type the country code themselves, and
typing `9964122631` fails with "Write the number with its country code…". **Decisions:** a country-code dropdown next to the
field, defaulted from the person's location (browser locale or time zone is enough, no precise location needed), changeable;
if they start typing `+91`, `+63` and so on, switch the dropdown to that country and let them carry on, as Google's phone
field does; the field accepts digits only and asks phones for the numeric keypad (`inputmode="tel"`). Related: D-72 (mobile).

✅ **Built 2026-10-20 (PR #73):** a country list next to a digits-only phone box, defaulted from the browser language and changeable; typing `+91…` or `+63…` switches the country. Code: `apps/web/lib/dial-codes.ts`.

**Update 2026-10-20 (PR for the second alpha-test round):** Add a number now asks for a **name only**, and its QR opens straight away; the number is saved when the QR is scanned. The country list and digits-only box moved to the **Type a code** linking method, where WhatsApp needs the number up front (`apps/web/app/link/phone-field.tsx`). Sign-in also got a Show/Hide button.

---

## D-75 · Number assignment: who each WhatsApp number belongs to — pinned (Kushal, 2026-10-20): not building it now

Nothing assigns a WhatsApp number to a person today; every teammate sees every linked number. Decided (Kushal, 2026-10-20): **for now nobody is
restricted**. Agents can still see all numbers and **who each is assigned to**; assignment is shown, not enforced. Admins assign numbers to
people from the **Team tab** (a checklist per person) and the **Numbers tab** ("Assigned to: …" on every card, checkboxes for admins); the
**Inbox** shows which number a chat is on and who it belongs to. **Agents can add their own numbers** (not admin-only), and a number someone
adds is assigned to them automatically. **Warnings:** a member with no number assigned, or whose number is unlinked ("link it again or link a
new number"), is flagged to the member (a banner) and to admins (a chip on the Team row). Data: a `sender_member` table. Raised by the other dev's
alpha test and Kushal's own (the Team tab had no way to give a teammate a number). Related: D-53 (conversation owners and participants).

**2026-10-20:** pinned, not building it now. The plan is ready to pick up: a `sender_member` table, a numbers checklist per person on the Team tab, "Assigned to" on every Numbers card, the Inbox number chips and the no-number / unlinked warnings. Agents keep seeing all numbers meanwhile. Related: D-76, D-77.

---

## D-76 · Notifications tab, number requests and approvals — pinned (Kushal, 2026-10-20)

An in-app **Notifications** tab for each user: when a number is assigned, reassigned or removed, when a request for a number is sent, approved or
declined, and (later) when a number becomes unlinked. Admins see who requested a number, or a specific number, with Approve and Decline right
there. Not now: for the moment people ask the admin in person. Design notes so it is not re-derived: a per-user `notification` table (kind,
title, body, link, created, read), a `sender_access_request` table (user, number or "any", note, pending/approved/declined, decided by), events
written in the same transaction as the change, an unread count in the nav computed like the existing number alerts, and polling refresh like
`inbox/auto-refresh.tsx` (there is no push). Related: D-43 (other alert channels), D-75, D-77.

---

## D-77 · Admin controls: user scopes and number limits — pinned (Kushal, 2026-10-20)

Later, the admin decides who can see and do what. **Several user scopes** beyond admin and agent (for example sub-admin, manager, assistant
manager), each with its own powers. **Who sees which numbers:** agents (or a scope) limited to the numbers assigned to them, with a wrong number
answering 404 and not 403; the API paths that would need that check are already mapped (conversation list, one conversation, mark read, patch,
presence and typing, notes, sender status, thread messages, attachments, sending with a conversation or with a "to" number, media and its preview,
the senders list and link status, and campaign create, list, start, get, preview and recipients). **How many numbers each person may link**, or a
**predefined list of numbers the admin types or uploads** that may be linked to the CRM. **Who may add, link or unlink numbers** per scope (today
any signed-in person can). Related: D-75, D-76, D-53, D-47 (limits per organisation).

---

## D-78 · Email: invitations to join an organisation, via SMTP or an email API (decide later) — pinned (Kushal, 2026-10-20)

Email is **optional** and the choice is **not made yet**: either plain **SMTP** (any mail server the operator already has) or an **email API** (a hosted sending service). What it would unlock: an **invite sent from the Team tab** (today an admin creates the account and hands over the password), a self-service password reset, and email verification at signup. Until a choice is made the product works without email, and the admin-created-account flow stays. Today there is no email code at all (`packages/providers/email` is empty, no email settings in `packages/shared/src/config.ts`). To decide: SMTP vs an API provider, who pays for sending, and what an invite looks like (a single-use link). Related: D-8, D-33 (the unbuilt email driver), D-43 (email alerts), D-47, and docs [`32`](32-onboarding-and-billing.md).

---

## D-79 · Contacts: columns chosen by an admin for the whole team — pinned (Kushal, 2026-10-21)

Split out of D-70 (wish 2). An admin picks once which fields show as columns on the Contacts list for everyone (name, phone, tags,
added, and any custom field such as city or experience), instead of the fixed columns D-70 ships with. Needs a per-organisation
setting (list of column keys and their order), an admin-only screen or panel to change it, and the list reading it. Custom fields
already exist (D-40, PR #56); sorting by a chosen column is the follow-on from D-70. Related: D-70, D-72 (columns on a phone).

Pinned to come back to; not started.

---

## D-81 · AI assistant guardrails — pinned (Kushal, 2026-10-21: "it needs to just work for now, we can set up guardrails later")

**What:** today the assistant has only the safety that every send already has (do-not-contact, pacing, the anti-ban gates, the daily
message limit, a consent box, customer text kept out of its instructions). Nothing limits what it says. **Seen on 2026-10-21:** asked how
much experience was needed, it answered "2 to 5 years", which no one had told it; it also listed interview documents nobody had told it.

**To build, when it comes back:**
- *Facts:* answer only from what the organisation wrote (a knowledge field or uploaded notes); otherwise say a colleague will confirm. The
  first draft of this rule was written and removed on 2026-10-21 because it made the assistant hand chats over instead of carrying on.
- *Opt-out words:* "STOP", "unsubscribe" and the local-language packs mark the contact do-not-contact (F9 is where it was planned) before any reply.
- *Approval mode:* a switch where the assistant drafts and a person approves, per organisation or per chat.
- *Limits:* topics it may not discuss, a spend cap in money not only messages, a quiet-hours rule, a reply-length cap.
- *Tests:* a set of nasty prompts (injection, pay, legal, abuse) that must be refused or handed over.

**Cost of deferring:** a real customer can be told something false in the organisation's name. Keep it to test chats until this lands.

---

## D-82 · A gateway restart can break the WhatsApp session — pinned (found 2026-10-21)

**What happened:** after many restarts of the gateway in one afternoon (each saved edit restarts it under `tsx watch`), the saved encryption
sessions for the linked number stopped matching WhatsApp's. 213 decrypt failures ("No matching sessions found", "Key used already",
"Message counter error"); the number showed linked but nothing arrived from 15:17 to 17:03; the messages in between are not in the CRM.
Deleting one contact's sessions fixed sending to them but not receiving. **Unlink and relink (a new QR) fixed it.**

**Probable cause (not proven):** the stored session state is behind what was already acknowledged to WhatsApp because the process is killed
before its last writes land. **To do:** flush the auth state on SIGTERM; refuse to start a second gateway on the same number; detect a burst of
"No matching sessions" and say so on the Linked numbers page with a "Reset" button (relink), instead of showing "Linked". **Until then:** do not
restart the gateway while testing; `bash infra/scripts/dev-up.sh --no-gateway` restarts only the API and web. Runbook entry: `docs/14-runbooks.md`.

**Also found (2026-10-21), same root:** the health scorer read our own decrypt failures and undelivered messages as a suspected soft ban and put the number in quarantine with a
**48-hour pause** (risk 100), holding every send; it only cleared because Kushal turned **Advisory mode** on for that number (anti-ban enforcement off; turn it back after testing).
The scorer should ignore decrypt failures for `fromMe` messages and for a burst right after a restart, and a message the recipient could not read should not count as undelivered.
**Done in #96:** the gateway now answers a recipient's resend request for text (`resendText` / Baileys `getMessage`), so "Waiting for this message" can clear.

---

## D-83 · `npm run dev:fast` leaves some screens stale after an action — pinned (found 2026-10-21)

**What:** against the production build (`next start`) six browser specs fail that pass against `next dev` and in CI: `broadcast-flow`,
`bulk-tag-flow`, `contacts-dates`, `contacts-tags`, `fields-and-status`, `seeded-pages`. The pattern is "do something, the page does not
refresh": a removed custom field or tag stays on screen until a reload. Probably the client router cache. Not investigated. **Until fixed,
use `dev:fast` to look at pages and demo, and `dev:all` to test flows.**

---

## D-84 · The AI runs whole conversations — pinned (Kushal, 2026-10-21: it "should take over the entire conversation")

**Done so far:** the system text tells the assistant to lead (answer, then ask one question toward the goal in the organisation's
instructions, never repeat a question already answered) and to hand over with a summary only when asked or when the goal is done.
**Not built:** a *Goal* field in the AI settings (today the goal lives in the free-text instructions); **auto-assigning new chats** to the
assistant (today a person assigns each chat); **follow-ups** when the customer goes quiet; stopping rules (a maximum number of messages before a
person looks); a summary note at hand-over that is a real field, not text in the reason.

Pinned to come back to; not started.
