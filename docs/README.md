# Documentation

**Just want to run it? → [Getting started](../GETTING_STARTED.md)** (at the repo root) takes a
fresh clone to a working, signed-in instance.

**New here? Start with [20 · Orientation](20-orientation.md).** It explains the project, the
technology and every piece of jargon from zero — no knowledge of TypeScript, Node, Postgres or
WhatsApp's API assumed. It also decodes the `M`, `P`, `F` and `FR` codes used throughout.

## Reading order

**To understand the product** — [01 Vision & scope](01-vision-scope.md) →
[00 Prior art](00-prior-art.md) (the mistakes being avoided) →
[03 Competitive analysis](03-competitive-analysis.md)

**To write code** — [20 Orientation](20-orientation.md) →
[04 Architecture](04-architecture.md) → [05 Data model](05-data-model.md) →
[11 Conventions](11-conventions.md) → [12 Testing](12-testing.md)

**To load contacts in** — [07 Ingestion](07-ingestion.md) (the design) →
[25 Ingestion guide](25-ingestion-guide.md) (the sources, deduping and a walkthrough)

**To understand linking** — [26 Linking lifecycle](26-linking-lifecycle.md) (how the gateway,
the database and the phone stay in sync, and why "connected" is not "receiving")

**To understand anti-ban and restrictions** — [08 Anti-ban](08-antiban.md) →
[27 Silent-restriction tracking](27-restriction-tracking.md) → [12 Testing](12-testing.md) (the simulation)

**To deploy or operate it** — [13 Deployment](13-deployment.md) →
[19 Capacity](19-capacity.md) → [14 Runbooks](14-runbooks.md) →
[28 Logging and telemetry](28-logging-and-telemetry.md) →
[09 Security](09-security.md) → [22 Encryption](22-encryption.md) →
[23 Authentication](23-auth.md)

## Everything

