# 18 · Pluggable providers

Every external resource sits behind a port with swappable drivers, chosen by config.

**The rule: every port ships a free, self-hostable driver as the default, and at least one
managed/paid driver. No paid service is ever required to run the product.**

The prior system half-learned this: `DATABASE_URL` was reworked so one compose file targets
either the bundled Postgres or a managed one. Right instinct; this generalises it.

## The matrix

> **What is actually implemented**, since this table describes the intent: `kms/local`,
> `auth/builtin`, `storage/filesystem` and `storage/s3` (any S3-compatible bucket: AWS S3, Cloudflare R2,
> Backblaze B2, MinIO; `STORAGE_DRIVER=s3` or `minio`, default still `filesystem`; D-63), and `storage` is now wired end to end: the gateway
> writes attachments through it and the API serves them back. Every other port below is an
> empty directory — the
> interface is not written, let alone a driver. `storage` and `channels` are the two with a
> **contract suite**: one set of tests written against the port and run against each driver, so
> swapping the backend is a tested claim rather than a hope.

| Resource | Port | Free / self-hosted (default) | Managed / paid |
|---|---|---|---|
| **Object storage** | `StorageDriver` | **filesystem** (`lean`), **MinIO** (bundled) | AWS S3, Cloudflare R2, Backblaze B2, DO Spaces, Wasabi, GCS — any S3-compatible endpoint |
| **Auth / identity** | `AuthProvider` | **built-in** (Argon2id, TOTP); self-hosted OIDC: Keycloak, Zitadel, Authentik, Ory Kratos | Auth0, Clerk, WorkOS, Okta, Entra ID, Google Workspace — generic OIDC/OAuth2, SAML for enterprise |
| **Database** | connection string | **bundled Postgres 16** | Aiven, RDS/Aurora, Neon, Supabase, Cloud SQL, Railway, Render |
| **Queue** | `QueueDriver` | **pg-boss** (Postgres, no extra service); **BullMQ + Redis/Valkey** bundled for `standard`+ | Upstash, ElastiCache, Redis Cloud, DragonflyDB |
| **Cache / locks** | `CacheDriver` | **in-process** (`lean`, single-instance only); **Redis** | same as above |
| **Transactional email** | `EmailDriver` | **SMTP** (any server); MailHog in dev | Resend, SES, SendGrid, Postmark, Mailgun, Brevo |
| **SMS** (optional) | `SmsDriver` | **none** — feature off | Twilio, MSG91, Gupshup, Plivo, Vonage (India: DLT registration first) |
| **WhatsApp** | `ChannelProvider` | **Baileys** (free, unofficial) | Meta Cloud API direct; or a BSP — Gupshup, AiSensy, 360dialog, Twilio |
| **LLM** (optional) | `LlmDriver` (`packages/providers/llm`) | **none**; or **any OpenAI-format endpoint**: Gemini, Groq, OpenAI, OpenRouter, Ollama, vLLM (`gemini`/`openai`/`ollama`/`compatible`); or native **Anthropic**. Built and tested on Gemini and Groq (2026-10-21) | Bedrock, Vertex (not built) |
| **Telemetry** | OTLP exporter | **none** (stdout + `/metrics`); Prometheus, Grafana, Loki, Tempo as an opt-in profile | Grafana Cloud, Datadog, New Relic, Honeycomb, Axiom, Signoz |
| **Error tracking** | `ErrorReporter` | **stdout**; GlitchTip (Sentry-compatible) | Sentry, Bugsnag, Rollbar |
| **Secrets** | `SecretsDriver` | **`.env` file**; Infisical or OpenBao self-hosted | AWS Secrets Manager, Doppler, 1Password Connect, GCP Secret Manager |
| **Encryption KEK** | `KmsDriver` | **local KEK** from env/file | AWS KMS, GCP KMS, Azure Key Vault, OpenBao transit |
| **Reverse proxy** | — | **Caddy** (bundled, auto-TLS) | Cloudflare, nginx + certbot, Traefik, a cloud LB |
| **Antivirus** (optional) | `ScannerDriver` | **none**; ClamAV as an opt-in profile | VirusTotal, cloud scanning APIs |

## Configuration

```bash
PRESET=lean                   # | standard | scale — expands to a full driver set
                              #   anything below overrides the preset

STORAGE_DRIVER=filesystem     # | minio | s3 | r2 | b2 | gcs
QUEUE_DRIVER=pgboss           # | bullmq        (bullmq requires REDIS_URL)
AUTH_DRIVER=builtin           # | oidc | saml
EMAIL_DRIVER=smtp             # | resend | ses | sendgrid | postmark
TELEMETRY_DRIVER=none         # | prometheus | otlp
LLM_DRIVER=none               # | gemini | openai | anthropic | ollama | compatible (OpenRouter, Groq, vLLM: needs LLM_BASE_URL)
LLM_MODEL=                    # required once the driver is not none, e.g. openai/gpt-oss-20b (Groq) or gemini-3.1-flash-lite
LLM_API_KEY=                  # required except for ollama
LLM_BASE_URL=                 # unset = the provider's own address; required for compatible, e.g. https://api.groq.com/openai/v1
LLM_TIMEOUT_MS=20000          # one answer; 90000 is safer on a slow or free plan
SMS_DRIVER=none               # | twilio | msg91 | gupshup
SCANNER_DRIVER=none           # | clamav
KMS_DRIVER=local              # | aws-kms | gcp-kms | openbao
```

