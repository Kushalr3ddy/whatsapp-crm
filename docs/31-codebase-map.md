# 31 · Codebase map: every directory and file

What each directory and file in the repository is for, so a new reader can find the right place without opening
everything. Written 2026-10-16 from the 420 tracked files on `main`.

**How it was made, and how far to trust it.** The folder descriptions are hand-written. The per-file descriptions are
the first sentence of each file's own header comment (the repo's lint rule requires one on every function and
exported constant, `docs/11-conventions.md`), or the first line of a SQL or shell comment, or a heading in a
document. They are therefore the author's words, but a few are terse. `—` means the file has no header comment.
Regenerate rather than hand-edit when the layout changes: the generator is a short script (see the end).

**The shape in one picture**

```
apps/       four programs: api (HTTP), gateway (WhatsApp sockets), web (UI), worker (reserved)
packages/   libraries: shared -> db -> core, plus channels (transports) and providers (drivers)
tests/      contract, integration, e2e, simulation, live
infra/      compose, container entrypoint, dev scripts          scripts/  operator tools
docs/       design and operations                               packages/db/migrations  the schema's history
```

Dependency rule (lint-enforced): `apps -> core, shared, db`; `core -> shared, db and ports only`; adapters and
drivers `-> shared`; `shared -> nothing`. `core` may import `ChannelProvider` but never `baileys`.


## `/` (repository root)

The repository root: the npm workspace manifest, the config for every tool, the top-level guides and the Docker image.

| File | What it is |
|---|---|
| `.dockerignore` | What the Docker build leaves out (secrets, node_modules, git, build output). |
| `.env.example` | Every environment variable with its default and a comment; copy to `.env` and fill the secrets. |
| `.gitignore` | Files git never tracks: dependencies, build output, `.env`, local storage, logs. |
| `.gitleaksignore` | Known false positives for the secret scanner. |
| `CHANGELOG.md` | The work ledger: what was done (newest first) and the prioritised to-do list. |
| `CONTRIBUTING.md` | How to contribute: branches, PRs, commit style, the comment rule. |
| `Dockerfile` | Builds the alpha image: installs, builds the web UI, runs the entrypoint. |
| `GETTING_STARTED.md` | A fresh clone to a running, signed-in instance in nine steps. |
| `HANDOFF.md` | Point-in-time state for the next session: what is merged, open, pending, and what to ask first. |
| `README.md` | The project overview and where to start. |
| `SECURITY.md` | Security contact and the 90-day disclosure window. |
| `STRUCTURE.md` | The short original layout sketch. Superseded by `docs/31-codebase-map.md` for detail. |
| `eslint.config.js` | Lint rules, including the rule that every function and exported constant carries a comment, and the package-boundary import rules. |
| `package-lock.json` | The exact dependency versions (generated; do not edit). |
| `package.json` | The npm workspace manifest: dependencies and every `npm run` script. |
| `playwright.config.ts` | Browser-test settings; starts or reuses the dev stack. |
| `playwright.live.config.ts` | Settings for the headed live walkthrough against a real number. |
| `tsconfig.json` | TypeScript settings, strict mode, and the `@crm/*` path aliases. |
| `vitest.config.ts` | Unit and integration test settings and aliases. |
| `vitest.sim.config.ts` | Settings for the anti-ban simulation run. |

## `.github/workflows/`

GitHub Actions. What runs on every pull request.

| File | What it is |
|---|---|
| `ci.yml` | Pull-request checks: typecheck, lint, the whole test suite against a real Postgres (and an S3 emulator for the storage contract), the browser suite, and the secret scan. |
| `simulation.yml` | Runs the anti-ban simulation (nine scenarios, about 10 minutes) on pull requests. |

## `apps/`

The four runnable programs. Each is thin: the real logic lives in `packages/`.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `apps/api/`

The HTTP API (Express 5). Auth, validation, routing; no business rules of its own.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `apps/api/src/`

The API's composition root (`app.ts`, `server.ts`), middleware (auth, tenancy, rate limits, errors) and the helpers every route shares.

| File | What it is |
|---|---|
| `app.test.ts` | Tests for the app wiring: health, readiness, 404s and error shapes. |
| `app.ts` | Builds the Express app: middleware order, the body-size limits, and every route mounted under `/api/v1`. The composition root. |
| `auth.ts` | Works out who is calling (session cookie, per-org API key or the bootstrap key), CSRF for cookie writes, and the scope and role checks. |
| `cors.ts` | Cross-origin access for browsers from an explicit allowlist only. |
| `params.ts` | Validates path parameters (a malformed UUID is a 422, not a 500). |
| `problem.ts` | The one RFC 7807 error body used everywhere, with a stable machine-readable code. |
| `rate-limit.ts` | Per-API-key request limiting with `Retry-After` and `RateLimit-*` headers (in-process). |
| `server.ts` | Process entry: validates config, checks the schema and tenant isolation, then listens. Refuses to start if the database does not match the code. |
| `tenant.ts` | Runs each unit of work in a transaction with `app.org_id` set and the restricted role, so row-level security applies to every query. |

## `apps/api/src/routes/`

One file per resource under `/api/v1`: inbox, messages, contacts, campaigns, imports, senders, admin and so on.

