# 05 · Data model

PostgreSQL 16. Drizzle ORM with versioned SQL migrations (drizzle-kit). No DDL at runtime (M5).

Every table below carries a column-by-column explanation. Where a column exists to prevent a
specific past failure, the defect id (`M*`) points at [`00-prior-art.md`](00-prior-art.md).

**Status legend** — ✅ built and migrated · 🔜 next phase · ⬜ planned, see
[`17-roadmap.md`](17-roadmap.md) for which phase.

## Conventions

- `snake_case` everywhere; table names are singular.
- **UUID** primary keys. (UUIDv7 was the intent for time-sortability, but Postgres 16 has no
  native `uuidv7()` — that arrives in PG18 — so `gen_random_uuid()` is used for now.)
- `created_at` / `updated_at` are `timestamptz`, always **UTC** (M25).
- **`org_id uuid NOT NULL` on every tenant table**, with RLS enabled:
  `USING (org_id = current_setting('app.org_id')::uuid)`. The app sets it per transaction via
  `SET LOCAL`. Single-tenant just means one `org` row — the isolation path is identical and
  therefore actually exercised.
- Soft delete (`deleted_at`) only where recovery genuinely matters: contacts, conversations,
  templates. Everything else hard-deletes.
- `jsonb` for user-defined data, GIN-indexed. Never for data the system itself filters on.
- Money as integer **micros** plus a currency code. Never floats.
- Encrypted columns are `_enc bytea`, always paired with `_hmac text` (a keyed blind index) so
  lookup and dedup never require decrypting a whole table.

## Map

**Every name below is a table.** Indentation shows what belongs to what; a `──` links two
tables that always travel together. Each is explained column by column further down.

```
org ─┬─ user ── org_membership          who can log in, and their role in this org
     ├─ api_key, audit_log              machine access · a record of every change
     │
     ├─ contact ─┬─ contact_identity     a person · one phone/email/whatsapp-id of theirs
     │           ├─ contact_tag ── tag   which labels they have · the labels themselves
     │           ├─ contact_note         private notes your team writes, never sent
     │           ├─ consent_record       proof they agreed to be messaged, per purpose
     │           └─ contact_pipeline_entry ── stage_event
     │             where they are in a funnel  ·  the history of how they got there
     │
     ├─ pipeline ── pipeline_stage       a funnel you define · its ordered stages
     ├─ contact_field_def                the custom fields YOU invent for contacts
     ├─ segment                          a saved audience ("everyone in Pune who replied")
     │
     ├─ sender_identity ─┬─ channel_session
     │      one of your WhatsApp numbers  ·  one live connection to it
     │                      └─ whatsapp_notice   every limit warning WhatsApp sent the number
     ├─ antiban_setting                  the org's sending settings (quiet hours, STOP words, closing message)
     │
     ├─ conversation ─┬─ message                 a thread with someone · one message in it
     │                ├─ conversation_participant who is watching the thread
     │                └─ internal_note            team-only comment inside a thread
     │
     ├─ message_template ── template_variant   reusable message · an A/B version of it
     ├─ canned_reply, media_asset              quick replies · files sent or received
     │
     ├─ campaign ─┬─ campaign_recipient   a bulk send · one person in it, and their outcome
     │            └─ campaign_metric      rolled-up numbers for reporting
     ├─ sequence ─┬─ sequence_step        a drip series · one message in the series
     │            └─ sequence_enrollment  who is currently working through it
     ├─ automation_rule, scheduled_message   if-this-then-that · a message queued for later
     │
     ├─ data_source ─┬─ field_mapping     where data comes from · how its columns map to ours
     │               └─ import_run ── import_row
     │                  one import       ·  one row of it, and whether it worked
     │
     └─ webhook_endpoint ── webhook_delivery   where we notify · each attempt to notify
        inbound_event_raw      every raw provider payload, kept so it can be replayed
        rate_limit_state       send budgets, shared across processes
        org_setting            branding, locale, currency, retention (quiet hours live in antiban_setting)
        feature_flag           turn features on per tenant
```

---

# Identity & tenancy

## `org` ✅

A tenant. Single-tenant deployments have exactly one row.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | The tenant's identity. Referenced by `org_id` on every other table and by the RLS policies. |
| `name` | text | Human-readable organisation name. Shown in the UI; safe to change at any time. |
| `slug` | text UNIQUE | URL-safe short name, for subdomains and API paths. Unique because it is addressable. |
| `created_at` | timestamptz | When the tenant was provisioned. |
| `updated_at` | timestamptz | Last modification, for cache invalidation and debugging. |

## `app_user` ✅

Someone who signs in. Deliberately **not** tenant-scoped — one person may belong to several
orgs, and authentication has to find them before any org context exists.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | The person's identity across every org they belong to. |
| `email` | text UNIQUE | Login identifier and contact address. Unique globally, not per org. |
| `password_hash` | text NULL | Argon2id hash. **Null when an external identity provider authenticates them** — with `AUTH_DRIVER=oidc` no password ever exists here. |
| `display_name` | text | What other agents see in the inbox: assignment, @mentions, audit entries. |
| `status` | text | `active` / `disabled`. Disabling keeps history intact instead of deleting the row and orphaning every audit reference. |
| `last_login_at` | timestamptz NULL | Supports "dormant account" alerts and answers "was this account in use when it was abused?". |
| `created_at` / `updated_at` | timestamptz | Standard audit timestamps. |

## `org_membership` ✅

Binds a user to an org **with a role**. The role lives here rather than on the user so the
same person can be an admin in one org and an agent in another, with no schema change.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | Row identity. |
| `org_id` | uuid FK → org | Which tenant this membership grants access to. |
| `user_id` | uuid FK → app_user | Which person. Cascade-deletes with the user. |
| `role` | text | `admin` / `agent` today. Drives the central authorisation layer; never checked ad-hoc per route. |
| `joined_at` | timestamptz | When access was granted. Part of the access-review trail. |
| — | UNIQUE (org_id, user_id) | One membership per person per org, enforced by the database rather than by a check-then-insert race. |

## `api_key` ✅