`config/preset.yml` is the file-based equivalent and takes the same keys.

Driver-specific settings are validated by that driver's own Zod schema, so selecting a driver
without its credentials is a **boot-time crash with a readable message**, not a runtime surprise.

## Rules that keep this honest

- **A driver is one file implementing one interface.** Adding Backblaze B2 is a ~60-line file
  plus a config schema — no change to any calling code.
- **One contract suite per port**, run against every driver. Swapping drivers provably changes
  no behaviour ([`12-testing.md`](12-testing.md)).
- **The free path is the tested path.** CI runs the full E2E suite on the all-free `lean` stack,
  because that is what most self-hosters will actually run. Paid drivers are tested against
  official local emulators where one exists (LocalStack for S3/KMS/SES, Keycloak for OIDC) and
  have a documented manual smoke test where none does.
- **`GET /admin/providers`** shows the active driver, health and last error per port — so an
  operator sees that email is misconfigured *before* a password reset silently fails.
- **Optional features degrade, they never break.** `LLM_DRIVER=none` hides F12;
  `SMS_DRIVER=none` hides SMS OTP. Missing *optional* infrastructure is never a startup failure;
  missing *required* infrastructure always is.
- **Authorisation is never delegated.** An external IdP authenticates; roles and scopes stay
  local, so the permission model is identical regardless of who signs the user in.
- **Email is optional, and every flow that uses it has a path that does not.** A deployment may
  have no `EMAIL_DRIVER` configured at all — so password reset is administrator-initiated
  first and self-service second, and an invitation can be handed over out of band rather than
  only by link. Making email mandatory would mean a customer with no working mail setup could
  not recover an account, which is a worse failure than not having the convenience.

  Worth knowing when this comes up: a self-hosted customer rarely needs a domain **of their
  own** for this. Google Workspace, Microsoft 365 and Zoho all expose SMTP, and their domains
  already carry SPF and DKIM — pointing `EMAIL_DRIVER=smtp` at the customer's existing mail
  provider sends as them, authenticated, with no DNS work. Owning the domain matters for
  *bulk* sending reputation, not for a handful of transactional messages.

## Cost and lock-in

Each driver's entry records its cost model, its migration path, and a **"can I leave?"** note.
Two design choices make leaving cheap:

- **Storage keys are provider-neutral paths**, so migrating buckets is a copy, not a rewrite.
- **Auth maps every provider onto one internal user/claims shape**, so switching IdP does not
  touch authorisation code.

## Writing a new driver

1. Implement the port in `packages/providers/<port>/<driver>/`.
2. Export a `configSchema` (Zod) — the admin UI and `.env.example` are generated from it.
3. Register it in the driver registry.
4. Pass the port's contract suite. No core change is permitted; if one is needed, the port is
   wrong and should be fixed instead.

### Setting the model from the app: the AI settings tab (2026-10-22)

`/ai/settings` (the second tab inside the AI tab) lets an admin choose the provider (Groq, Gemini, OpenAI, Anthropic, OpenRouter, Ollama on this machine, or any OpenAI-compatible
address), enter the key, pick a model from the provider's own list (or type one), **test** it with two tiny real calls, and **Use this**. That writes the five `LLM_*` lines to the
settings file (`LLM_ENV_FILE`: `.env` in a source checkout, `state/llm.env` in the container), after a dated backup (the newest three are kept, mode 0600), touching no other line.
The API and the gateway hold a `LiveLlm` (`packages/providers/llm/src/live.ts`) that checks the file's size and modified time before each model call and rebuilds the driver when it
changed, so **a change applies from the next call, with no restart**. If the file has a `LLM_DRIVER` line its five settings are used as a set; otherwise the process's own environment
from boot applies. A half-set file leaves the AI off with a warning in the log instead of crashing.

The key is never returned (an admin sees the last four characters), never logged, and not in the audit entry. A custom address must be `https` and public (checked, including what the name
resolves to, so the page cannot be used to probe the server's network); Ollama may use `localhost`. The test allows 400 tokens per call because "reasoning" models (for example
`gpt-oss-20b`) spend part of the limit thinking before they answer: a 20-token limit made that working model look broken, which the first real run caught.

### Choosing a language model (measured 2026-10-21 with `npm run llm:check`)

The same two checks (a one-line answer, and a `create_campaign` tool call carrying the right tag id) on the same day:

| Model | Per call | Tool calls | Note |
|---|---|---|---|
| Groq `openai/gpt-oss-20b` | 0.5 to 0.9 s | correct every run | what the app was switched to; Groq's account also lists `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` |
| Gemini `gemini-3.1-flash-lite` | 8 to 30 s (once 2 s) | correct every run | free tier; one `503 overloaded`; `gemini-3.5-flash-lite` answered in 1 s in a single try |
| Gemini `gemini-3.6-flash` | about 18 s | not measured | dearer; its price doubles on 2027-01-01 |

A model that answers text but cannot call tools shows as **NO TOOLS** in the script and cannot drive the assistant's campaign and messaging features.
Models misreport themselves: asked its name, `gpt-oss-20b` said it was "ChatGPT, GPT-4". Do not rely on a model to say which model it is.