| File | What it is |
|---|---|
| `admin.ts` | Provisioning: create an org and its first admin, add users, issue and revoke API keys. |
| `auth.ts` | Sign-in, sign-out and `me`; login throttling; the session and CSRF cookies. |
| `campaigns.ts` | Campaigns: create a draft, preview, start, pause, resume, cancel, per-recipient results, gate overrides. |
| `contacts.ts` | Contacts: list and search, create, tags, custom fields, do-not-contact, count, CSV and vCard export. |
| `custom-fields.ts` | The org's typed custom-field vocabulary. |
| `encryption.ts` | The key-rotation wizard's API: status, pause, resume, verify. |
| `imports.ts` | Importing contacts: upload a CSV or xlsx, suggest columns, dry run, commit, and the rows that failed or lost a number. |
| `media.ts` | Serves one stored attachment: authenticated, download-only, type from the file's bytes, audited. |
| `messages.ts` | The inbox API: conversations, threads, send a message or file, notes, canned replies, owner and participants, presence and typing. |
| `segments.ts` | Saved audiences and the live-count preview. |
| `senders.ts` | WhatsApp numbers: create, link (QR or pairing code), unlink, health, enforcement mode. |
| `tags.ts` | Tags and bulk tagging with a preview and a count check. |

## `apps/gateway/`

The WhatsApp gateway: its own process, owns the sockets, reads work from the database and sends.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `apps/gateway/src/`

The gateway's entry point and handlers: send path with all the anti-ban gates, link/unlink, sweeps, number fallback, tenant handle.

| File | What it is |
|---|---|
| `main.ts` | Gateway entry point: connects the stored numbers, listens for database notifications, runs the sweep loop, and wires inbound events and media. |
| `tenant.ts` | A database handle pinned to one org so every gateway statement runs under row-level security (D-41). |
| `work.ts` | The gateway's handlers: the send path with every anti-ban gate, link and unlink, campaign dispatch, health and restriction sweeps, read receipts, entropy. |

## `apps/web/`

The web UI (Next.js 15). A client of the API: it holds no database connection of its own.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `middleware.ts` | Sends anyone without a session cookie to the sign-in page (a convenience; the API does the real check). |
| `next.config.ts` | Next settings: strict mode and the 25 MB server-action body limit (uploads go through server actions). |
| `package.json` | Package manifest for this workspace folder. |
| `postcss.config.mjs` | PostCSS pipeline for Tailwind v4. |
| `tsconfig.json` | TypeScript settings for the web app (DOM and JSX types). |

## `apps/web/app/`

The Next.js App Router. One folder per screen; `actions.ts` holds the server actions; `ui.tsx` and `nav.tsx` are shared pieces.

| File | What it is |
|---|---|
| `actions.ts` | Shared server actions: send a message or file, upload and run an import, link and unlink a number, fetch problem rows. |
| `coming-soon.tsx` | A placeholder for a section that is in the navigation but not built. |
| `globals.css` | Tailwind setup and the design tokens (light and dark). |
| `layout.tsx` | The shell around every page: sidebar, theme, title. |
| `nav.tsx` | The sidebar with live counts and the restricted-number badge. |
| `page.tsx` | The Overview screen: live counts of conversations, contacts and numbers. |
| `theme-toggle.tsx` | Light, dark or automatic theme switch. |
| `ui.tsx` | Small presentational pieces shared by every screen (page header, empty state, avatars). |

## `apps/web/app/billing/`

Billing placeholder page (not built, D-47).

| File | What it is |
|---|---|
| `page.tsx` | Billing placeholder (D-47). |

## `apps/web/app/broadcast/`

Campaigns: the list and the page that builds one.

| File | What it is |
|---|---|
| `actions.ts` | Server actions for campaigns: create, start, pause, resume, cancel, with the inline audience filter. |
| `campaign-status.ts` | Label and colour for a campaign status. |
| `page.tsx` | The campaign list. |

## `apps/web/app/broadcast/[id]/`

One campaign: progress, per-recipient results, pause, resume, cancel.

| File | What it is |
|---|---|
| `page.tsx` | One campaign: progress, forecast, per-recipient results and filters. |

## `apps/web/app/broadcast/new/`

The new-campaign form with the inline audience builder.

| File | What it is |
|---|---|
| `audience-picker.tsx` | The audience chooser: a tag, an import, hand-picked people or an inline filter with a live count. |
| `page.tsx` | The new-campaign form. |

## `apps/web/app/contacts/`

The contacts screen: search, tags, bulk tagging, custom fields, do-not-contact.

| File | What it is |
|---|---|
| `actions.ts` | Server actions for contacts: tag a person (by name from one shared list), bulk tag with preview, custom fields, do-not-contact. |
| `page.tsx` | The contacts screen: search, tag filters, bulk tagging, per-row tags and checkboxes to start a campaign. |

## `apps/web/app/contacts/export/`

Streams the CSV or vCard export through the web server.

| File | What it is |
|---|---|
| `route.ts` | Streams the contact export (CSV or vCard) from the API to the browser. |

## `apps/web/app/import/`

The import screen: upload, column suggestion, preview, commit and the rows-to-fix box.

| File | What it is |
|---|---|
| `import-panel.tsx` | The import flow: upload, column suggestions with a how-phone-like hint, preview, import, and the rows-to-fix box. |
| `page.tsx` | The import page wrapper. |

## `apps/web/app/inbox/`

The shared inbox: conversation list, filters, auto-refresh.

| File | What it is |
|---|---|
| `auto-refresh.tsx` | Re-fetches the inbox on a timer. |
| `conversation-list.tsx` | The conversation list with owner and status filters and a viewing/typing marker. |
| `layout.tsx` | Two-column inbox layout. |
| `page.tsx` | The inbox with no thread selected. |