Machine access. Sessions are for the first-party UI only; integrations always use a key.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | Row identity. |
| `org_id` | uuid FK | The tenant this key acts as. A key can never reach another org's data. |
| `name` | text | Human label — "job portal", "zapier". So a key can be revoked without guessing what it was for. |
| `key_hash` | text | Hash of the secret. **The secret itself is shown once at creation and never stored**, so a database leak does not hand over working credentials. |
| `prefix` | text | First few characters (`crm_live_a1b2…`), stored in clear purely so the UI can show which key is which. |
| `scopes` | text[] | `contacts:read`, `messages:send`, … Least privilege: a key that only reads contacts cannot send a message. |
| `rate_limit_per_min` | int | Per-key throttle, so one runaway integration cannot starve the others. |
| `last_used_at` | timestamptz NULL | Identifies dormant keys worth revoking, and helps date a compromise. |
| `expires_at` | timestamptz NULL | Optional automatic expiry for temporary integrations. |
| `revoked_at` | timestamptz NULL | Soft revocation — the row stays so audit entries referencing it still resolve. |

## `session` ✅

A signed-in browser session. Added with the authentication work; it had no entry here before.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | Row identity. |
| `user_id` | uuid FK → app_user | Who is signed in. Cascade-deletes with the person. |
| `org_id` | uuid FK → org | Which tenant this session acts in, chosen at login — a person may belong to several. |
| `token_hash` | text UNIQUE | SHA-256 of the token. The token itself is never stored, so a database leak grants no session. A fast hash is correct here: the input is 32 random bytes, so there is nothing to brute-force and Argon2 on every request would be a self-inflicted bottleneck. |
| `expires_at` | timestamptz | Absolute expiry, regardless of activity. |
| `last_seen_at` | timestamptz | Drives the idle timeout, and answers "was this session in use when it was abused?". |
| `ip` / `user_agent` | text NULL | Recorded for the audit trail, **never** for authorisation — both are trivially spoofed. |
| `revoked_at` | timestamptz NULL | Set by logout, and by every password change. |

**Not row-level-security protected**, the same deliberate exception `app_user` takes: resolving
a session is what *establishes* which org a request acts in, so a policy reading
`current_setting('app.org_id')` could never match.

## `audit_log` ✅

Append-only record of every state change. **No row may have a null actor** — that is what
makes "who did this?" always answerable (NFR-17).

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | Row identity. |
| `org_id` | uuid FK | Tenant scope. |
| `actor_type` | text | `user` / `system` / `api` / `agent`. Distinguishes a person from an automation without two nullable columns. |
| `actor_id` | uuid | Who or what did it. A reserved `system` actor row exists precisely so automated changes still have a non-null actor. |
| `action` | text | `contact.merged`, `campaign.launched`, `sender.removed`. Verb-shaped and stable enough to filter on. |
| `target_type` / `target_id` | text / uuid | What was acted on. Not a foreign key, because the target may later be deleted and the audit entry must survive. |
| `before` / `after` | jsonb NULL | State either side of the change. Answers "what actually changed?" rather than just "something changed". |
| `ip` | inet NULL | Source address where one applies. Absent for system actions. |
| `request_id` | text | Correlates the audit row with the log lines from the same request. |
| `at` | timestamptz | When. BRIN-indexed once the table is partitioned by month. A `CHECK` refuses a future timestamp — always a bug, and a trail that accepts them cannot be trusted to order events. |

**Append-only is enforced, not described:** migration 0008 revokes `UPDATE` and `DELETE` from
`crm_app`, so a compromised application cannot rewrite history to cover its tracks. The
retention job needs `DELETE` and therefore runs as a different role. What this does *not* cover
is anyone holding the database directly — see D-13.

**Reads are audited from the point media landed**, which was D-13's trigger. Two actions
exist: `conversation.read` when a thread is opened and `media.downloaded` when a file is
fetched. Listing the inbox is deliberately **not** recorded — a paginated load is not a
meaningful access event, and a log that records one buries the events that are. Exports, when
they exist, join this list.

---

# Contacts

## `contact` ✅

A person the org talks to. **Deliberately carries no domain fields** — no candidate, no
customer, no patient. That absence is what stops this becoming an ATS.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | The person's identity within this org. |
| `org_id` | uuid FK | Tenant scope. RLS-enforced. |
| `display_name` | text NULL | What to call them. Nullable because an inbound message can arrive from a number with no name attached — a contact exists before you know who it is. |
| `owner_user_id` | uuid FK NULL | The agent who "owns" this relationship, if any. `SET NULL` on user deletion so contacts survive staff leaving. |
| `custom_fields` | jsonb | **Everything business-specific.** Job title, order number, policy id — whatever this deployment cares about. Shaped by `contact_field_def`, GIN-indexed for filtering. This column is why the schema stays generic. |
| `external_ref` | jsonb NULL | `{system, id}` pointing at whoever owns this person as a domain object — e.g. the job portal's candidate id. GIN-indexed, and the first identity-resolution rule during import. |
| `source` | text NULL | Where they came from: `import`, `inbound_message`, `api`, `webhook`. Useful for both attribution and debugging a bad import. |
| `do_not_contact` | bool | **Gate zero on every send path.** Overridable by nobody, including an admin — it protects a phone number's reputation as much as a legal position. |
| `dnc_reason` | text NULL | Why: `replied_stop`, `manual`, `complaint`. Distinguishes a customer's choice from an operator's decision. |
| `dnc_at` | timestamptz NULL | When they opted out. Consent withdrawal has to be provable, not just applied. |
| `last_inbound_at` | timestamptz NULL | Last message **from** them. Shown in the inbox. |
| `last_outbound_at` | timestamptz NULL | Last message **to** them. Drives the cooldown gate — "have we contacted this person too recently?". |
| `created_at` / `updated_at` | timestamptz | Standard audit timestamps. |
| `deleted_at` | timestamptz NULL | Soft delete. Conversations and messages reference contacts, so a hard delete would orphan history. |

## `contact_identity` ✅

