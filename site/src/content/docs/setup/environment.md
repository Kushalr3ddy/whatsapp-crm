---
title: Settings (environment variables)
description: The settings you may want to change, what each one does, and which ones must never be lost.
---

With Docker you need **no settings file at all**: the first start generates its own secrets. Create `infra/compose/.env` (copy `alpha.env.example`) only to override something. If you set a secret yourself it must match the one the install was created with, or the container refuses to start, because a different key would make stored data unreadable.

## Secrets: never lose these

| Setting | What it is |
|---|---|
| `ENCRYPTION_KEY` | Encrypts message text and the WhatsApp login of every number. **Losing it means losing every linked number and every stored message.** |
| `ENCRYPTION_INDEX_KEY` | A second, different key that makes encrypted values searchable. Must differ from the first |
| `APP_SECRET` | Signs sign-in sessions and tokens |
| `API_KEY` | The deployment-level bootstrap key. It can only create an organisation and its first API key; it is refused on every data route |

Create each with `openssl rand -hex 32`. Store them somewhere **other than** the database backup.

## Common settings

| Setting | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:3001` | The address people use to reach the app |
| `SEND_TIMEZONE` | `Asia/Kolkata` | The number's own time zone, for human-like daily pacing. It is **not** the server's |
| `ADMIN_EMAIL`, `ORG_NAME`, `ORG_SLUG` | `admin@example.com` and defaults | Used once, to create the first organisation and admin |
| `SEND_RATE_PER_MINUTE` | 8 | The fastest a number may send (maximum 20) |
| `SEND_RATE_PER_DAY` | 1500 | The daily ceiling after warm-up |
| `SEND_CIRCADIAN` | true | Slow down early morning and late evening, like a person |
| `SEND_TYPING_SIMULATION` | true | Show "typing…" for a moment before each message |
| `API_HOST_PORT`, `WEB_HOST_PORT`, `POSTGRES_HOST_PORT` | 3000, 3001, 5434 | Change them if a port is taken |
| `STORAGE_DRIVER` | `filesystem` | Where files are kept (local disk by default; S3-compatible storage is supported) |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

:::note
Lowering the sending limits is always safe. The warm-up ceiling for a new number cannot be raised with a setting; that is deliberate. See [Warm-up and sending pace](../../concepts/warm-up/).
:::

## AI model settings

The AI model, key and address are chosen in the app, on the **AI settings** tab. See [Choose the AI model](../ai-model/).