## `apps/web/app/inbox/[id]/`

One conversation: thread, composer, notes, owner and participants.

| File | What it is |
|---|---|
| `composer.tsx` | The reply box: send, attach a file, saved replies, the typing signal and the send-anyway warning. |
| `page.tsx` | One thread: messages with authors and delivery state, notes, contact panel, why a message is waiting. |
| `presence-beat.tsx` | Tells the server this thread is open (a heartbeat). |
| `thread-controls.tsx` | Assign the thread and open or close it. |
| `viewers-line.tsx` | The "Asha is viewing / Bilal is typing" line. |

## `apps/web/app/inbox/[id]/live/`

Route handler polled for presence, typing and who is viewing (plain fetch, not server actions).

| File | What it is |
|---|---|
| `route.ts` | The polled endpoint for presence, typing and viewers. |

## `apps/web/app/link/`

The Numbers screen: link a number by QR or pairing code, health and recovery banners.

| File | What it is |
|---|---|
| `actions.ts` | Server actions for numbers: link, unlink, switch enforcement mode. |
| `link-panel.tsx` | The linking panel: QR with countdown or pairing code, and readable link errors. |
| `page.tsx` | The Numbers screen: each number's state, health meter, recovery and restriction banners and timeline. |

## `apps/web/app/login/`

Sign-in page and its server action.

| File | What it is |
|---|---|
| `actions.ts` | Signs in through the API and stores the session and CSRF cookies. |
| `login-form.tsx` | The sign-in form. |
| `page.tsx` | The sign-in page. |

## `apps/web/app/media/[id]/`

Proxy that streams one attachment from the API with the visitor's session.

| File | What it is |
|---|---|
| `route.ts` | Proxies one attachment from the API using the visitor's session. |

## `apps/web/app/security/`

The key-rotation wizard (admins only).

| File | What it is |
|---|---|
| `actions.ts` | Server actions for the key-rotation wizard. |
| `controls.tsx` | The wizard's buttons and its live progress bar. |
| `page.tsx` | The Security page (admins): the five-step key rotation wizard. |

## `apps/web/app/segments/`

Saved audiences.

| File | What it is |
|---|---|
| `actions.ts` | Server actions that build and save a segment from the form. |
| `page.tsx` | Saved audiences with a live count. |

## `apps/web/lib/`

Server-side helpers: the API client (`crm.ts`) and the client-IP forwarder.

| File | What it is |
|---|---|
| `client-ip.ts` | Reads the browser's address (Cloudflare or forwarded headers) to pass on to the API for the audit trail. |
| `crm.ts` | The server-side client for the API: forwards the person's session and unwraps responses; all the screens' types live here. |

## `apps/worker/`

Reserved for queue consumers (not used yet; the gateway does the background work today).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `config/`

Reserved for file-based preset configuration (empty).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps the empty folder in git. |

## `docs/`

The design and operating documentation. Start at `docs/README.md`.

| File | What it is |
|---|---|
| `00-prior-art.md` | 00 · Prior art — what the previous system got wrong |
| `01-vision-scope.md` | 01 · Vision & scope |
| `02-requirements.md` | 02 · Requirements |
| `03-competitive-analysis.md` | 03 · Competitive analysis |
| `04-architecture.md` | 04 · Architecture |
| `05-data-model.md` | 05 · Data model |
| `07-ingestion.md` | 07 · Data ingestion framework |
| `08-antiban.md` | 08 · Anti-ban engine |
| `09-security.md` | 09 · Security & privacy |
| `10-stack.md` | 10 · Stack — every choice and the alternative that lost |
| `11-conventions.md` | 11 · Code conventions |
| `12-testing.md` | 12 · Testing strategy |
| `13-deployment.md` | 13 · Deployment & operations |
| `14-runbooks.md` | 14 · Runbooks |
| `15-api.md` | 15 · Public API |
| `16-integration-jobportal.md` | 16 · Integration: embedding in a host application |
| `17-roadmap.md` | 17 · Roadmap |
| `18-providers.md` | 18 · Pluggable providers |
| `19-capacity.md` | 19 · Capacity & resource planning |
| `20-orientation.md` | 20 · Orientation — start here if any of this is unfamiliar |
| `21-deferred.md` | 21 · Deferred decisions |
| `22-encryption.md` | 22 · Encryption, end to end |
| `23-auth.md` | 23 · Authentication, end to end |
| `24-local-testing.md` | 24 · Testing it by hand, locally |
| `25-ingestion-guide.md` | 25 · Ingestion in depth — sources, deduping, and testing it by hand |
| `26-linking-lifecycle.md` | 26 · Linking — how the gateway, the database and the phone stay in sync |
| `27-restriction-tracking.md` | 27 · Silent-restriction tracking |
| `28-logging-and-telemetry.md` | 28 · Logging and telemetry |
| `29-free-hosting-plan.md` | 29 · Free hosting plan |
| `30-cloudflare-tunnel.md` | 30 · Running behind a Cloudflare Tunnel |
| `README.md` | Documentation |
| `capacity-calculator.html` | HTML asset used by the docs tooling. |

## `docs/06-features/`

One file per product module (F1 channels … F12 AI agent) with acceptance criteria.

