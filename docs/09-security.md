# 09 · Security & privacy

## Threat model (STRIDE)

Assets: message content, contact identifiers, WhatsApp session credentials, API keys,
encryption keys. The session credentials are the crown jewels — they *are* the WhatsApp number.

| | Threat | Mitigation |
|---|---|---|
| **S**poofing | Forged provider webhooks | HMAC over raw bytes, constant-time compare, no bypass path, replay window |
| | Stolen API key | Hashed at rest, scoped, rotatable, per-key rate limit, last-used tracking, anomaly alert |
| **T**ampering | Modified messages in transit | TLS everywhere; provider message ids recorded |
| | SQL injection | Parameterised queries only; no dynamic identifiers (M14) |
| **R**epudiation | "I didn't send that" | Audit log with a non-null actor on every state change (M-audit) |
| **I**nfo disclosure | Cross-tenant read | RLS on every table, asserted per table by tests; 404 not 403 on foreign ids |
| | Schema/structure leak | No introspection endpoints (M15) |
| | Bulk exfiltration via export | Rate-limited, audited, alerted above a threshold |
| | Secrets in logs | Field allowlist redaction; `gitleaks` in CI |
| **D**enial of service | Queue flooding | Per-org concurrency limits, rate limits, DLQ |
| | Poison message crash loop | Quarantine after N attempts (M26) |
| **E**levation | Missing object-level authz | One central authorisation layer; authz matrix test over every role × endpoint |

### The five that matter most

1. **Tenant isolation escape.** RLS plus a test suite asserting cross-org denial on every
   endpoint. A forgotten `WHERE org_id` must be a denied read, not a leak.
2. **Session credential theft.** `channel_auth_state` is encrypted with a per-org DEK; leaking
   the database without the KEK does not hand over the WhatsApp numbers.
3. **Webhook forgery.** Signature verification over **raw bytes** — verifying over a
   re-serialised JSON object silently fails, a subtlety the old system got right and worth
   keeping right.
4. **Prompt injection** (future F12). Inbound messages are attacker-controlled text. Defence is
   structural — content passed as data in a typed field, never concatenated into instructions —
   not prose in a prompt.
5. **Mass export.** Report and contact exports are the easiest bulk-exfiltration path. Rate
   limited, audited, and alerted above a volume threshold.

## Setting the tenant: use `set_config`, never `SET LOCAL`

Every row-level security policy reads `current_setting('app.org_id')`, so the application must
set it at the start of each transaction. There is exactly one correct way to do that:

```sql
SELECT set_config('app.org_id', $1, true)   -- correct: binds safely, transaction-scoped
SET LOCAL app.org_id = $1                   -- SYNTAX ERROR: SET cannot take a parameter
```

This is not a style preference. `SET` does not accept bind parameters, so the only way to use
it is to interpolate the value into the statement — which would make the one setting that
decides *which tenant's data you can see* an injection point. `set_config` is an ordinary
function call and parameterises like any other; its third argument scopes it to the
transaction, exactly like `LOCAL`.

Use the `setTenant()` helper in `@crm/db` rather than writing either by hand.

**Both are transaction-scoped, and that catches people out.** `set_config(..., true)` and
`SET LOCAL` last only for the current transaction, so pasting them into psql one statement at a
time does nothing — the setting is gone by the next statement, `SET LOCAL ROLE` merely warns
*"can only be used in transaction blocks"*, and you get the superuser answer while believing
you tested the application role. To see isolation for yourself, run the whole thing as one unit:

```bash
npm run db:psql -- -f infra/scripts/rls-demo.sql
```

It writes a row as one org, reads it as another, and asserts all four cases — including that
RLS blocks **writes** as well as reads. Everything rolls back.

## Verifying isolation actually works, at startup

Three different things defeat row-level security, and they are easy to confuse: being a
**superuser**, holding **BYPASSRLS**, or **owning the table** (owners bypass unless the table is
set `FORCE`). In all three cases `pg_tables.rowsecurity` still reports `true` — **the policies
look enabled while enforcing nothing.**

So `inspectDatabaseSecurity()` runs at startup and *measures* rather than infers: inside a
transaction it writes a row under one org, switches the session to a different org, and tries to
read it back. Seeing the row means isolation is not in effect. The transaction always rolls back.

It warns rather than refuses to start, because a single-tenant deployment and local development
are both legitimately fine without isolation. The warning names the role and includes the SQL to
create a proper one.

## Authentication & authorisation

- **Built-in driver**: Argon2id (not bcrypt — M16), login rate limiting with progressive
  lockout, TOTP MFA (V2), password reset via single-use expiring tokens, session invalidation
  on password change, CSRF tokens on cookie-authenticated routes.