**The most important table in the schema.** One way of reaching a contact. A contact has many;
inbound resolution always goes identity → contact, never a scan of `contact`.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK | Row identity. |
| `org_id` | uuid FK | Tenant scope. |
| `contact_id` | uuid FK | Which person this identity belongs to. Cascade-deletes with them. |
| `kind` | text | `phone` / `email` / `wa_jid` / `wa_lid` / `telegram` / `external`. CHECK-constrained, because a typo'd kind would create a silent second namespace nothing ever matches against. |
| `value_normalized` | text | **The canonical form** — E.164 for phones, lowercased for email. This is what matching compares. A `CHECK (btrim(...) <> '')` makes a blank value unstorable, which is the M7 fix: the old dedup passed `''` for missing values, so every blank-email contact matched every other one and silently merged unrelated people. |
| `is_primary` | bool | Which identity to prefer when several exist for one kind. |
| `verified_at` | timestamptz NULL | When ownership was confirmed (an inbound message, a clicked link). Unverified identities are weaker evidence for merging. |
| `created_at` | timestamptz | When first seen. |
| — | UNIQUE (org_id, kind, value_normalized) | **The database guarantees one identity maps to one person.** Also why `@lid` WhatsApp privacy ids are a non-event: a `wa_lid` is just another row pointing at the same contact, rather than the crash-loop it caused before (M26). |

## `contact_field_def` ⬜

The user-defined field schema. Turns "add a column" into "add a row", and generates the UI.

| Column | Type | What it is |
|---|---|---|
| `id` | uuid PK / `org_id` | Row identity and tenant scope. |
| `key` | text | The key inside `contact.custom_fields`. Stable; renaming the label never breaks stored data. |
| `label` | text | What the user sees on the form. |
| `type` | text | `text` / `number` / `date` / `select` / `multiselect` / `bool`. Drives both the input widget and the import validator. |
| `options` | jsonb NULL | Allowed values for select types. |
| `required` | bool | Whether a contact can be saved without it. |
| **`merge_policy`** | text | `overwrite` / `fill_if_empty` / `never` / `append`. **The M9 fix.** The old importer overwrote every mapped field unconditionally, so re-importing a sparser file silently destroyed richer data. Default is `fill_if_empty`. |

## `tag` / `contact_tag` ✅

| Table | Columns | What it is |
|---|---|---|
| `tag` | `id`, `org_id`, `name`, `colour`, `created_at` | A label. Deliberately flat — no hierarchy, no nesting. `name` is unique per org. |
| `contact_tag` | `org_id`, `contact_id`, `tag_id`, `created_at` | The join. Composite PK `(contact_id, tag_id)` so re-tagging is a no-op. Carries `org_id` — every tenant table does, so RLS scopes it directly rather than through a join to `tag`. |

## `contact_note` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `contact_id` | uuid | Row identity, tenant, subject. |
| `body` | text | Freeform note. **Never sent to the contact** — a test asserts notes cannot reach a provider. |
| `author_user_id` | uuid FK | Who wrote it. |
| `created_at` | timestamptz | When. |

## `consent_record` ⬜ (optional, operator-driven)