| File | What it is |
|---|---|
| `F1-channels.md` | F1 · Channels & sessions |
| `F10-analytics.md` | F10 · Analytics |
| `F11-admin.md` | F11 · Admin & settings |
| `F12-ai-agent.md` | F12 · AI agent |
| `F2-contacts.md` | F2 · Contacts & identity |
| `F3-inbox.md` | F3 · Shared inbox |
| `F4-templates.md` | F4 · Templates |
| `F5-campaigns.md` | F5 · Campaigns |
| `F6-antiban.md` | F6 · Anti-ban engine |
| `F7-ingestion.md` | F7 · Data ingestion |
| `F8-api.md` | F8 · Public API & webhooks |
| `F9-automation.md` | F9 · Automation |
| `README.md` | 06 · Features |

## `docs/assets/`

Images used by the docs.

| File | What it is |
|---|---|
| `README.md` | Images used by the docs |
| `testers.png` | Image used in the docs. |

## `docs/assets/competitors/`

Screenshots of competing products referenced in the market research.

| File | What it is |
|---|---|
| `aisensy-live-chat-lanes.jpg` | Image used in the docs. |
| `chatwoot-inbox.jpg` | Image used in the docs. |
| `interakt-shared-inbox.jpg` | Image used in the docs. |
| `pipedrive-pipeline.jpg` | Image used in the docs. |
| `respondio-inbox-changelog.jpg` | Image used in the docs. |
| `respondio-inbox.jpg` | Image used in the docs. |
| `twenty-crm.jpg` | Image used in the docs. |
| `wati-campaigns-overview.jpg` | Image used in the docs. |
| `wati-team-inbox-filters.jpg` | Image used in the docs. |
| `zohorecruit-pipeline-view.jpg` | Image used in the docs. |

## `docs/generated/`

Output folder for generated docs (`npm run db:docs` writes the schema map here; git-ignored).

| File | What it is |
|---|---|
| `schema.html` | HTML asset used by the docs tooling. |

## `infra/`

Everything to build, run and deploy it.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `infra/compose/`

Docker Compose for the alpha: the app container, Postgres, and an optional Cloudflare tunnel.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `README.md` | How to run the alpha container: ports, first-run behaviour, the Secure-cookie and datacenter-IP caveats. |
| `alpha.env.example` | Optional overrides for the alpha stack (admin email, ports, storage driver and S3 settings, tunnel token). |
| `compose.yaml` | The alpha stack: the app container (API, gateway, web), Postgres, and an optional `cloudflared` tunnel behind the `tunnel` profile. |

## `infra/docker/`

The container entrypoint that migrates and supervises the three processes.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `entrypoint.sh` | Container entrypoint: generates secrets once, applies migrations, creates the first admin, then runs the API, gateway and web and stops all if one dies. |

## `infra/grafana/`

Reserved for dashboards (empty; telemetry is D-56).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `infra/prometheus/`

Reserved for metrics config (empty; telemetry is D-56).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `infra/scripts/`

Shell scripts for local development: start the stack, manage the dev database, run compose.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `compose.sh` | Runs the compose file with whichever Compose is installed (the `docker compose` plugin or the older `docker-compose`). |
| `dev-db.sh` | Starts and manages the local Postgres container (`up`, `down`, `reset`, `psql`, `status`) on port 5434. |
| `dev-up.sh` | `npm run dev:all`: database, migrations, then API, gateway and web together with prefixed logs. |
| `rls-demo.sql` | Demonstrates that tenant isolation actually works, and why the connecting role matters. |

## `packages/`

Shared libraries. Dependencies flow downward: apps -> core -> db/shared; adapters depend only on shared (`docs/11-conventions.md`).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/antiban/`

Reserved for a separate anti-ban package (the engine currently lives in `packages/core`).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/channels/`

The messaging-transport port and its adapters.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/channels/baileys/`

The real WhatsApp adapter (Baileys 6.7.24).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `package.json` | Package manifest for this workspace folder. |

## `packages/channels/baileys/src/`

Adapter code: sockets, link/QR, send, receive, auth-state store, decrypt-failure tap.

| File | What it is |
|---|---|
| `auth-adapter.ts` | Stores Baileys' credentials and keys in Postgres instead of files. |
| `decrypt-tap.ts` | Listens to Baileys' logger for undecryptable-message reports, the signal of a diverged session. |
| `event-stream.test.ts` | Reads `count` events, giving up after a timeout so a hang fails loudly instead of stalling. |
| `event-stream.ts` | Turns pushed events into an async iterable. |
| `index.ts` | The Baileys adapter: link, connect, send, receive, receipts, typing, presence, media download, and the registration lookup. |
| `mapping.test.ts` | Tests for translating Baileys messages into the neutral shape. |
| `outbound-content.ts` | Turns our neutral message content into what Baileys' `sendMessage` takes. |

## `packages/channels/fake/`

An in-memory fake transport used by every test and the dev fake gateway.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/channels/fake/src/`

The fake provider: records sends, can fail on demand, answers registration lookups.

| File | What it is |
|---|---|
| `index.ts` | The in-memory fake transport: records sends, can fail on demand, reports delivery, answers registration lookups. |

## `packages/channels/meta/`

Reserved for the official Meta Cloud API adapter (P8, not built).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/channels/src/`

The `ChannelProvider` port: the interface every transport implements.

| File | What it is |
|---|---|
| `index.ts` | Exports the channel port. |
| `port.ts` | The `ChannelProvider` interface every transport implements, and the neutral message types. |

## `packages/core/`

Domain logic: the rules of the product. May import ports, never a concrete adapter.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/core/src/`