- **External IdP** (`AUTH_DRIVER=oidc|saml`): no password stored at all. **Authorisation stays
  local** — external claims map onto internal roles, so the permission model is identical
  regardless of who authenticates.
- **API keys** for machine access: hashed, scoped, rotatable, never session cookies.
- **One central authorisation layer.** Object-level checks on every read. The old system let
  any recruiter edit any job description because the check simply was not written
  (`routes/jobs.js:128`) — a matrix test now covers every role against every endpoint.

## Data protection

### Encryption at rest
Envelope encryption, fixing the old single-key-with-no-rotation design (M24):

```
KEK   (KmsDriver: local | aws-kms | gcp-kms | openbao)
 └─ wraps a per-org DEK  →  org_encryption_key(org_id, key_version, wrapped_dek)
      └─ encrypts  message.body_enc
                   contact_identity.value_enc
                   channel_auth_state.value_enc
                   user.mfa_secret_enc
```

Every ciphertext column carries a `key_version`. Rotation is an online batch job. The `*_hmac`
blind-index key is separate and **not** rotated — rotating it would invalidate every lookup
index, which is a different operation entirely and is documented as such.

### In transit
TLS everywhere, HSTS, modern cipher suites. Internal service traffic stays on the Docker
network or is TLS'd when split across hosts.

### Minimisation & retention
Configurable per data class: raw inbound events 30 d, audit log 1 y, media 1 y, messages
indefinite by default. A nightly hard-delete job enforces it and writes a summary audit row.

### Logs
PII redacted by **field allowlist** — an allowlist, not a denylist, so a new field is redacted
by default rather than leaked by default.

## Application security

- **Input validation**: Zod on every input, including webhook payloads.
- **SQL**: parameterised only; identifier allowlists where dynamic shape is unavoidable (M14).
- **Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options via helmet.
- **CORS**: explicit origin allowlist (M18).
- **SSRF**: every user-supplied URL — outbound webhook endpoints, REST ingestion sources — is
  guarded. Private ranges, link-local and cloud metadata endpoints denied; redirects re-checked
  at each hop.
- **Uploads**: magic-byte validation (not extension), size caps, served from a separate origin,
  optional AV scan when `SCANNER_DRIVER` is set.
- **Spreadsheet formula injection**: exports prefix `= + - @`; imported values are never evaluated.
- **Rate limiting**: per IP, per user, per API key, per org.

## Secrets

- Never in code, images or logs.
- Config is schema-validated at boot; a missing required secret is a **hard crash** with a
  readable message, never a silent random fallback (M17).
- `gitleaks` plus a PII-pattern scan in CI (M19 — the old repo committed a real-looking
  candidate record with name, mobile, DOB, address and salary).
- Documented rotation procedure per secret class.

## Supply chain

Lockfile committed · `npm audit` and Renovate/Dependabot · CycloneDX SBOM per release ·
base images pinned by digest · non-root container user · read-only root filesystem · dropped
capabilities · Trivy image scan in CI.

## Compliance

### India — DPDP Act
The operator is the Data Fiduciary; this software provides the tooling.

| Requirement | How the product supports it |
|---|---|
| Affirmative, unambiguous consent | `consent_record` per purpose, with source, evidence, IP, timestamp |
| Separate consent per purpose | `purpose` enum: `marketing` / `transactional` / `otp` — never one blanket flag |
| Withdrawal as easy as granting | Opt-out keywords honoured automatically and irreversibly (F9) |
| Timestamped, auditable records | Immutable `consent_record` + audit log |
| Erasure on request | DSAR erasure endpoint |
| Breach notification | Audit trail and alerting support it; the process is the operator's |

### GDPR (if operating in the EU)
Lawful basis recorded per contact · DSAR export and erasure · data minimisation ·
processor obligations documented · retention enforced in code, not policy.

### Meta's Business Messaging Policy
Documented opt-in before messaging · obvious opt-out · template categories used honestly ·
no sending to purchased lists. The product cannot enforce the operator's honesty, but it
records what was sent, to whom, under what consent, so an audit is possible.

**Stated plainly in the docs and the UI:** compliance is the operator's responsibility.
The software makes it possible, not automatic.

## Testing

Continuous: Semgrep, `npm audit`, gitleaks, Trivy, PII scan — every PR.
Per release: ZAP baseline, cross-tenant IDOR sweep over every endpoint, SSRF suite over every
URL input, authz matrix.
Annually: external penetration test, once there is something worth testing.

## Disclosure

`SECURITY.md` carries the contact address and a 90-day coordinated disclosure window.
