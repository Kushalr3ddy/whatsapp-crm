# Security policy

## Reporting a vulnerability

Please do not open a public issue. Email the maintainer with:

- a description and impact assessment
- reproduction steps
- affected version or commit

Expect acknowledgement within 72 hours. Coordinated disclosure window: **90 days**.

## Scope

In scope: the application, its API, its providers, its deployment configuration.

Out of scope: WhatsApp itself, Meta's platform, and third-party services behind provider
drivers — report those to their owners.

## A note on the unofficial transport

This project can drive WhatsApp through Baileys, an unofficial reverse-engineered client.
That is a deliberate, documented product decision with documented risk
(`docs/08-antiban.md`) — it is not a vulnerability report. Reports about ToS compliance
belong in a discussion, not a security advisory.

## Hardening

See [`docs/09-security.md`](docs/09-security.md) for the threat model and controls, and
[`docs/13-deployment.md`](docs/13-deployment.md) for secure deployment.