Pacing, contact-graph gates, health scoring, restriction detection, recovery, campaigns, ingestion, messages, media, tagging, audit, key rotation and more.

| File | What it is |
|---|---|
| `api-keys.ts` | Issuing, hashing and verifying per-org API keys with scopes. |
| `audit.ts` | The append-only audit log writer, the reserved system actor, and the list of audit actions. |
| `body-variation.ts` | Campaign body variation — P6 anti-ban / F4 (docs/08-antiban.md, docs/21-deferred.md D-26). |
| `campaigns.ts` | Campaign logic: freeze an audience, preview, and turn recipients into queued messages no faster than the ceiling allows. |
| `contact-export.ts` | Exporting everyone the system holds about the people it messages — to CSV for a spreadsheet, or to vCard so the contacts can be loaded onto a phone. |
| `contact-graph.ts` | Contact-graph gates — P6 anti-ban, the relationship layer (docs/08-antiban.md). |
| `custom-fields.ts` | Custom fields: the fixed vocabulary an org defines for what it knows about its contacts. |
| `decrypt-failures.ts` | Decrypt-failure signal — P6 anti-ban Layer 5 (docs/08-antiban.md). |
| `entropy.ts` | Background entropy — P6 anti-ban Layer 3 (docs/08-antiban.md). |
| `health.ts` | Sender health scoring — P6 anti-ban, the feedback loop (docs/08-antiban.md). |
| `identity-linking.ts` | Linking a WhatsApp privacy address (`…@lid`) to the phone number it belongs to. |
| `index.ts` | Exports the domain modules. |
| `ingestion.ts` | Turning a spreadsheet into contacts. |
| `key-rotation.ts` | Key rotation (D-31): moving every encrypted value from an old key onto the current one, a few rows at a time, while the app keeps running. |
| `link-errors.ts` | Why a link attempt failed, in words an operator can act on. |
| `media.ts` | Stores inbound and outbound attachments: type from magic bytes, per-org sha256 dedup, key building, the download lookup. |
| `messages.ts` | Stores one inbound message: resolve the contact, the conversation, encrypt the body, apply delivery receipts. |
| `pacing.ts` | Send pacing — the first gate between a queued message and WhatsApp. |
| `policy-gates.ts` | The recipient-experience gates (docs/08-antiban.md, "two classes of gate"). |
| `provisioning.ts` | Creates an org with its first admin, the one path through which an organisation comes into being. |
| `read-receipts.ts` | Read behaviour — P6 anti-ban Layer 3 (docs/08-antiban.md). |
| `recipient-timezone.ts` | Recipient-timezone inference — P6 anti-ban Layer 3 (docs/08-antiban.md). |
| `recovery.ts` | Recovery orchestration — P6 anti-ban, Layer 6 (docs/08-antiban.md). |
| `restriction.ts` | Silent-restriction detection (docs/27-restriction-tracking.md). |
| `segments.ts` | Dynamic segments — the criteria-based audience filter (docs/21-deferred.md D-28). |
| `sessions.ts` | Server-side sign-in sessions: issue, resolve (with idle and absolute expiry) and revoke. |
| `tagging.ts` | Mass tagging: add or remove one tag across many contacts in a single set-based statement. |
| `typing.ts` | Typing simulation — P6 anti-ban, the human-rhythm layer (docs/08-antiban.md, D-24). |

## `packages/db/`

The database layer: Drizzle schema, migrations, row-level-security helpers.

| File | What it is |
|---|---|
| `drizzle.config.ts` | drizzle-kit settings for generating migrations. |
| `package.json` | Package manifest for this workspace folder. |

## `packages/db/migrations/`

Forward-only SQL migrations, applied in order and never edited afterwards.

| File | What it is |
|---|---|
| `0000_peaceful_mysterio.sql` | The first schema: org, app_user, org_membership, contact and contact_identity. |
| `0001_rls_and_identity_constraints.sql` | Tenant isolation and the identity constraints, from the first release. |
| `0002_column_comments.sql` | Column documentation, stored in the database rather than only in docs/05-data-model.md. |
| `0003_contact_jsonb_and_indexes.sql` | Contact custom-field and external-reference indexes (two Postgres details drizzle-kit does not generate). |
| `0004_channels.sql` | WhatsApp numbers and their connections: sender_identity, channel_session and the encrypted channel_auth_state. |
| `0005_conversations.sql` | Conversations and messages. |
| `0006_link_handshake.sql` | The link request columns on channel_session and the `notify_gateway()` trigger function that wakes the gateway. |
| `0007_chubby_ezekiel.sql` | Authentication: browser sessions and per-org API keys. |
| `0008_aberrant_thunderbolt.sql` | The append-only audit log. |
| `0009_legal_hairball.sql` | Media: the media_asset table and `message.media_id`. |
| `0010_wide_magus.sql` | Imports: import_run and the per-row import_row ledger. |
| `0011_many_joseph.sql` | Campaigns: campaign and campaign_recipient, and `message.campaign_id`. |
| `0012_notes_and_canned_replies.sql` | Internal notes (never sent) and saved replies. |
| `0013_unlink_signal.sql` | The unlink request column and trigger, so the gateway can log a number out. |
| `0014_wakeful_storm.sql` | Tags: tag and contact_tag. |
| `0015_slow_tattoo.sql` | Lets a campaign target a tag (`campaign.from_tag_id`). |
| `0016_cynical_hemingway.sql` | Timed recovery state on a sender (`recovery_incident`, `recovery_started_at`, `recovery_until`). |
| `0017_natural_pandemic.sql` | Saved audiences (segment) and campaigns that target one. |
| `0018_thick_makkari.sql` | `channel_session.decrypt_burst_at`, the diverged-session signal. |
| `0019_rapid_catseye.sql` | Advisory mode on a sender and the per-campaign gate overrides. |
| `0020_bored_doorman.sql` | Custom fields (custom_field) and `message.hold_reason`. |
| `0021_jittery_moon_knight.sql` | Do-not-contact override columns on a message. |
| `0022_chemical_doctor_octopus.sql` | Silent-restriction tracking: sender_health_event, restriction state, and `campaign.pause_reason`. |
| `0023_dusty_havok.sql` | `segment.saved`: lets an inline one-off audience stay out of the saved list. |
| `0024_conversation_participant.sql` | Owner plus participants on a conversation (D-53). |
| `0025_conversation_presence.sql` | Who has a thread open right now (D-17). |
| `0026_conversation_typing.sql` | `conversation_presence.typing_at` for the typing indicator (D-54). |
| `0027_key_rotation.sql` | Key-rotation progress and pause state (D-31). |
| `0028_envelope_key_version.sql` | The `envelope_key_version()` function (safe on short values) and the indexes that find rows still on an old key. |

