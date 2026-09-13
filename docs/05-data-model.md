# 05 · Data model

PostgreSQL 16. Drizzle ORM with versioned SQL migrations (drizzle-kit). No DDL at runtime (M5).

## Conventions

- `snake_case` everywhere; plural never used for table names.
- **UUID v7** primary keys — time-sortable, so they cluster well and double as a creation order.
- `created_at` / `updated_at` `timestamptz`, **UTC** (M25).
- **`org_id uuid NOT NULL` on every tenant table**, with RLS enabled:
  `USING (org_id = current_setting('app.org_id')::uuid)`. The app sets it per transaction via
  `SET LOCAL`. Single-tenant just means one `org` row — the isolation path is identical and
  therefore actually exercised.
- Soft delete (`deleted_at`) only where recovery genuinely matters: contacts, conversations,
  templates. Everything else hard-deletes.
- `jsonb` for user-defined data, with GIN indexes. Never for data the system itself queries on.
- Money as integer **micros** plus a currency code.
- Encrypted columns are `_enc bytea`, always paired with `_hmac text` (keyed blind index) so
  lookup and dedup never require decrypting a table (M25's performance lesson).

## Map

```
org ─┬─ user ── org_membership            identity & tenancy
     ├─ api_key, audit_log
     │
     ├─ contact ─┬─ contact_identity       people (generic, no domain)
     │           ├─ contact_tag ── tag
     │           ├─ contact_note
     │           ├─ consent_record
     │           └─ contact_pipeline_entry ── stage_event
     │
     ├─ pipeline ── pipeline_stage         user-defined funnels
     ├─ contact_field_def                  user-defined fields
     ├─ segment
     │
     ├─ sender_identity ─── channel_session   channels
     │
     ├─ conversation ─┬─ message              conversations
     │                ├─ conversation_participant
     │                └─ internal_note
     │
     ├─ message_template ── template_variant   content
     ├─ canned_reply, media_asset
     │
     ├─ campaign ─┬─ campaign_recipient        outreach
     │            └─ campaign_metric
     ├─ sequence ─┬─ sequence_step
     │            └─ sequence_enrollment
     ├─ automation_rule, scheduled_message
     │
     ├─ data_source ─┬─ field_mapping          ingestion
     │               └─ import_run ── import_row
     │
     └─ webhook_endpoint ── webhook_delivery   ops
        inbound_event_raw, send_risk_event, rate_limit_state,
        org_setting, feature_flag
```

## Identity & tenancy

| Table | Key columns | Notes |
|---|---|---|
| `org` | `id`, `name`, `slug`, `created_at` | One row in single-tenant mode |
| `user` | `id`, `email` (citext, unique), `password_hash?`, `display_name`, `avatar_url`, `status`, `mfa_secret_enc?`, `last_login_at` | `password_hash` null when an external IdP authenticates (`AUTH_DRIVER=oidc`) |
| `org_membership` | `org_id`, `user_id`, `role`, `scopes[]`, `invited_by`, `joined_at` | Roles attach to memberships, not users — so one user can belong to several orgs later |
| `api_key` | `id`, `org_id`, `name`, `key_hash`, `prefix`, `scopes[]`, `rate_limit_per_min`, `last_used_at`, `expires_at`, `revoked_at` | Only the hash is stored; `prefix` is for display |
| `audit_log` | `id`, `org_id`, `actor_type`(user/system/api/agent), `actor_id`, `action`, `target_type`, `target_id`, `before jsonb`, `after jsonb`, `ip`, `request_id`, `at` | Append-only. Partitioned monthly once volume warrants. |

There is **one reserved `system` actor row** so every automated action has a non-null actor
(NFR-17). Nothing may write `actor_id = NULL`.

## Contacts

### `contact`
`id`, `org_id`, `display_name`, `primary_identity_id?`, `owner_user_id?`, `lifecycle_stage?`,
`custom_fields jsonb`, `source`, `external_ref jsonb` (`{system, id}`), `do_not_contact bool`,
`dnc_reason?`, `dnc_at?`, `last_inbound_at?`, `last_outbound_at?`, `engagement_score?`,
`created_at`, `updated_at`, `deleted_at?`.

- `external_ref` is what lets a host app stay the system of record. GIN-indexed.
- `custom_fields` holds everything domain-specific. **There is no `candidate` table and never
  will be** — that is the difference between this and `00-prior-art.md`'s system.

### `contact_identity` — the fix for M7/M8
`id`, `org_id`, `contact_id`, `kind` (`phone` | `email` | `wa_jid` | `wa_lid` | `telegram` |
`external`), `value_enc bytea`, `value_hmac text`, `value_normalized text`, `is_primary bool`,
`verified_at?`.

- **Unique on `(org_id, kind, value_normalized)`** — the database, not application code,
  guarantees one identity maps to one contact.
- `value_normalized` is E.164 for phones (generated at write via `libphonenumber-js`),
  lowercased for email. Empty values are rejected by a `CHECK`, so the empty-string match
  bug (M7) is structurally impossible.
- Inbound resolution is always `identity → contact`, never a scan of `contact`.
- A contact having *many* identities is what makes `@lid` privacy ids (M26) a non-event: the
  `wa_lid` is just another identity row pointing at the same person.

### Supporting
| Table | Purpose |
|---|---|
| `contact_field_def` | User-defined field schema: `key`, `label`, `type`, `options jsonb`, `required`, **`merge_policy`** (`overwrite`/`fill_if_empty`/`never`/`append`) — M9's fix, declared per field |
| `tag` / `contact_tag` | `tag(name, colour)`; join table |
| `segment` | Saved filter: `name`, `definition jsonb`, `kind` (`static`/`dynamic`), `cached_count`, `cached_at` |
| `contact_note` | Freeform notes with author and timestamp |
| `consent_record` | `contact_id`, `purpose` (`marketing`/`transactional`/`otp`), `status` (`granted`/`revoked`), `source`, `evidence jsonb`, `ip`, `granted_at`, `revoked_at` — DPDP requires purpose separation and proof (CON-5) |

## Pipelines — generic by construction

`pipeline` (`name`, `is_default`) and `pipeline_stage` (`pipeline_id`, `key`, `label`,
`sequence`, `colour`, `is_terminal`). **`sequence` increments by 10** so a stage can be
inserted between two others without renumbering.

`contact_pipeline_entry` (`contact_id`, `pipeline_id`, `current_stage_id`, `entered_at`) and
`stage_event` (append-only: `entry_id`, `from_stage_id?`, `to_stage_id`, `actor_id`, `reason?`,
`at`).

`current_stage_id` is an **explicitly documented cache**; `stage_event` is the truth. This
replaces the old system's `CHECK` constraint duplicated in five files (M23) — stages are now
rows a user can edit, which is what makes the product generic.

## Channels

### `sender_identity` — the unit the anti-ban engine protects
`id`, `org_id`, `provider` (`baileys`/`meta`/…), `label`, `phone_e164`, `owner_user_id?`,
`status` (`linking`/`active`/`degraded`/`quarantined`/`retired`), `capabilities_snapshot jsonb`,
`health jsonb`, `warmup_started_at?`, `last_inbound_at?`, `risk_score int`,
`daily_cap_override?`, `meta_waba_id?`, `meta_phone_number_id?`, `meta_quality_rating?`,
`meta_messaging_tier?`.

Note this is *not* called "session". A sender identity is the number and its reputation; a
session is one connection to it. Conflating them is why the old system's caps counted the
wrong thing (M11) and why re-linking a number broke sends (`resolveLiveSendSession`).

### `channel_session` — Baileys runtime
`id`, `sender_identity_id`, `connection_state`, `last_connected_at?`, `disconnect_reason?`,
`disconnect_code?`, `reconnect_attempts`, `qr_expires_at?`.

### `channel_auth_state` — the M29/M30 fix
`sender_identity_id`, `key` (Baileys' key namespace), `value_enc bytea`, `updated_at`,
primary key `(sender_identity_id, key)`.

Baileys' own `useMultiFileAuthState` carries an explicit **"DO NOT USE IN PROD"** warning, and
writing auth state to local disk loses every number on an ephemeral filesystem. One row per
key means the gateway is restartable, sessions auto-restore on boot, and a database restore
brings the numbers back with it.

## Conversations & messages

### `conversation`
`id`, `org_id`, `contact_id`, `sender_identity_id`, `channel`, `status`
(`open`/`pending`/`snoozed`/`closed`), `assignee_user_id?`, `last_inbound_at?`,
`last_outbound_at?`, **`window_expires_at?`**, `unread_count`, `priority`, `sla_due_at?`,
`snoozed_until?`, `closed_at?`, `closed_by?`.

`window_expires_at` is the Meta 24-hour service clock, maintained on every inbound. The
dispatcher reads it to decide template vs freeform. Conversation being a first-class scope is
M31's fix — history is always fetched per conversation, never per contact.

### `message`
`id`, `org_id`, `conversation_id`, `direction`, **`provider_message_id`**, `content_type`,
`body_enc bytea`, `body_hmac text`, `media_id?`, `template_id?`, `template_variables jsonb?`,
`status` (`queued`/`sent`/`delivered`/`read`/`failed`), `error_code?`, `error_detail?`,
`cost_micros`, `currency`, `campaign_id?`, `sequence_step_id?`, `sent_by`
(`user`/`system`/`agent`/`api`), `sent_by_id?`, `created_at`, `sent_at?`, `delivered_at?`,
`read_at?`.

- **`UNIQUE (org_id, provider_message_id)` is the idempotency key** — Meta's `wamid` or
  Baileys' key id. Webhook retries (CON-4) become no-ops at the database level, which is the
  only place that guarantee survives a race.
- `body_hmac` lets dedup and search happen without decrypting rows — the old system decrypted
  every recent row to compare bodies (M25).
- Indexes: `(conversation_id, created_at DESC)` for thread paging, partial on `status` for the
  retry sweeper, `(campaign_id)` for reporting.

`conversation_participant`, `internal_note` (with `mentions uuid[]`), `canned_reply`,
`media_asset` (`storage_key`, `content_type`, `size_bytes`, `sha256`, `scanned_at?`) round it out.

## Templates & campaigns

| Table | Key columns |
|---|---|
| `message_template` | `key`, `version`, `locale`, `category` (`marketing`/`utility`/`auth`/`service`), `channel_intent`, `body`, `variables jsonb` (typed), `provider_meta jsonb`, `meta_template_name?`, `meta_approval_status?`, `is_active` |
| `template_variant` | `template_id`, `label`, `weight`, `body` — A/B |
| `campaign` | `name`, `status` (`draft`/`scheduled`/`running`/`paused`/`completed`/`cancelled`), `segment_id?`, `explicit_contact_ids?`, `template_id`, `sender_pool jsonb`, `scheduled_at?`, `throttle_profile jsonb`, `quiet_hours jsonb`, `timezone`, `created_by`, `estimated_cost_micros`, `actual_cost_micros` |
| `campaign_recipient` | `campaign_id`, `contact_id`, `status` (`pending`/`queued`/`sent`/`delivered`/`read`/`replied`/`failed`/`skipped`), **`skip_reason?`**, `message_id?`, `attempted_at?` |
| `campaign_metric` | Rollups, refreshed incrementally |

`skip_reason` exists because blocked recipients must be **reported, never silently dropped**
(FR-45). `provider_meta jsonb` is where carousels, buttons and Flows land without a migration.

## Automation

`sequence` · `sequence_step` (`delay_minutes`, `condition jsonb`, `template_id`, `exit_on jsonb`)
· `sequence_enrollment` (`contact_id`, `current_step`, `status`, `next_run_at`) ·
`automation_rule` (`trigger jsonb`, `conditions jsonb`, `actions jsonb`, `enabled`, `priority`)
· `scheduled_message`.

Reply classification rules live in `automation_rule` with locale packs, and every match records
**which rule fired** so "classified confidently" is distinguishable from "defaulted" (M32).

## Ingestion

| Table | Key columns |
|---|---|
| `data_source` | `type`, `name`, `config jsonb`, `credentials_ref`, `schedule_cron?`, `enabled`, `last_run_at?`, `cursor?` |
| `field_mapping` | `source_id?`, `name`, `version`, `mapping jsonb`, `identity_rules jsonb`, `is_preset` |
| `import_run` | `source_id?`, `mapping_id`, `status`, `mode` (`dry_run`/`commit`), `counts jsonb`, `started_at`, `finished_at?`, `actor_id`, `file_ref?` |
| `import_row` | `import_run_id`, `row_number`, `raw jsonb`, `status` (`imported`/`updated`/`skipped`/`failed`), `error jsonb?`, `contact_id?` |

`import_row` is the entire answer to M4: every row's outcome is queryable, a failed run is
downloadable as a corrections file, and `UNIQUE (import_run_id, row_number)` makes a killed
worker resumable rather than restartable.

## Ops

`webhook_endpoint` · `webhook_delivery` (attempts, response, `next_retry_at`) ·
`inbound_event_raw` (signature-verified raw payload, retained N days, replayable — NFR-8) ·
`send_risk_event` (`sender_identity_id`, `kind`, `weight`, `detail jsonb`, `at` — every
ban-relevant signal, so the health dashboard is evidence rather than a number) ·
`rate_limit_state` · `org_setting` (branding, quiet hours, caps, locale, currency, retention) ·
`feature_flag`.

## Encryption

Envelope encryption, fixing M24's unrecoverable single key:

```
KEK (KmsDriver: local | aws-kms | gcp-kms | openbao)
  └─ wraps DEK per org, stored in org_encryption_key(org_id, key_version, wrapped_dek, created_at)
       └─ encrypts message.body_enc, contact_identity.value_enc, channel_auth_state.value_enc
```

Every ciphertext column is paired with a `key_version`. Rotation is an online job: new DEK,
re-encrypt in batches, retire the old version. `*_hmac` columns use a separate long-lived
index key that is **not** rotated, because rotating it would invalidate every lookup index.

## Indexing notes

Beyond the obvious FKs: `pg_trgm` on `contact.display_name` and decrypted-search surfaces ·
GIN on `contact.custom_fields` and `contact.external_ref` · partial index on
`conversation (status, assignee_user_id) WHERE status IN ('open','pending')` for the inbox ·
partial on `campaign_recipient (campaign_id) WHERE status = 'pending'` for the sender ·
BRIN on `audit_log.at` and `message.created_at` once partitioned.

## Retention

Configurable per org: raw inbound events (default 30 d), audit log (default 1 y),
media (default 1 y), messages (default indefinite). A nightly job hard-deletes past the
window, writing a summary audit row. DSAR erasure is a separate, immediate path.