| | |
|---|---|
| [00 Prior art](00-prior-art.md) | 30+ defects from the previous system, each turned into a rule |
| [01 Vision & scope](01-vision-scope.md) | What this is, who it is for, explicit non-goals |
| [02 Requirements](02-requirements.md) | Numbered functional and non-functional requirements |
| [03 Competitive analysis](03-competitive-analysis.md) | 12 competitors — table stakes and real gaps |
| [04 Architecture](04-architecture.md) | How the pieces fit; ports and adapters; the single send path |
| [05 Data model](05-data-model.md) | Every table, **every column explained** |
| [06 Features](06-features/) | One file per module, F1–F12, with acceptance criteria and test cases |
| [07 Ingestion](07-ingestion.md) | Getting data in from spreadsheets, sheets, APIs |
| [08 Anti-ban](08-antiban.md) | The engine that keeps numbers alive, and the research behind every number in it |
| [09 Security](09-security.md) | Threat model, encryption, compliance |
| [10 Stack](10-stack.md) | Every technology choice, and the alternative that lost |
| [11 Conventions](11-conventions.md) | How code is written here, including the comment rule |
| [12 Testing](12-testing.md) | The test pyramid and the WhatsApp ban simulator |
| [13 Deployment](13-deployment.md) | Presets, profiles, upgrades, backup and restore |
| [14 Runbooks](14-runbooks.md) | One entry per alert: symptom, diagnosis, fix |
| [15 API](15-api.md) | The public HTTP API |
| [16 Job portal integration](16-integration-jobportal.md) | The nine seams, mapped to endpoints |
| [17 Roadmap](17-roadmap.md) | Build phases P0–P12 and what each must deliver |
| [18 Providers](18-providers.md) | Swappable drivers — free self-hosted or managed/paid |
| [19 Capacity](19-capacity.md) | What it costs to run; sizing tiers |
| [20 Orientation](20-orientation.md) | **Start here.** Everything explained from zero |
| [21 Deferred decisions](21-deferred.md) | What we deliberately have not decided, and what brings each back |
| [22 Encryption](22-encryption.md) | How data is encrypted before it reaches the database and decrypted on the way back; keys, rotation, DEK/KEK, and what survives losing a key |
| [23 Authentication](23-auth.md) | The three credentials, the login flow, session forwarding, CSRF, and what guards what |
| [24 Testing it by hand](24-local-testing.md) | Start the stack, get a key, exercise every endpoint, read the headers that matter |
| [25 Ingestion guide](25-ingestion-guide.md) | Every source, how deduping works at both layers, and a hands-on walkthrough |
| [26 Linking lifecycle](26-linking-lifecycle.md) | How the gateway, database and phone stay in sync on link status; the command channel; why "connected" ≠ "receiving" (D-14) |
| [27 Silent-restriction tracking](27-restriction-tracking.md) | How a number WhatsApp has quietly limited is detected from delivery evidence, what the system does about it, and the operator runbook |
| [28 Logging and telemetry](28-logging-and-telemetry.md) | What the system logs and where it goes, how to read it, the request id, health endpoints, the database state that doubles as a record, troubleshooting recipes, and what is not built (D-56) |
| [29 Free hosting plan](29-free-hosting-plan.md) | Running this for about 10 users and 10 numbers for free: what each cloud and free service really gives, why most mix-and-match combinations fail for this system, the home-hosted plan, telemetry on a free budget, Oracle (last), and the decisions needed |
| [30 Running behind a Cloudflare Tunnel](30-cloudflare-tunnel.md) | The common failures of web apps behind Cloudflare (524, upload caps, Next.js server-action origin checks, redirect loops, Bot Fight Mode, client IP), what was researched and measured, what the repo does about each, and a dashboard checklist |
| [32 Setup, signup, teams and billing](32-onboarding-and-billing.md) | A plan, not built: setup and signup as two doors into one function, the invite-only beta journey, admin-created teammates, what other products and CRMs do and charge, a starting price list, billing and limits design, and a phased roadmap (after the alpha test) |
| [33 Payment providers](33-payment-providers.md) | Razorpay, Cashfree, PayU, Stripe, Paddle, Lemon Squeezy, Polar, Dodo Payments and manual invoicing compared on fees, UPI, subscriptions, the org-admin experience, developer experience and ease of building, with a recommendation and sources to verify |
| [34 Licensing and enforcement](34-licensing-and-drm.md) | Research for D-55: why open-source and public source-available licences do not fit, how similar products tie payment to use (unchecked, from memory), the proprietary-licence-plus-signed-key approach, and the open questions |
| [35 The database, its optimisations and queries](35-database-and-queries.md) | The 32 tables by group, how tenancy works, the optimisations that exist, the main queries as written in the code, and the known gaps. The complete column-by-column reference is generated: [generated/database-reference.md](generated/database-reference.md) |
| [36 Workflows](36-workflows.md) | Seven diagrams: AI templates, a campaign with a picture or GIF, messaging a group (the tag rule), an AI reply, importing, the shared search rule, and the send pipeline |
| [37 The session audit](37-session-audit-findings.md) | The first timed, recorded walk over every screen: findings and bottlenecks |
| [38 The audit on a production build](38-session-audit-production-build.md) | The same walk on a production build: timings, bugs found, what shipped |
| [39 From a bug report to a merged fix](39-bug-workflow.md) | The flow with a diagram, labels, the 8-line guide for a new chat |
| [40 Testing and bug handling: the guide for Kushal and Mikhil](40-testing-and-bug-guide.md) | **Start here** for tests, bugs, CI and reporting |
| [Plan: the bug-to-merge pipeline](plans/2026-10-22-bug-workflow-plan.md) | The agreed plan behind docs 39 and 40, with what was built and what changed |
| [41 Overnight automation run](41-overnight-automation-run-2026-10-22.md) | What the unattended night run was allowed to do, how to revert it, and what it did |
| [31 Codebase map](31-codebase-map.md) | Every directory and file in the repository and what it is for, built from each file's own header comment; the first place to look when you do not know where something lives |
| [User tutorial (PDF)](CRM-user-tutorial.pdf) | A walkthrough of the whole platform with screenshots, for the people who use it every day: signing in, linking a number, importing, contacts, the inbox, campaigns, the team, the AI assistant, the safety rules and troubleshooting. Rebuild with `npm run tutorial:shots -- <folder>` then `npm run tutorial:pdf -- <folder>` |
| [Getting started](../GETTING_STARTED.md) | (Repo root) fresh clone → running, signed-in instance, in nine steps |
| [Capacity calculator](capacity-calculator.html) | Interactive — toggle the stack, size the server |

## Not in here

The old `CONTEXT.md` session log has been deleted (2026-10-06). For *how the project got here*, read
[`../CHANGELOG.md`](../CHANGELOG.md) and the git history; for *where it stands now*, [`../HANDOFF.md`](../HANDOFF.md).