## `packages/db/migrations/meta/`

Drizzle's migration journal and per-migration schema snapshots.

| File | What it is |
|---|---|
| `0000_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0001_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0002_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0003_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0004_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0005_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0006_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0007_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0008_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0009_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0010_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0011_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0012_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0013_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0014_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0015_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0016_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0017_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0018_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0019_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0020_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0021_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0022_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0023_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0024_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0025_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0026_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0027_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `0028_snapshot.json` | Drizzle's snapshot of the schema after this migration (generated). |
| `_journal.json` | Drizzle's ordered list of applied migrations. |

## `packages/db/src/`

Schema definition, client, migrator, startup security and schema checks, tenant helpers.

| File | What it is |
|---|---|
| `auth-state-store.ts` | Stores the WhatsApp session credentials in Postgres, encrypted. |
| `client.ts` | Creates the typed database connection. |
| `index.ts` | Exports the database layer. |
| `migrate.ts` | Applies pending migrations, then exits; run before anything listens. |
| `schema-check.ts` | Verifies the database has exactly the migrations this code expects. |
| `schema.ts` | The Drizzle schema: every table, column and index. |
| `security-check.ts` | Measures whether row-level security is actually in force for the connecting role, and resolves the restricted role to drop to. |
| `table-notes.ts` | One plain-English line per table for the schema visualizer; a test fails if a table has none. |

## `packages/ingestion/`

Reserved for the `SourceConnector` port (import code lives in `packages/core` for now).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/`

Planned source connectors.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/csv/`

Reserved (CSV import is built into core).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/excel/`

Reserved (Excel import is built into core).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/gsheets/`

Reserved for a Google Sheets connector (D-21 family).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/rest/`

Reserved for a REST-pull connector.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/ingestion/connectors/webhook/`

Reserved for a webhook source.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/`

Infrastructure drivers, one folder per port (`docs/18-providers.md`).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/auth/`

Authentication port and drivers.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/auth/builtin/`

Built-in password authentication (Argon2id).

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/providers/auth/builtin/src/`

Password hasher and the credential helpers.

| File | What it is |
|---|---|
| `index.test.ts` | Tests for password hashing. |
| `index.ts` | Argon2id password hashing, with a dummy hash so a missing account takes as long as a wrong password. |

## `packages/providers/cache/`

Reserved for a cache driver.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/email/`

Reserved for an email driver.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/kms/local/`

Local key management: AES-256-GCM envelope encryption with a key ring and a blind index.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/providers/kms/local/src/`

The local KMS implementation and its tests.

| File | What it is |
|---|---|
| `index.test.ts` | Tests for encryption, the key ring and the blind index. |
| `index.ts` | AES-256-GCM envelope encryption with a versioned key ring and a deterministic blind index. |

## `packages/providers/llm/`

Reserved for an LLM driver (nothing reads `LLM_DRIVER` yet).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/queue/`

Reserved for a queue driver (Postgres LISTEN/NOTIFY is used instead).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/scanner/`

Reserved for an antivirus driver.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/secrets/`

Reserved for a secrets driver.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/sms/`

Reserved for an SMS driver.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/providers/storage/`

File storage: the port and its drivers.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `package.json` | Package manifest for this workspace folder. |

## `packages/providers/storage/filesystem/`

The local-disk driver (the default).

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/providers/storage/filesystem/src/`

Stores files under a directory, content type in a sidecar.

| File | What it is |
|---|---|
| `index.ts` | Stores files under a directory with the content type in a sidecar; refuses any key that would escape the root. |

## `packages/providers/storage/s3/`