An **optional** record of permission the operator can keep for whatever their own jurisdiction
requires — the product bakes in no specific regime (see `09-security.md`, compliance is the
operator's). Immutable rows; a withdrawal writes a new row. `do_not_contact` on `contact` is the
built, jurisdiction-neutral gate that actually blocks sends; this table is the paper trail behind
it when an operator chooses to keep one.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `contact_id` | uuid | Row identity, tenant, subject. |
| `purpose` | text | An **operator-defined** purpose label (e.g. `marketing`, `transactional`) rather than a fixed enum — separate purposes so agreeing to one is not agreeing to all. |
| `status` | text | `granted` / `revoked`. |
| `source` | text | Where consent came from: `web_form`, `import`, `inbound_message`, `verbal`. |
| `evidence` | jsonb | The proof itself — form snapshot, message id, the exact wording shown. What makes an audit survivable. |
| `ip` | inet NULL | Source address at the moment of granting. |
| `granted_at` / `revoked_at` | timestamptz | The timeline. Rows are immutable; a withdrawal writes a new row rather than editing the old one. |

## `segment` ✅ (minimal slice)

> **Built differently from the spec below:** a `definition` jsonb holding an allowlisted AND-only filter (has-tag, replied ever/never, last-contacted-within-N-days), evaluated on read — no `kind`, no cached count. See D-28.

A saved audience. What a campaign targets.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `name` | — | Row identity, tenant, label. |
| `kind` | text | `static` (a fixed list) or `dynamic` (a filter re-evaluated on read). |
| `definition` | jsonb | The filter itself for dynamic segments; the contact id list for static ones. |
| `cached_count` | int | Last known size, so the UI can show a number without re-running the query. |
| `cached_at` | timestamptz | When that count was computed, so the UI can say how stale it is. |

---

# Pipelines — generic by construction

This group replaces the old system's hardcoded funnel, where the stage list was a `CHECK`
constraint duplicated across five files (M23). Here stages are **rows a user can edit**, which
is what lets one product serve recruitment, sales and support without a fork.

## `pipeline` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `name` | — | Row identity, tenant, label. |
| `is_default` | bool | Which pipeline a new contact enters when none is specified. |

## `pipeline_stage` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `pipeline_id` | uuid | Row identity and parent. |
| `key` | text | Stable machine name, so automation rules keep working when the label is reworded. |
| `label` | text | What the user sees. |
| `sequence` | int | Order. **Incremented by 10** (10, 20, 30…) so a stage can be inserted between two others without renumbering every row. |
| `colour` | text | UI only. |
| `is_terminal` | bool | Whether reaching this stage ends the journey (`won`, `lost`). Terminal stages stop sequences and exclude the contact from re-entry. |

## `contact_pipeline_entry` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `contact_id`, `pipeline_id` | uuid | Row identity, tenant, who, which funnel. |
| `current_stage_id` | uuid FK | **An explicitly documented cache.** `stage_event` is the truth. Kept because "show me everyone at stage X" should not require aggregating an event log on every page load. |
| `entered_at` | timestamptz | When they joined this pipeline. |

## `stage_event` ⬜

Append-only. **This is the source of truth for where someone is**, and how they got there.

| Column | Type | What it is |
|---|---|---|
| `id`, `entry_id` | uuid | Row identity and parent. |
| `from_stage_id` | uuid NULL | Previous stage. Null for the first entry. |
| `to_stage_id` | uuid FK | New stage. |
| `actor_id` | uuid | Who moved them — a person, or the reserved system actor. Never null. |
| `reason` | text NULL | Free text, for moves that need explaining. |
| `at` | timestamptz | When. The whole history is reconstructable from these rows. |

---

# Channels

## `sender_identity` ✅

**The unit the anti-ban engine protects.** Note it is not called "session": a sender identity
is the number and its accumulated reputation; a session is one connection to it. The old
system conflated the two, which is why its caps counted the wrong thing (M11) and why
re-linking a number silently broke sending.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id` | uuid | Row identity, tenant. |
| `provider` | text | `baileys` / `meta` / `fake`. Which adapter drives this sender. |
| `label` | text | Human name — "Priya's number", "main WABA". |
| `phone_e164` | text | The number itself, canonical form. |
| `owner_user_id` | uuid FK NULL | Which agent it belongs to. Admins can reassign; the change is audited. |
| `status` | text | The lifecycle: `linking` / `active` / `retired` (a dead number kept for history) / `removed` (hidden from the Numbers page). Whether it is connected right now is `channel_session.connection_state`. |
| `capabilities_snapshot` | jsonb | What this provider could do when last checked — template requirements, window length, media support. The dispatcher reads it to refuse illegal sends *before* calling the provider. |
| `meta_waba_id` / `meta_phone_number_id` | text NULL | Meta Cloud API identifiers, for official senders only. |
| `meta_quality_rating` | text NULL | `high` / `medium` / `low` from Meta. Marketing sends **hard-stop at low**. |
| `meta_messaging_tier` | text NULL | 250 / 1k / 10k / 100k / unlimited. The dispatcher will not exceed the known tier. |

## `channel_session` ✅

One connection to a sender. Runtime state, not reputation.

| Column | Type | What it is |
|---|---|---|
| `id`, `sender_identity_id` | uuid | Row identity and parent. |
| `connection_state` | text | `connecting` / `open` / `closed`. |
| `last_connected_at` | timestamptz NULL | For the "down more than 5 minutes" alert. |
| `disconnect_reason` | text NULL | Why the socket last closed (`unlinked`, a typed classification). `disconnect_code` and `reconnect_attempts` were dropped in 0039 with the first anti-ban engine. |
| `decrypt_burst_at` | timestamptz NULL | When the gateway last saw 3 `Bad MAC` frames inside a minute — a diverged session (migration 0018). The composer warns for 15 min, then lets it lapse. |
| `qr_expires_at` | timestamptz NULL | When the current linking QR goes stale. |
| `timelock_active`, `timelock_until`, `timelock_type` | bool / timestamptz NULL / text NULL | WhatsApp's new-chat timelock (`reachoutTimeLock`) as last reported; `timelock_type` is e.g. `WEB_COMPANION_ONLY` (0040). While active, new chats are held. |
| `capping_status`, `capping_total_quota`, `capping_used_quota`, `capping_cycle_start`, `capping_cycle_end`, `capping_updated_at` | text / int / timestamptz NULL | WhatsApp's new-chat cap as last reported: `NONE` / `FIRST_WARNING` / `SECOND_WARNING` / `CAPPED`, the quota and the cycle (0040). The ETA and the new-chat hold read them. |
| `linked_since` | timestamptz NULL | First open after the last link (0040). Drives the "new number" hint, and is what ends a `decrypt_wave` hold. |
| `many_undelivered_at`, `many_undelivered_resumed_at` | timestamptz NULL | When too many sends stayed at one tick and the number's campaigns were held; when an agent last resumed (0041). Only newer sends count after a resume. |
| `decrypt_wave_at` | timestamptz NULL | When retries from 3 or more contacts inside 10 minutes held the whole number (0041). The hold ends when `linked_since` is later than this. |

## `whatsapp_notice` ✅

Every limit warning WhatsApp sent a number, as it arrived (0040). Evidence for tuning the thresholds in `packages/core/src/antiban/constants.ts`; the latest of each kind is also on `channel_session`. RLS forced.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `sender_identity_id` | uuid | Row identity, tenant, which number. |
| `kind` | text | `timelock` or `capping`. |
| `payload` | jsonb | The raw notice. |
| `received_at` | timestamptz | When it arrived. Index `whatsapp_notice_sender_idx (sender_identity_id, received_at)`. |

## `antiban_setting` ✅

One row per org (0040, extended in 0041): how that org's numbers send. RLS forced. Read and written by `GET/PUT /antiban/settings`. No row means every default.

| Column | Type | What it is |
|---|---|---|
| `org_id` | uuid PK | The org. |
| `quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end`, `time_zone` | bool / text | Campaign and AI first messages wait out these hours. Defaults on, `22:00` to `08:00`, `Asia/Kolkata`. |
| `closing_message_enabled` | bool | Whether one closing message is sent when someone opts out (default on). The opt-out itself happens either way. |
| `contact_phone`, `contact_email`, `default_purpose` | text NULL | Quoted in the closing message. A line is left out when its value is not set. |
| `stop_words`, `restart_words` | text[] | The org's own words, added to the built-in `stop`, `unsubscribe`, `opt out` and `start`. |
| `recent_days` | int | What "messaged recently" means on a new campaign, in days. 14 unless changed (0043). Read by the New campaign review and set with `PUT /antiban/settings`. |
| `updated_at` | timestamptz | Last change. |

## `channel_auth_state` ✅

Baileys' credentials, one row per key. **The reason sessions survive a restart.**

| Column | Type | What it is |
|---|---|---|
| `sender_identity_id` + `key` | composite PK | Baileys' own key namespace, stored as rows rather than files. |
| `value_enc` | bytea | The encrypted credential material. |
| `updated_at` | timestamptz | Last write. |

Why a table and not the filesystem: Baileys' own `useMultiFileAuthState` carries an explicit
*"DO NOT USE IN PROD"* warning, disk state is lost on any ephemeral filesystem (M30), and
sessions had to be reconnected by hand after every restart (M29). Keeping it here means a
**database restore brings the WhatsApp numbers back with it**.

---

# Conversations

## `conversation` ✅

A thread with one contact on one sender. **Conversation is always the scope** — message
history is fetched per conversation, never per contact. The old system's `listMessages()`
returned every message a contact had ever sent, mixing contexts when the same person was
worked for two campaigns at once (M31).

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `contact_id` | uuid | Row identity, tenant, who. |
| `sender_identity_id` | uuid FK | Which of our numbers this thread runs on. The same contact on two numbers is two threads. |
| `channel` | text | `whatsapp` / `sms` / `email`. Denormalised from the sender for cheap filtering. |
| `status` | text | `open` / `pending` / `snoozed` / `closed`. `pending` means waiting on the contact; `snoozed` means waiting on time. |
| `assignee_user_id` | uuid FK NULL | Which agent owns it. Null means unassigned — the shared queue. |
| `last_inbound_at` | timestamptz NULL | Last message from them. |
| `last_outbound_at` | timestamptz NULL | Last message to them. |
| **`window_expires_at`** | timestamptz NULL | **Meta's 24-hour service window.** Recomputed on every inbound. After it passes only approved templates are legal, so the dispatcher reads it to decide template-vs-freeform, and the composer switches mode. Null for Baileys, which has no window. |
| `unread_count` | int | Badge count. Denormalised because counting unread messages on every inbox render does not scale. |
| `priority` | int | Manual bump for threads that need attention. |
| `sla_due_at` | timestamptz NULL | When a response becomes late. Drives the breach report. |
| `snoozed_until` | timestamptz NULL | When a snoozed thread reopens. |
| `closed_at` / `closed_by` | timestamptz / uuid NULL | Resolution trail. |
| `refused_463_at` | timestamptz NULL | When WhatsApp refused a send to this contact with a 463 (0040). New sends to them are held (`refused_463`) until a person lifts it. |
| `likely_blocked_at` | timestamptz NULL | The contact probably blocked this number: a message sat at one tick and their profile photo and about, both visible before, were gone (0041). Campaigns and the AI stop; an agent can send by hand. A message from them clears it. Per number, because the row is per number. |
| `decrypt_retry_at` | timestamptz NULL | The contact's phone asked for a message again ("Waiting for this message") and no later delivered or read receipt, or message from them, has cleared it (0041). Holds every new send to them. |
| `profile_snapshot`, `profile_probe_at` | jsonb / timestamptz NULL | Whether the contact's profile photo and about were visible when a message to them was last delivered, and when they were last looked up (at most once per 24 h) (0041). |

## `message` ✅

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `conversation_id` | uuid | Row identity, tenant, thread. |
| `direction` | text | `inbound` / `outbound`. |
| **`provider_message_id`** | text | Meta's `wamid` or Baileys' key id. **`UNIQUE (org_id, provider_message_id)` is the idempotency key** — Meta retries webhooks for up to 7 days, and this makes a duplicate delivery a no-op at the database level, which is the only place that guarantee survives a race. |
| `content_type` | text | `text` / `image` / `document` / `audio` / `template` / `interactive`. |
| `body_enc` | bytea | The message text, encrypted at rest. |
| `body_hmac` | text | Keyed hash of the body. Lets dedup and search work **without decrypting** — the old system decrypted every recent row just to compare bodies, which cannot use an index (M25). |
| `media_id` | uuid FK NULL | Attachment, if any. |
| `template_id` | uuid FK NULL | Which template version produced this, so reports stay truthful after a template is edited. |
| `template_variables` | jsonb NULL | The values substituted in. Reproduces exactly what was sent. |
| `status` | text | `queued` / `sent` / `delivered` / `read` / `failed`. |
| `error_code` / `error_detail` | text NULL | Why a send failed, typed so the retry policy can branch on it — transient, permanent, or poison. |
| `cost_micros` / `currency` | int / text | What this message cost. Meta charges per template message; Baileys costs nothing. Sums into the cost report. |
| `campaign_id` | uuid FK NULL | Which campaign sent it, if any. |
| `sequence_step_id` | uuid FK NULL | Which drip step sent it, if any. |
| `sent_by` | text | `user` / `system` / `agent` / `api`. Distinguishes a human reply from an automation from the AI agent — present from day one so agent messages are separable in every report later. |
| `sent_by_id` | uuid NULL | Which specific user or key. |
| `created_at` / `sent_at` / `delivered_at` / `read_at` | timestamptz | The delivery timeline. The gaps between them are the funnel. |
| `hold_reason`, `hold_until` | text / timestamptz NULL | Why a still-queued message waits and when that is expected to end; null `hold_until` means it waits for something (0020, 0040). Never drops the message. |
| `planned_gap_ms` | int NULL | The gap drawn for this message once, so the schedule is known in advance (0040). Copied from the campaign recipient. |
| `read_requested_at`, `read_marked_at` | timestamptz NULL | On an inbound message: when a reply asked for it to be marked read, and when WhatsApp was told it was read (0040). |
| `tick_checked_at`, `tick_verdict` | timestamptz / text NULL | When the sweep looked at an outbound message still at one tick after 30 minutes, and what it found: `likely_blocked`, `likely_offline` or `decrypt_retry` (0041). Nothing is resent. |

## `media_asset` ✅

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id` | uuid | Row identity and tenant. RLS'd like every org-scoped table. |
| **`storage_key`** | text | Provider-neutral path, so migrating from a directory to a bucket is a copy rather than a rewrite. **Random and unguessable** — `org/<org>/media/<uuid>.<ext>`, never the sender's filename. RLS protects this row and stops at the filesystem, so a guessable key would turn one missed check into a public bucket (D-11). |
| `storage_driver` | text | Which backend holds it. Recorded rather than inferred from config, so a part-migrated estate is readable. |
| **`content_type`** | text | Decided from **magic bytes** at store time, never from the filename or the provider's claim — both are the sender's input. Anything unrecognised is `application/octet-stream`, which downloads instead of rendering. |
| `size_bytes` | int | What was stored. Also what `Content-Length` says on the way out. |
| `sha256` | text | Hex digest of the stored bytes. Deduplicates within an org — the same CV forwarded by five people is one file — and is the only way to tell later that what is on disk is what arrived. Deliberately **not** deduplicated across orgs: that would tangle two tenants' erasure paths. |
| `filename` | text NULL | What the sender called it, sanitised. Display and the saved filename only; it decides nothing. |
| `scanned_at` | timestamptz NULL | When an antivirus pass last ran. Always null today — no scanner exists (D-11). |

`message.media_id` points here. It stays **null for a media message whose bytes could not be
fetched**, while `content_type` still says `image` or `document` — which is how the inbox knows
to say an attachment exists and could not be retrieved, rather than showing an empty message.

## `conversation_participant` ⬜ · `internal_note` ✅ · `canned_reply` ✅

> `internal_note` and `canned_reply` are built (migration 0012); `conversation_participant` waits for presence/collision (D-17).

| Table | Key columns | What it is |
|---|---|---|
| `conversation_participant` | `conversation_id`, `user_id`, `role`, `last_read_at` | Who is watching a thread. Powers collision detection — knowing another agent is already in here. |
| `internal_note` | `conversation_id`, `author_user_id`, `body`, `mentions uuid[]` | Team-only commentary inside a thread. **Never transmitted.** `mentions` drives notifications. |
| `canned_reply` | `org_id`, `shortcut`, `body`, `locale` | Saved responses with variable substitution. `shortcut` is what the agent types to insert it. |

---

# Templates & campaigns

## `message_template` ⬜

The old system had **no template table at all** — bulk-send bodies were freeform text typed
into a browser and never persisted, so nothing was reusable, auditable or A/B-testable.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id` | uuid | Row identity, tenant. |
| `key` | text | Stable machine name (`order_shipped`). What the API sends; survives rewording. |
| `version` | int | **Templates are immutable.** Editing creates a new version, so a message sent last month still reports against the text that was actually sent. |
| `locale` | text | Language variant. Resolved against the contact's language with a documented fallback. |
| `category` | text | `marketing` / `utility` / `auth` / `service`. **Determines what Meta charges** — marketing is ~6× utility in India — and whether approval is required. |
| `channel_intent` | text | Drives routing: OTP and client-facing traffic go to the paid official channel, bulk sourcing to Baileys (`04-architecture.md`). |
| `body` | text | The text, with `{{variables}}` and optional spintax for body variation. |
| `variables` | jsonb | **Typed** variable declarations with defaults and required flags. Rendering fails loudly on a missing required variable rather than sending `{{first_name}}` to a customer. |
| `provider_meta` | jsonb | Deliberately open-ended — carousels, buttons, lists and WhatsApp Flows land here **without a migration**. |
| `meta_template_name` | text NULL | The corresponding approved template on Meta's side, if one exists. |
| `meta_approval_status` | text NULL | `pending` / `approved` / `rejected`, polled from Meta. An unapproved template cannot be used outside the service window. |
| `is_active` | bool | Retire a template without deleting it and orphaning message history. |

## `template_variant` ⬜

| Column | What it is |
|---|---|
| `template_id`, `label`, `weight`, `body` | An A/B arm. `weight` sets the split; results roll up per variant. |

## `campaign` ✅ (first slice)

> **Built:** targeting by `from_import_run_id`, `explicit_contact_ids`, `from_tag_id` or `from_segment_id` (exactly one), a plain `body` (no template table yet — D-19), `status`, `started_at`/`completed_at`. Not yet: scheduling, quiet hours, cost fields.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `name` | — | Row identity, tenant, label. |
| `status` | text | `draft` / `scheduled` / `running` / `paused` / `completed` / `cancelled`. |
| `segment_id` | uuid FK NULL | The audience, if targeting a saved segment. |
| `explicit_contact_ids` | uuid[] NULL | An ad-hoc list instead. **Never "everyone" implicitly** — the audience is always stated. |
| `template_id` | uuid FK | What to send. |
| `sender_pool` | jsonb | Which numbers may send, and their weights. Spreading load across numbers is how volume scales safely. |
| `scheduled_at` | timestamptz NULL | When to start. |
| `quiet_hours` / `timezone` | jsonb / text | **Not built.** Quiet hours are an org setting (`antiban_setting`), not a campaign column. |
| `recent_days` | int NULL | How many days back "messaged recently" looks for this campaign; null = the org's default `antiban_setting.recent_days` (0043). |
| `audience_targets` | jsonb NULL | The picks the audience was chosen with on New campaign (`[{ kind: import\|tag\|segment\|people\|everyone, ... }]`), kept so a draft can be edited with them back; null for a campaign made another way (0044). |
| `leave_out_recent` | bool | People messaged by another campaign from this same number within `recent_days` are skipped as `cooldown` when true; they are sent (a warning, not a block) when false, the default (0043). |
| `purpose` | text NULL | One sentence: why these people are messaged. Said in the closing message if someone opts out (0041). |
| `media_after_reply` | bool | Default true: a new chat gets the text alone and the picture or link follows when they reply (0040). |
| `created_by` | uuid FK | Who launched it. |
| `estimated_cost_micros` | int | What the dry run predicted. |
| `actual_cost_micros` | int | What it really cost. The two are reconciled after completion. |

## `campaign_recipient` ✅

One row per person per campaign. **Snapshotted at launch**, so a dynamic segment changing
mid-run cannot change who is being messaged.

| Column | Type | What it is |
|---|---|---|
| `campaign_id`, `contact_id` | uuid | The pairing. |
| `status` | text | `pending` → `queued` → `sent` → `delivered` → `read` → `replied`, or `failed` / `skipped`. |
| **`skip_reason`** | text NULL | `dnc`, `consent_missing`, `cooldown`, `engagement_lock`, `invalid_number`. **Blocked recipients are reported, never silently dropped** — silent dropping is how an operator stops trusting the whole system. |
| `message_id` | uuid FK NULL | The message that was actually sent. |
| `planned_gap_ms` | int NULL | The gap drawn for this person at launch (0040). |
| `followup_pending` | bool | The picture or link is waiting for this person's reply (0040). |
| `attempted_at` | timestamptz NULL | When it was tried. |

## `campaign_metric` ⬜

| Column | What it is |
|---|---|
| `campaign_id`, `metric`, `value`, `computed_at` | Incremental rollups so dashboards read summaries instead of scanning `message`. A test asserts these reconcile exactly with the raw rows — a reporting layer that quietly disagrees with reality is worse than none. |

---

# Automation

## `sequence` · `sequence_step` · `sequence_enrollment` ⬜

A drip: a series of messages sent over days unless the contact does something that should stop it.

| Table | Column | What it is |
|---|---|---|
| `sequence` | `id`, `org_id`, `name`, `is_active` | The series itself. |
| `sequence_step` | `sequence_id` | Parent. |
| | `order` | Position in the series. |
| | `delay_minutes` | Wait after the previous step. What makes it a drip rather than a blast. |
| | `condition` | jsonb — only send this step if it still applies (they haven't replied, haven't converted). |
| | `template_id` | What to send at this step. |
| | `exit_on` | jsonb — events that end enrolment early: a reply, a stage change, an opt-out. **Without this, someone who already answered keeps getting nagged**, which is both rude and a ban signal. |
| `sequence_enrollment` | `contact_id`, `sequence_id` | Who is in it. |
| | `current_step` | How far along. |
| | `status` | `active` / `completed` / `exited` / `paused`. |
| | `next_run_at` | When the next step is due. Indexed — this is the column the scheduler polls. |

## `automation_rule` ⬜

Trigger → condition → action. Where keyword auto-replies and reply classification live.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `name` | — | Row identity, tenant, label. |
| `trigger` | jsonb | What starts it: inbound keyword, stage change, tag added, webhook, schedule. |
| `conditions` | jsonb | Extra filters that must hold. |
| `actions` | jsonb | What to do: reply, tag, assign, move stage, call a webhook. |
| `enabled` | bool | Off switch that preserves the rule. |
| `priority` | int | **First match wins, deterministically.** Ambiguous ordering is how automations become unpredictable. |

Every match records **which rule fired**, so the UI can distinguish "classified confidently"
from "nothing matched, defaulted to replied" — the old system gave no such signal, and users
stop trusting a classifier they cannot inspect (M32).

## `scheduled_message` ⬜

| Column | What it is |
|---|---|
| `conversation_id`, `template_id`, `send_at`, `status`, `created_by` | A one-off message queued for later. Separate from campaigns because "remind this one person on Tuesday" is not a campaign. |

---

# Ingestion

## `data_source` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id`, `name` | — | Row identity, tenant, label. |
| `type` | text | `excel` / `csv` / `gsheets` / `rest` / `webhook`. Selects the connector. |
| `config` | jsonb | Connector-specific settings, validated by that connector's own Zod schema — which also generates its settings form. |
| `credentials_ref` | text NULL | **A pointer into the secrets driver, never the secret itself.** |
| `schedule_cron` | text NULL | For recurring syncs. Null means manual only. |
| `enabled` | bool | Pause a sync without deleting its configuration. |
| `last_run_at` | timestamptz NULL | When it last ran. |
| `cursor` | text NULL | Where incremental reads resume from, so a sync fetches only what changed. |

## `field_mapping` ⬜

| Column | Type | What it is |
|---|---|---|
| `id`, `source_id` | uuid | Row identity, optional parent source. |
| `name`, `version` | text, int | Mappings are versioned, so an import always records exactly how it interpreted the file. |
| `mapping` | jsonb | Source column → target field, with transforms (trim, phone_e164, date_parse). |
| `identity_rules` | jsonb | **Ordered** matching rules — external_ref, then phone, then email. Replaces the old `email OR phone` that merged strangers (M7). |
| `is_preset` | bool | Ships as a starting point (e.g. a job-board export layout) rather than hardcoded in the importer, which is where the old system put it. |

## `import_run` ✅ (first slice)

> **Built:** upload → dry run → commit with a content-`sha256` unique per org (partial index — a forced re-import supersedes), status and counts. Mapping is posted per run; the reusable `field_mapping` / `data_source` tables are D-21.

| Column | Type | What it is |
|---|---|---|
| `id`, `org_id` | uuid | Row identity, tenant. |
| `source_id` / `mapping_id` | uuid FK | Where from, interpreted how. |
| `status` | text | `pending` / `running` / `completed` / `failed`. |
| `mode` | text | `dry_run` or `commit`. **A dry run is mandatory before committing** — it shows what would be created, updated, skipped, and what a merge would overwrite. |
| `counts` | jsonb | Rows created / updated / skipped / failed. |
| `started_at` / `finished_at` | timestamptz | Duration, and whether it is still going. |
| `actor_id` | uuid | Who ran it. |
| `file_ref` | text NULL | The stored upload. **The file never round-trips through the browser** (M3). |

## `import_row` ✅

**The whole answer to M4**, where one bad row rolled back an entire 5,000-row import.

| Column | Type | What it is |
|---|---|---|
| `import_run_id`, `row_number` | uuid, int | UNIQUE together — makes a killed worker **resumable from the last committed batch** rather than restartable from zero. |
| `raw` | jsonb | The original row, exactly as read. Lets a failure be diagnosed without re-opening the file. |
| `status` | text | `imported` / `updated` / `skipped` / `failed`. |
| `error` | jsonb NULL | Why it failed, per row. Downloadable as a corrections spreadsheet with an `_error` column — fix those rows and re-import just them. |
| `contact_id` | uuid FK NULL | What it produced, when it succeeded. |

---

# Ops

| Table | Key columns | What it is |
|---|---|---|
| `webhook_endpoint` ⬜ | `org_id`, `url`, `secret`, `event_types[]`, `status` | Where to send outbound events. `url` is SSRF-guarded — private ranges and cloud metadata addresses are refused. |
| `webhook_delivery` ⬜ | `endpoint_id`, `event`, `payload`, `attempts`, `response_status`, `next_retry_at` | One attempt log per event. Gives at-least-once delivery, exponential backoff, manual replay and a dead-letter queue. |
| `inbound_event_raw` ⬜ | `provider`, `payload`, `signature_verified`, `received_at`, `processed_at` | **The raw provider payload, stored before processing.** Meta expects a 200 within ~3 seconds, so the handler verifies the signature, writes this row, and returns — all real work happens afterwards. Also makes a bad deploy replayable instead of a data-loss event (NFR-8). |
| `rate_limit_state` ⬜ | `key`, `window_start`, `count` | Durable token-bucket state. Lives here (or in Redis) rather than in process memory, so limits hold across worker replicas — the old system's counters were per-process (M13). |
| `org_setting` ⬜ | `org_id`, `key`, `value` | Branding, quiet hours, caps, locale, currency, retention. **Branding is configuration**; the old system hardcoded a client's name into every page title and the AI prompt. |
| `feature_flag` ⬜ | `org_id`, `key`, `enabled` | Ship code dark, enable per tenant. |

---

# Encryption

Envelope encryption, fixing the old single-key-with-no-rotation design where losing the key
made all data permanently unrecoverable (M24):

```
KEK   (KmsDriver: local | aws-kms | gcp-kms | openbao)
 └─ wraps a per-org DEK  →  org_encryption_key(org_id, key_version, wrapped_dek, created_at)
      └─ encrypts  message.body_enc
                   contact_identity.value_enc
                   channel_auth_state.value_enc
                   app_user.mfa_secret_enc
```

| Column | What it is |
|---|---|
| `org_id`, `key_version` | Which tenant, which generation. Every ciphertext column stores its `key_version` so old and new can coexist during rotation. |
| `wrapped_dek` | The data key, encrypted by the KEK. The database alone is useless without the KEK — which is also why a backup and its key must not live in one place. |
| `created_at` | When this generation began. |

Rotation is an online batch job: new DEK, re-encrypt in batches, retire the old version.
The `*_hmac` blind-index key is **separate and not rotated** — rotating it would invalidate
every lookup index, which is a different and much larger operation.

# Indexing

Beyond the obvious foreign keys:

| Index | Why |
|---|---|
| `pg_trgm` on `contact.display_name` | Fuzzy name search. |
| GIN on `contact.custom_fields` | Filter by user-defined fields without a column per field. GIN is right **here specifically** because users invent their own fields — we cannot know in advance which key will be filtered on. |
| **B-tree on `(external_ref->>'id')`**, not GIN | The lookup the job portal integration depends on. Measured on 200k rows: seq scan 116 ms · GIN `jsonb_ops` 2.0 ms · GIN `jsonb_path_ops` 0.48 ms · **B-tree expression 0.09 ms**, in an index half the size (6 MB vs 11 MB). A B-tree indexes exactly the one expression we always query; GIN indexes every key in the document, and that generality is pure cost when the access pattern is fixed. Use `jsonb_path_ops` over the default `jsonb_ops` for any GIN index that only serves `@>` — it is smaller and faster. |
| `(conversation_id, created_at DESC)` | Thread paging — the inbox's hottest query. |
| Partial: `conversation (status, assignee_user_id) WHERE status IN ('open','pending')` | The inbox only ever looks at live threads; indexing closed ones wastes space. |
| Partial: `campaign_recipient (campaign_id) WHERE status = 'pending'` | The sender only asks "who is left?". |
| BRIN on `audit_log.at`, `message.created_at` | Append-only, time-ordered tables — BRIN is a fraction of the size of a B-tree here. |

# Retention

Configurable per org, enforced by a nightly job that writes a summary audit row:

| Data | Default |
|---|---|
| `inbound_event_raw` | 30 days |
| `audit_log` | 1 year |
| `media_asset` | 1 year |
| `message` | indefinite |

A per-contact delete request is a separate, immediate path — "remove my data" is not a retention
policy, whatever jurisdiction the request comes under.


---

## Added after the first design (2026-10)

What the migrations from 0016 onward added, in one place. The per-table sections above describe the
original shape; these are the deltas.

| Table · column | Migration | What it is |
|---|---|---|
| `channel_session.decrypt_burst_at` | 0018 | When a burst of decrypt failures was last seen (the composer warns for 15 min) |
| `sender_identity.enforcement`, `advisory_reason`, `advisory_set_by`, `advisory_set_at`, `advisory_bypass_count`, `advisory_last_bypass` | 0019 | Advisory mode (D-29). **Dropped in 0039.** |
| `campaign.gate_overrides`, `gate_override_reason` | 0019 | Recipient-experience gates (and do-not-contact) an admin lifted for this campaign, with the reason |
| `custom_field` | 0020 | The org's typed field vocabulary: `key`, `label`, `type` (`text`/`number`/`date`/`select`), `options` (RLS forced) |
| `message.hold_reason` | 0020 | Why a still-queued message is waiting (`sender_not_connected`, or a reason the anti-ban policy gave) — cleared on send |
| `message.dnc_override`, `dnc_override_reason` | 0021 | An admin knowingly sent to a do-not-contact person; the gateway refuses such a message without it |
| `sender_identity.restriction_state`, `restriction_since` | 0022 | Silent-restriction verdict. **Dropped in 0039.** |
| `sender_health_event` | 0022 | A number's timeline (a refused connection, a logout nobody asked for, a device removed on the phone): `kind`, `severity`, a plain `summary`, the `evidence` behind it (RLS forced) |
| `campaign.pause_reason` | 0022 | Set when the system paused a campaign (`ban_suspected`, `unlinked`) |
| `segment.saved` | 0023 | `false` for a one-off inline audience built while creating a campaign; hidden from the saved list |
| `whatsapp_notice` (new table), `antiban_setting` (new table) | 0040 | WhatsApp's limit warnings as they arrived; the org's quiet hours (RLS forced on both) |
| `channel_session.timelock_active`, `timelock_until`, `timelock_type`, `capping_*`, `linked_since` | 0040 | What WhatsApp last said about the number's limits, and when it was linked |
| `conversation.refused_463_at` | 0040 | A 463 refusal; holds new sends to that contact |
| `message.hold_until`, `planned_gap_ms`, `error_detail`, `read_requested_at`, `read_marked_at` | 0040 | Lane scheduling, the stored gap, a failure's detail, read-receipt timing |
| `campaign.media_after_reply`; `campaign_recipient.planned_gap_ms`, `followup_pending` | 0040 | Media after reply; the stored schedule |
| `antiban_setting.closing_message_enabled`, `contact_phone`, `contact_email`, `default_purpose`, `stop_words`, `restart_words`; `campaign.purpose` | 0041 | The opt-out closing message and the words that start and end an opt-out |
| `channel_session.many_undelivered_at`, `many_undelivered_resumed_at`, `decrypt_wave_at` | 0041 | Number-wide holds |
| `conversation.likely_blocked_at`, `decrypt_retry_at`, `profile_snapshot`, `profile_probe_at`; `message.tick_checked_at`, `tick_verdict` | 0041 | Per-contact delivery state (ticks, retries, probable block) |
| `campaign.blank_fill_in_choice`, `fill_in_fallback` | 0042 | What to do for a person with no value for a fill-in the message uses: skip them, or fill the gap with a word. Null = send anyway. |
| `campaign.audience_targets` | 0044 | The picks a draft was made with, so Edit can open it with them back. |
| `campaign.recent_days`, `campaign.leave_out_recent`, `antiban_setting.recent_days` | 0043 | "Messaged recently" as a choice with its own number of days, and the org's default for it. |
| `contact.do_not_contact` with `dnc_reason = 'opt_out'` | — | An opt-out (a STOP word, the classifier, or an agent marking it) sets the flag with this reason; only a flag with this reason is lifted by a restart word |

Contacts also gain behaviour without new columns: a `wa_lid` identity can be linked to a `phone`
identity on the same contact, or two contacts merged (`contact.merged` audit; the absorbed contact is
soft-deleted).
