# Documentation

**Just want to run it? → [27 · Getting started](27-getting-started.md)** takes a fresh clone to a
working, signed-in instance.

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

**To deploy or operate it** — [13 Deployment](13-deployment.md) →
[19 Capacity](19-capacity.md) → [14 Runbooks](14-runbooks.md) →
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
| [27 Getting started](27-getting-started.md) | Fresh clone → running, signed-in instance, in nine steps |
| [Capacity calculator](capacity-calculator.html) | Interactive — toggle the stack, size the server |

## Not in here

[`../CONTEXT.md`](../CONTEXT.md) is the running log — one entry per working session, appended
never edited, recording what was decided and why. If you want to know *how the project got
here* rather than *what it is now*, read that.