The S3-compatible driver (AWS S3, Cloudflare R2, Backblaze B2, MinIO).

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/providers/storage/s3/src/`

S3 driver built on the AWS SDK.

| File | What it is |
|---|---|
| `index.ts` | Stores files in an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO). |

## `packages/providers/storage/src/`

The `StorageDriver` port, key rules and the factory that picks a driver.

| File | What it is |
|---|---|
| `factory.ts` | Builds the configured storage driver; the only place that knows which one. |
| `index.test.ts` | Tests for key validation and the driver factory. |
| `index.ts` | The `StorageDriver` port, the key rules and `mediaKey()`. |

## `packages/sdk/`

Reserved for a generated typed API client (P9).

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `packages/shared/`

Code every other package may use: config, logger, phone parsing, CSV/XLSX parsing, results. Imports nothing from the repo.

| File | What it is |
|---|---|
| `package.json` | Package manifest for this workspace folder. |

## `packages/shared/src/`

Config schema (Zod), logger, phone and column helpers, CSV/XLSX readers, Result type.

| File | What it is |
|---|---|
| `column-guess.test.ts` | Tests for choosing the phone, email and name columns from their values. |
| `column-guess.ts` | Scores each column's first values to suggest the phone, email and name columns for an import. |
| `config.test.ts` | The smallest environment the schema accepts; each test layers one setting on top. |
| `config.ts` | The whole environment contract, validated at boot; a missing required value is a hard crash with a readable message. |
| `csv.test.ts` | Tests for the CSV reader. |
| `csv.ts` | A strict RFC 4180 CSV reader. |
| `index.ts` | Exports the shared kernel. |
| `logger.ts` | The structured JSON logger with a redaction allowlist. |
| `media-type.test.ts` | Tests for file-type detection. |
| `media-type.ts` | Decides what a file is from its first bytes, never from its name. |
| `phone.test.ts` | Tests for phone normalisation, multi-number cells and blank markers. |
| `phone.ts` | Normalises a phone number to E.164, splits cells holding several numbers, and recognises `NA`-style blanks. |
| `result.ts` | A small success-or-error type. |
| `xlsx.ts` | Reads the first worksheet of an .xlsx into text rows (a phone stored as a number survives). |

## `scripts/`

One-off and operator scripts run with `tsx`: admin CLI, key tool, seed data, schema docs, PDF build, link a number.

| File | What it is |
|---|---|
| `admin.ts` | Administrative commands, for setting a deployment up and for support. |
| `db-docs.template.html` | HTML asset used by the docs tooling. |
| `db-docs.ts` | Reads the live database and writes one self-contained HTML page that explains it: |
| `docs-pdf.mjs` | Builds one printable PDF of the whole documentation set: |
| `keys.ts` | Encryption key rotation, the part that must happen on the server (D-31). |
| `local-flow.ts` | A local-only walkthrough: |
| `local-seed.ts` | Seeds the UI-test org with a believable working set, so browser tests (and a human clicking around) have something to look at: |
| `open-pr.sh` | Opens a pull request for the current branch against main, using the git credential already stored on this machine (the `gh` CLI is not installed). |
| `verify.sh` | One command to prove the project works: |
| `wa-link.ts` | Development tool: link a real WhatsApp number and watch messages flow. |

## `tests/`

Everything that is not a unit test beside its code.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `tests/contract/`

One conformance suite per port, run against every driver.

| File | What it is |
|---|---|
| `channel-provider.ts` | The conformance suite every ChannelProvider must pass. |
| `fake-channel-delivery.test.ts` | `autoDeliverAfterMs`: |
| `fake-channel.test.ts` | Runs the channel contract against the fake. |
| `filesystem-storage.test.ts` | Runs the storage contract against the filesystem driver. |
| `s3-storage.test.ts` | Runs the shared StorageDriver contract against an S3-compatible server. |
| `storage-driver.ts` | The conformance suite every StorageDriver must pass. |

## `tests/e2e/`

Playwright browser tests against a throwaway fake-channel stack.

| File | What it is |
|---|---|
| `auth.spec.ts` | Authentication end to end: |
| `broadcast-flow.spec.ts` | Sign in → create a broadcast in the UI → start it → see it running → cancel it. |
| `bulk-tag-flow.spec.ts` | The tagging story end to end, in the browser: |
| `dnc.spec.ts` | Flagging a contact do-not-contact from the Contacts page, and clearing it again. |
| `fields-and-status.spec.ts` | The two operator-facing additions: |
| `helpers.ts` | Browser-test helpers: sign in as the dev test admin, open collapsed panels. |
| `import-problems.spec.ts` | The import screen reads the phone column from the values, not just the header, and lists the rows it could not use. |
| `security.spec.ts` | The key rotation wizard (D-31). |
| `seeded-pages.spec.ts` | The pages that had no browser coverage — inbox, contacts, import, numbers, saved audiences — driven against the working set `npm run local:seed` creates (CI runs the seed before this). |
| `send-flow.spec.ts` | A broadcast that really goes through the engine and out the other side. |
| `walkthrough.spec.ts` | The main pages render for a signed-in operator, and the segment builder's live count works — the regression that guards it is real: |
| `zz-roles-flow.spec.ts` | Two people on one chat (admin and agent): assign, lock, participants, authorship, presence, typing, collision and refusals. Runs last. |

## `tests/fixtures/`

Sample files and helpers the tests share.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `import-contacts.csv` | 29 rows of fake contacts written many ways, with duplicates, bad rows and a landline, for the import tests. |
| `import-header-samples.json` | Header rows (no data) from ten public and real sources, used to shape the import wizard (D-21). |
| `storage.ts` | A storage driver backed by a throwaway directory, and the way to remove it again. |

## `tests/integration/`

Tests against a real Postgres: repositories, routes, gateway work, row-level security.

| File | What it is |
|---|---|
| `api.test.ts` | The API end to end: auth, senders, conversations, sending. |
| `audit.test.ts` | The append-only audit log. |
| `auth-state-store.test.ts` | The encrypted credential store, on the test database. |
| `auth.test.ts` | Sign-in, sessions, CSRF, throttling and role checks. |
| `bulk-tagging.test.ts` | Mass tagging, and tagging at import time. |
| `campaigns.test.ts` | Campaigns (P7, first slice). |
| `contact-graph.test.ts` | Contact-graph gates (P6, `docs/08-antiban.md`). |
| `contacts.test.ts` | Creating a contact over HTTP (POST /contacts). |
| `conversation-patch.test.ts` | Conversation assignment, status and list filters (F3, chunk 1). |
| `conversation-read.test.ts` | Single-conversation fetch and mark-read (F3). |
| `cors-and-export.test.ts` | Browser access from an allowlisted origin (CORS), and the contact export (CSV + vCard): |
| `decrypt-failures.test.ts` | The decrypt-failure signal (Layer 5, docs/08-antiban.md): |
| `do-not-contact.test.ts` | Do-not-contact is enforced on every path that can message someone, and only an admin — signed in, with a reason, audited — can knowingly lift it, per message or per campaign. |
| `entropy.test.ts` | Background entropy (P6 Layer 3, docs/08-antiban.md): |
| `gateway-tenancy.test.ts` | The gateway runs inside the owning org's tenant (D-41). |
| `gateway-work.test.ts` | The gateway handlers against the fake channel: sending, holds, retries, typing, number fallback. |
| `health.test.ts` | Sender health scoring (P6, `docs/08-antiban.md`): |
| `imports.test.ts` | Importing a file of contacts (P5, first slice). |
| `inbound-messages.test.ts` | Storing inbound messages, deduplication and receipts. |
| `inline-audience.test.ts` | An audience built inline while creating a campaign (the old standalone Segments screen, folded in). |
| `key-rotation.test.ts` | Key rotation (D-31): a second key version, re-encryption onto it, and the wizard's API. |
| `lid-linking.test.ts` | A person messaging from a WhatsApp privacy address (`…@lid`) arrives with no number. |
| `media.test.ts` | Media, end to end: an attachment arriving, being stored, and being served. |
| `message-authorship.test.ts` | Message authorship (D-53, first slice). |
| `notes-canned.test.ts` | Internal notes and saved replies (F3 chunk 2). |
| `outbound-media.test.ts` | Outbound media (D-25): |
| `pacing.test.ts` | The anti-ban gate (P6 layers 1 and 2, `docs/08-antiban.md`). |
| `participants.test.ts` | Owner + participants (D-53). |
| `policy-gates.test.ts` | The recipient-experience gates (engagement lock, cooldown, duplicate-campaign) an admin may lift per campaign, and advisory mode (D-29). |
| `presence.test.ts` | Presence (D-17): "who has this thread open right now". |
| `read-receipts.test.ts` | Read behaviour (P6 Layer 3, docs/08-antiban.md): |
| `recipient-timezone.test.ts` | Recipient-timezone inference (P6 Layer 3, docs/08-antiban.md): |
| `restriction.test.ts` | Silent-restriction tracking (docs/27-restriction-tracking.md): |
| `rls-request-path.test.ts` | Row-level security on the request path. |
| `schema-check.test.ts` | The schema check against a migrated database. |
| `security-check.test.ts` | The row-level-security measurement. |
| `segments.test.ts` | Dynamic segments (D-28) — the saved criteria-based audience. |
| `status-and-fields.test.ts` | Two small things that make the system explain itself: |
| `table-notes.test.ts` | The schema visualizer (`npm run db:docs`) explains every table from `TABLE_NOTES`. |
| `tags.test.ts` | Tags and tagging (GET/POST /tags, POST/DELETE /contacts/:id/tags, and the tag filter on the contacts list). |
| `thread-lock.test.ts` | The thread lock (F3, admin-override variant). |
| `typing-collision.test.ts` | Typing and the collision warning (D-54). |

## `tests/live/`

Headed walkthrough against a real linked number (never in CI).

| File | What it is |
|---|---|
| `cursor.ts` | A visible mouse pointer for recordings. |
| `full-flow.live.ts` | Numbers come from `.env`, never the repo: |
| `naukri-sample.ts` | Builds a synthetic Naukri-style workbook (fiction-range numbers) for the live walkthrough. |

## `tests/load/`

Reserved for load tests.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |

## `tests/simulation/`

The anti-ban simulation: days of traffic against a virtual WhatsApp that bans on the documented heuristics.

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an otherwise empty folder in git. |
| `scenarios.sim.ts` | The scenarios from docs/12-testing.md, run against the real engine and a simulated WhatsApp that bans when it is misbehaved with. |
| `sim-clock.ts` | A clock the whole engine can be run against, so days of behaviour take seconds. |
| `whatsapp-sim.ts` | A virtual WhatsApp that bans you if you misbehave (docs/12-testing.md, "The simulation harness"). |
| `world.ts` | The world the engine is run in: |

## `tools/`

Developer tooling (the Insomnia API collection).

| File | What it is |
|---|---|
| `insomnia-collection.json` | An importable Insomnia/Postman collection exercising the API, including the refusals that must stay refused. |

## Regenerating this file

The per-file column is produced by a small script that reads each tracked file's header comment (`git ls-files`,
first block or line comment, first sentence). Folder descriptions are a hand-kept table in that script. If a file
shows `—`, the fix is to add a header comment to the file, not to edit this page.
