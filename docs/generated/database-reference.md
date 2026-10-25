# Database reference (generated)

Generated from the live database on 2026-10-25 by `npm run db:docs`. **Do not edit by hand**; change the schema or `packages/db/src/table-notes.ts` and regenerate.
For the optimisations and the main queries, see [`35-database-and-queries.md`](../35-database-and-queries.md).

**32 tables, 71 foreign keys, 28 row-level-security policies, 3 triggers, 2 functions.**

Every tenant table has `org_id` and a row-level-security policy: the app runs each request as the restricted `crm_app` role with `app.org_id` set, so a forgotten `WHERE org_id` returns nothing instead of leaking.

## Tables by group

### Audit and health

| Table | What it is for | Rows now |
|---|---|---|
| [`ai_run`](#ai_run) | One row each time the AI assistant sends, tries, or is held back (and why), with the model and token counts, so its work and cost can be checked. | 3 |
| [`audit_log`](#audit_log) | Append-only record of who did what and when: sign-ins, reassignments, overrides, exports. The app role cannot update or delete rows. | 24 |
| [`key_rotation_state`](#key_rotation_state) | One row for the whole install: whether the background re-encryption of a key rotation is paused, and how much it has moved. Not per org, because the encryption key is not. | 1 |
| [`sender_health_event`](#sender_health_event) | A timeline of what happened to a number’s health: restriction suspected or cleared, possible ban, recovery started. | 1 |

### Campaigns

| Table | What it is for | Rows now |
|---|---|---|
| [`ai_job`](#ai_job) | The AI assistant’s waiting list: instructions and wording requests, run one at a time per org. Shows who is queued, what is running and what finished; only a queued one can be cancelled. | 0 |
| [`ai_setting`](#ai_setting) | The AI assistant’s switch for an org: on or off, its instructions, a daily message limit, and who accepted the data-sharing note. Off until an admin accepts. | 1 |
| [`ai_template`](#ai_template) | A saved AI template: what an owner described in plain words and the instructions the AI wrote from it, kept together to pick again. The locked always-on rules are not stored here; they are added on every reply. | 2 |
| [`campaign`](#campaign) | A bulk send: the message, the number it goes from, its audience, its state (draft, running, paused…) and pacing results. | 1 |
| [`campaign_recipient`](#campaign_recipient) | One person in a campaign. Acts as the queue: the gateway turns recipients into messages only as fast as the anti-ban limits allow, and records why anyone was skipped. | 2 |

### Contacts

| Table | What it is for | Rows now |
|---|---|---|
| [`contact`](#contact) | A person you talk to: display name, custom fields, source and a do-not-contact flag. Phone numbers and emails live in contact_identity, not here. | 4 |
| [`contact_identity`](#contact_identity) | One way to reach or recognise a contact: a phone number, an email, or a WhatsApp privacy address. A contact can have several. | 8 |
| [`contact_tag`](#contact_tag) | Which contacts carry which tags. One row per contact and tag. | 5 |
| [`custom_field`](#custom_field) | The vocabulary of extra fields an org has defined for contacts (city, experience…), with a type, so values are checked and {{city}} works in campaigns. | 1 |
| [`segment`](#segment) | A saved audience: a stored filter whose matching people are recomputed whenever it is used. | 0 |
| [`tag`](#tag) | A label such as "pune" or "interview-stage". Unique per org by name. | 2 |

### Import

| Table | What it is for | Rows now |
|---|---|---|
| [`import_row`](#import_row) | The ledger for one row of an upload: what it said, what the dry run decided, and which contact it produced. | 3 |
| [`import_run`](#import_run) | One uploaded spreadsheet and what became of it: file hash (to refuse duplicates), counts, and whether it was committed or superseded. | 1 |

### Inbox

| Table | What it is for | Rows now |
|---|---|---|
| [`canned_reply`](#canned_reply) | A saved reply an agent can insert with a shortcut, with {{name}}-style placeholders. | 0 |
| [`conversation`](#conversation) | One chat thread between one contact and one of your numbers. Holds the owner, open/closed status, unread count and timing. | 2 |
| [`conversation_participant`](#conversation_participant) | Extra people on a chat beside its owner. Participants may reply; only admins add or remove them. | 0 |
| [`conversation_presence`](#conversation_presence) | Who has a chat open right now, refreshed by a heartbeat every few seconds. Throwaway rows, never history. | 0 |
| [`internal_note`](#internal_note) | A team-only note on a thread. Kept apart from message so a note can never be sent to the customer. | 1 |
| [`media_asset`](#media_asset) | An attachment file: its type (decided from the file’s bytes), size and storage key. The bytes live in the storage driver, not the database. | 3 |
| [`message`](#message) | One message in or out of a thread: encrypted body, delivery status, who sent it, optional attachment and campaign. Inserting an outbound queued row wakes the gateway. | 33 |

### WhatsApp numbers

| Table | What it is for | Rows now |
|---|---|---|
| [`channel_auth_state`](#channel_auth_state) | The encrypted login credentials Baileys needs to keep a number linked across restarts. Losing the encryption key loses these. | 0 |
| [`channel_session`](#channel_session) | The live connection state of a number (connected, QR waiting, unlink requested). Churns constantly; three triggers here wake the gateway. | 1 |
| [`sender_identity`](#sender_identity) | One of your WhatsApp numbers and its reputation: warm-up stage, health score, risk band, restriction state and recovery pauses. | 1 |

### Workspaces and people

| Table | What it is for | Rows now |
|---|---|---|
| [`api_key`](#api_key) | Machine access for integrations such as JobPortal: a hashed secret plus the scopes it may use. Also looked up before the org is known. | 0 |
| [`app_user`](#app_user) | A person who can sign in: name, email, password hash. Belongs to an org through org_membership, not directly. | 3 |
| [`org`](#org) | A customer workspace. Every other table points back to one org, and row-level security keeps each org’s rows invisible to the rest. | 1 |
| [`org_membership`](#org_membership) | Links a person to an org and gives them a role (admin or agent). Roles live here so one person could join several orgs later. | 3 |
| [`session`](#session) | A signed-in browser session for the web app. Looked up before the org is known, so it has no row-level security. | 2 |

## Table details

### ai_job

_Campaigns._ The AI assistant’s waiting list: instructions and wording requests, run one at a time per org. Shows who is queued, what is running and what finished; only a queued one can be cancelled.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `kind` | text | no |  |  |
| `input` | text | no |  |  |
| `requested_by` | uuid | yes |  |  |
| `status` | text | no | 'queued'::text |  |
| `result` | jsonb | yes |  |  |
| `error` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `started_at` | timestamp with time zone | yes |  |  |
| `finished_at` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `requested_by` → `app_user.id` (on delete set null)

**Indexes:**

- `ai_job_org_created_idx`: ai_job USING btree (org_id, created_at)
- `ai_job_org_status_idx`: ai_job USING btree (org_id, status)

**Policies:**

- `ai_job_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### ai_run

_Audit and health._ One row each time the AI assistant sends, tries, or is held back (and why), with the model and token counts, so its work and cost can be checked.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `conversation_id` | uuid | yes |  |  |
| `campaign_id` | uuid | yes |  |  |
| `kind` | text | no |  |  |
| `outcome` | text | no |  |  |
| `reason` | text | yes |  |  |
| `model` | text | yes |  |  |
| `input_tokens` | integer | no | 0 |  |
| `output_tokens` | integer | no | 0 |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `conversation_id` → `conversation.id` (on delete set null)
- `campaign_id` → `campaign.id` (on delete set null)

**Indexes:**

- `ai_run_conversation_idx`: ai_run USING btree (conversation_id)
- `ai_run_org_created_idx`: ai_run USING btree (org_id, created_at)

**Policies:**

- `ai_run_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### ai_setting

_Campaigns._ The AI assistant’s switch for an org: on or off, its instructions, a daily message limit, and who accepted the data-sharing note. Off until an admin accepts.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `org_id` | uuid | no |  | PK |
| `enabled` | boolean | no | false |  |
| `instructions` | text | no | ''::text |  |
| `daily_message_cap` | integer | no | 200 |  |
| `consent_accepted_at` | timestamp with time zone | yes |  |  |
| `consent_accepted_by` | uuid | yes |  |  |
| `bot_user_id` | uuid | yes |  |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `may_start_campaigns` | boolean | no | false |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `consent_accepted_by` → `app_user.id` (on delete set null)
- `bot_user_id` → `app_user.id` (on delete set null)

**Policies:**

- `ai_setting_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### ai_template

_Campaigns._ A saved AI template: what an owner described in plain words and the instructions the AI wrote from it, kept together to pick again. The locked always-on rules are not stored here; they are added on every reply.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `description` | text | no | ''::text |  |
| `instructions` | text | no |  |  |
| `audience` | text | no | ''::text |  |
| `first_message` | text | no | ''::text |  |
| `created_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `last_used_at` | timestamp with time zone | yes |  |  |
| `use_count` | integer | no | 0 |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `created_by` → `app_user.id` (on delete set null)

**Indexes:**

- `ai_template_org_used_idx`: ai_template USING btree (org_id, last_used_at)

**Policies:**

- `ai_template_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### api_key

_Workspaces and people._ Machine access for integrations such as JobPortal: a hashed secret plus the scopes it may use. Also looked up before the org is known.

Row-level security: **off**.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `key_hash` | text | no |  |  |
| `prefix` | text | no |  |  |
| `scopes` | _text[] | no | '{}'::text[] |  |
| `rate_limit_per_min` | integer | no | 120 |  |
| `last_used_at` | timestamp with time zone | yes |  |  |
| `expires_at` | timestamp with time zone | yes |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `api_key_key_hash_unique`: UNIQUE api_key USING btree (key_hash)
- `api_key_org_idx`: api_key USING btree (org_id)

### app_user

_Workspaces and people._ A person who can sign in: name, email, password hash. Belongs to an org through org_membership, not directly.

Row-level security: **off**.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `email` | text | no |  |  |
| `password_hash` | text | yes |  |  |
| `display_name` | text | no |  |  |
| `status` | text | no | 'active'::text |  |
| `last_login_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `is_bot` | boolean | no | false |  |

**Indexes:**

- `app_user_email_unique`: UNIQUE app_user USING btree (email)

### audit_log

_Audit and health._ Append-only record of who did what and when: sign-ins, reassignments, overrides, exports. The app role cannot update or delete rows.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `actor_type` | text | no |  |  |
| `actor_id` | uuid | no |  |  |
| `action` | text | no |  |  |
| `target_type` | text | yes |  |  |
| `target_id` | uuid | yes |  |  |
| `before` | jsonb | yes |  |  |
| `after` | jsonb | yes |  |  |
| `ip` | text | yes |  |  |
| `request_id` | text | yes |  |  |
| `at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `audit_log_action_idx`: audit_log USING btree (action)
- `audit_log_actor_idx`: audit_log USING btree (actor_id)
- `audit_log_org_at_idx`: audit_log USING btree (org_id, at)

**Policies:**

- `audit_log_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### campaign

_Campaigns._ A bulk send: the message, the number it goes from, its audience, its state (draft, running, paused…) and pacing results.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `status` | text | no | 'draft'::text |  |
| `body` | text | no |  |  |
| `sender_identity_id` | uuid | no |  |  |
| `from_import_run_id` | uuid | yes |  |  |
| `explicit_contact_ids` | jsonb | yes |  |  |
| `started_at` | timestamp with time zone | yes |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `from_tag_id` | uuid | yes |  |  |
| `from_segment_id` | uuid | yes |  |  |
| `gate_overrides` | _text[] | no | '{}'::text[] |  |
| `gate_override_reason` | text | yes |  |  |
| `pause_reason` | text | yes |  |  |
| `ai_template_id` | uuid | yes |  |  |
| `media_asset_id` | uuid | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `sender_identity_id` → `sender_identity.id` (on delete restrict)
- `from_import_run_id` → `import_run.id` (on delete set null)
- `from_tag_id` → `tag.id` (on delete set null)
- `from_segment_id` → `segment.id` (on delete set null)
- `ai_template_id` → `ai_template.id` (on delete set null)
- `media_asset_id` → `media_asset.id` (on delete set null)

**Indexes:**

- `campaign_org_status_idx`: campaign USING btree (org_id, status)

**Policies:**

- `campaign_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### campaign_recipient

_Campaigns._ One person in a campaign. Acts as the queue: the gateway turns recipients into messages only as fast as the anti-ban limits allow, and records why anyone was skipped.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `campaign_id` | uuid | no |  |  |
| `contact_id` | uuid | no |  |  |
| `status` | text | no | 'pending'::text |  |
| `skip_reason` | text | yes |  |  |
| `message_id` | uuid | yes |  |  |
| `attempted_at` | timestamp with time zone | yes |  |  |
| `opening_enc` | bytea | yes |  |  |
| `opening_tries` | integer | no | 0 |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `campaign_id` → `campaign.id` (on delete cascade)
- `contact_id` → `contact.id` (on delete cascade)
- `message_id` → `message.id` (on delete set null)

**Indexes:**

- `campaign_recipient_pending_idx`: campaign_recipient USING btree (campaign_id, status)
- `campaign_recipient_uidx`: UNIQUE campaign_recipient USING btree (campaign_id, contact_id)

**Policies:**

- `campaign_recipient_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### canned_reply

_Inbox._ A saved reply an agent can insert with a shortcut, with {{name}}-style placeholders.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `shortcut` | text | no |  |  |
| `body` | text | no |  |  |
| `locale` | text | no | 'en'::text |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `canned_reply_org_shortcut_uidx`: UNIQUE canned_reply USING btree (org_id, shortcut)

**Policies:**

- `canned_reply_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### channel_auth_state

_WhatsApp numbers._ The encrypted login credentials Baileys needs to keep a number linked across restarts. Losing the encryption key loses these.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `sender_identity_id` | uuid | no |  | PK |
| `key` | text | no |  | PK |
| `value_enc` | bytea | no |  |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**References:**

- `sender_identity_id` → `sender_identity.id` (on delete cascade)

**Indexes:**

- `channel_auth_state_keyver_idx`: channel_auth_state USING btree (envelope_key_version(value_enc))
- `channel_auth_state_sender_identity_id_key_pk`: UNIQUE channel_auth_state USING btree (sender_identity_id, key)

**Policies:**

- `channel_auth_state_tenant_isolation` (ALL): (EXISTS ( SELECT 1    FROM sender_identity s   WHERE ((s.id = channel_auth_state.sender_identity_id) AND (s.org_id = (current_setting('app.org_id'::text, true))::uuid))))

### channel_session

_WhatsApp numbers._ The live connection state of a number (connected, QR waiting, unlink requested). Churns constantly; three triggers here wake the gateway.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `sender_identity_id` | uuid | no |  |  |
| `connection_state` | text | no | 'closed'::text |  |
| `last_connected_at` | timestamp with time zone | yes |  |  |
| `disconnect_reason` | text | yes |  |  |
| `disconnect_code` | integer | yes |  |  |
| `reconnect_attempts` | integer | no | 0 |  |
| `qr_expires_at` | timestamp with time zone | yes |  |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `link_requested_mode` | text | yes |  |  |
| `link_requested_phone` | text | yes |  |  |
| `link_requested_at` | timestamp with time zone | yes |  |  |
| `link_challenge` | jsonb | yes |  |  |
| `link_error` | text | yes |  |  |
| `unlink_requested_at` | timestamp with time zone | yes |  |  |
| `decrypt_burst_at` | timestamp with time zone | yes |  |  |
| `own_decrypt_burst_at` | timestamp with time zone | yes |  |  |

**References:**

- `sender_identity_id` → `sender_identity.id` (on delete cascade)

**Indexes:**

- `channel_session_sender_uidx`: UNIQUE channel_session USING btree (sender_identity_id)

**Policies:**

- `channel_session_tenant_isolation` (ALL): (EXISTS ( SELECT 1    FROM sender_identity s   WHERE ((s.id = channel_session.sender_identity_id) AND (s.org_id = (current_setting('app.org_id'::text, true))::uuid))))

**Triggers:**

- `channel_session_link_requested`: CREATE TRIGGER channel_session_link_requested AFTER INSERT OR UPDATE OF link_requested_at ON public.channel_session FOR EACH ROW WHEN (((new.link_requested_at IS NOT NULL) AND (new.link_challenge IS NULL))) EXECUTE FUNCTION notify_gateway('link')
- `channel_session_unlink_requested`: CREATE TRIGGER channel_session_unlink_requested AFTER INSERT OR UPDATE OF unlink_requested_at ON public.channel_session FOR EACH ROW WHEN ((new.unlink_requested_at IS NOT NULL)) EXECUTE FUNCTION notify_gateway('unlink')

### contact

_Contacts._ A person you talk to: display name, custom fields, source and a do-not-contact flag. Phone numbers and emails live in contact_identity, not here.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `display_name` | text | yes |  |  |
| `owner_user_id` | uuid | yes |  |  |
| `custom_fields` | jsonb | no | '{}'::jsonb |  |
| `external_ref` | jsonb | yes |  |  |
| `source` | text | yes |  |  |
| `do_not_contact` | boolean | no | false |  |
| `dnc_reason` | text | yes |  |  |
| `dnc_at` | timestamp with time zone | yes |  |  |
| `last_inbound_at` | timestamp with time zone | yes |  |  |
| `last_outbound_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `deleted_at` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `owner_user_id` → `app_user.id` (on delete set null)

**Indexes:**

- `contact_custom_fields_gin`: contact USING gin (custom_fields jsonb_path_ops)
- `contact_external_ref_id_idx`: contact USING btree (((external_ref ->> 'id'::text))) WHERE (external_ref IS NOT NULL)
- `contact_org_idx`: contact USING btree (org_id)

**Policies:**

- `contact_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### contact_identity

_Contacts._ One way to reach or recognise a contact: a phone number, an email, or a WhatsApp privacy address. A contact can have several.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `contact_id` | uuid | no |  |  |
| `kind` | text | no |  |  |
| `value_normalized` | text | no |  |  |
| `is_primary` | boolean | no | false |  |
| `verified_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `wa_registered` | boolean | yes |  |  |
| `wa_checked_at` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `contact_id` → `contact.id` (on delete cascade)

**Indexes:**

- `contact_identity_contact_idx`: contact_identity USING btree (contact_id)
- `contact_identity_lookup_uidx`: UNIQUE contact_identity USING btree (org_id, kind, value_normalized)

**Policies:**

- `contact_identity_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### contact_tag

_Contacts._ Which contacts carry which tags. One row per contact and tag.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `org_id` | uuid | no |  |  |
| `contact_id` | uuid | no |  | PK |
| `tag_id` | uuid | no |  | PK |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `contact_id` → `contact.id` (on delete cascade)
- `tag_id` → `tag.id` (on delete cascade)

**Indexes:**

- `contact_tag_contact_id_tag_id_pk`: UNIQUE contact_tag USING btree (contact_id, tag_id)
- `contact_tag_tag_idx`: contact_tag USING btree (tag_id)

**Policies:**

- `contact_tag_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### conversation

_Inbox._ One chat thread between one contact and one of your numbers. Holds the owner, open/closed status, unread count and timing.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `contact_id` | uuid | no |  |  |
| `sender_identity_id` | uuid | no |  |  |
| `channel` | text | no | 'whatsapp'::text |  |
| `status` | text | no | 'open'::text |  |
| `assignee_user_id` | uuid | yes |  |  |
| `last_inbound_at` | timestamp with time zone | yes |  |  |
| `last_outbound_at` | timestamp with time zone | yes |  |  |
| `window_expires_at` | timestamp with time zone | yes |  |  |
| `unread_count` | integer | no | 0 |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `contact_id` → `contact.id` (on delete cascade)
- `sender_identity_id` → `sender_identity.id` (on delete restrict)
- `assignee_user_id` → `app_user.id` (on delete set null)

**Indexes:**

- `conversation_contact_sender_uidx`: UNIQUE conversation USING btree (contact_id, sender_identity_id)
- `conversation_org_status_idx`: conversation USING btree (org_id, status)

**Policies:**

- `conversation_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### conversation_participant

_Inbox._ Extra people on a chat beside its owner. Participants may reply; only admins add or remove them.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `org_id` | uuid | no |  |  |
| `conversation_id` | uuid | no |  | PK |
| `user_id` | uuid | no |  | PK |
| `added_by_user_id` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `conversation_id` → `conversation.id` (on delete cascade)
- `user_id` → `app_user.id` (on delete cascade)
- `added_by_user_id` → `app_user.id` (on delete set null)

**Indexes:**

- `conversation_participant_conversation_id_user_id_pk`: UNIQUE conversation_participant USING btree (conversation_id, user_id)
- `conversation_participant_user_idx`: conversation_participant USING btree (user_id)

**Policies:**

- `conversation_participant_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### conversation_presence

_Inbox._ Who has a chat open right now, refreshed by a heartbeat every few seconds. Throwaway rows, never history.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `org_id` | uuid | no |  |  |
| `conversation_id` | uuid | no |  | PK |
| `user_id` | uuid | no |  | PK |
| `seen_at` | timestamp with time zone | no | now() |  |
| `typing_at` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `conversation_id` → `conversation.id` (on delete cascade)
- `user_id` → `app_user.id` (on delete cascade)

**Indexes:**

- `conversation_presence_conversation_id_user_id_pk`: UNIQUE conversation_presence USING btree (conversation_id, user_id)
- `conversation_presence_seen_idx`: conversation_presence USING btree (seen_at)

**Policies:**

- `conversation_presence_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### custom_field

_Contacts._ The vocabulary of extra fields an org has defined for contacts (city, experience…), with a type, so values are checked and {{city}} works in campaigns.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `key` | text | no |  |  |
| `label` | text | no |  |  |
| `type` | text | no | 'text'::text |  |
| `options` | _text[] | no | '{}'::text[] |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `custom_field_org_key_uidx`: UNIQUE custom_field USING btree (org_id, key)

**Policies:**

- `custom_field_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### import_row

_Import._ The ledger for one row of an upload: what it said, what the dry run decided, and which contact it produced.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `import_run_id` | uuid | no |  |  |
| `row_number` | integer | no |  |  |
| `outcome` | text | no |  |  |
| `contact_id` | uuid | yes |  |  |
| `error` | text | yes |  |  |
| `raw` | jsonb | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `import_run_id` → `import_run.id` (on delete cascade)
- `contact_id` → `contact.id` (on delete set null)

**Indexes:**

- `import_row_number_uidx`: UNIQUE import_row USING btree (import_run_id, row_number)
- `import_row_outcome_idx`: import_row USING btree (import_run_id, outcome)

**Policies:**

- `import_row_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### import_run

_Import._ One uploaded spreadsheet and what became of it: file hash (to refuse duplicates), counts, and whether it was committed or superseded.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `source_type` | text | no | 'csv'::text |  |
| `filename` | text | yes |  |  |
| `storage_key` | text | no |  |  |
| `sha256` | text | no |  |  |
| `byte_size` | integer | no |  |  |
| `status` | text | no | 'uploaded'::text |  |
| `row_count` | integer | no | 0 |  |
| `headers` | jsonb | yes |  |  |
| `mapping` | jsonb | yes |  |  |
| `summary` | jsonb | yes |  |  |
| `superseded_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `completed_at` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `import_run_digest_uidx`: UNIQUE import_run USING btree (org_id, sha256) WHERE (superseded_at IS NULL)
- `import_run_org_idx`: import_run USING btree (org_id, created_at)

**Policies:**

- `import_run_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### internal_note

_Inbox._ A team-only note on a thread. Kept apart from message so a note can never be sent to the customer.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `conversation_id` | uuid | no |  |  |
| `author_user_id` | uuid | yes |  |  |
| `body` | text | no |  |  |
| `mentions` | _uuid[] | no | '{}'::uuid[] |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `conversation_id` → `conversation.id` (on delete cascade)
- `author_user_id` → `app_user.id` (on delete set null)

**Indexes:**

- `internal_note_conversation_idx`: internal_note USING btree (conversation_id, created_at)

**Policies:**

- `internal_note_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### key_rotation_state

_Audit and health._ One row for the whole install: whether the background re-encryption of a key rotation is paused, and how much it has moved. Not per org, because the encryption key is not.

Row-level security: **off**.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | integer | no | 1 | PK |
| `paused` | boolean | no | false |  |
| `paused_by_user_id` | uuid | yes |  |  |
| `last_run_at` | timestamp with time zone | yes |  |  |
| `reencrypted_total` | integer | no | 0 |  |
| `last_unreadable` | integer | no | 0 |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**References:**

- `paused_by_user_id` → `app_user.id` (on delete set null)

### media_asset

_Inbox._ An attachment file: its type (decided from the file’s bytes), size and storage key. The bytes live in the storage driver, not the database.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `storage_key` | text | no |  |  |
| `storage_driver` | text | no |  |  |
| `content_type` | text | no |  |  |
| `size_bytes` | integer | no |  |  |
| `sha256` | text | no |  |  |
| `filename` | text | yes |  |  |
| `scanned_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `campaign_picture` | boolean | no | false |  |
| `gif_playback` | boolean | no | false |  |
| `source_asset_id` | uuid | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `source_asset_id` → `media_asset.id` (on delete set null)

**Indexes:**

- `media_asset_digest_idx`: media_asset USING btree (org_id, sha256)
- `media_asset_key_uidx`: UNIQUE media_asset USING btree (storage_key)

**Policies:**

- `media_asset_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### message

_Inbox._ One message in or out of a thread: encrypted body, delivery status, who sent it, optional attachment and campaign. Inserting an outbound queued row wakes the gateway.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `conversation_id` | uuid | no |  |  |
| `direction` | text | no |  |  |
| `provider_message_id` | text | yes |  |  |
| `content_type` | text | no | 'text'::text |  |
| `body_enc` | bytea | yes |  |  |
| `body_hmac` | text | yes |  |  |
| `status` | text | no | 'queued'::text |  |
| `error_code` | text | yes |  |  |
| `sent_by` | text | no | 'system'::text |  |
| `sent_by_user_id` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `sent_at` | timestamp with time zone | yes |  |  |
| `delivered_at` | timestamp with time zone | yes |  |  |
| `read_at` | timestamp with time zone | yes |  |  |
| `media_id` | uuid | yes |  |  |
| `campaign_id` | uuid | yes |  |  |
| `hold_reason` | text | yes |  |  |
| `dnc_override` | boolean | no | false |  |
| `dnc_override_reason` | text | yes |  |  |
| `media_error` | text | yes |  |  |
| `media_failed_at` | timestamp with time zone | yes |  |  |
| `retry_requests` | integer | no | 0 |  |
| `last_retry_at` | timestamp with time zone | yes |  |  |

**References:**

- `media_id` → `media_asset.id` (on delete set null)
- `org_id` → `org.id` (on delete cascade)
- `conversation_id` → `conversation.id` (on delete cascade)
- `sent_by_user_id` → `app_user.id` (on delete set null)
- `campaign_id` → `campaign.id` (on delete set null)

**Indexes:**

- `message_body_keyver_idx`: message USING btree (envelope_key_version(body_enc)) WHERE (body_enc IS NOT NULL)
- `message_conversation_idx`: message USING btree (conversation_id, created_at)
- `message_provider_id_uidx`: UNIQUE message USING btree (org_id, provider_message_id)
- `message_queued_idx`: message USING btree (created_at) WHERE ((direction = 'outbound'::text) AND (status = 'queued'::text))

**Policies:**

- `message_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

**Triggers:**

- `message_queued`: CREATE TRIGGER message_queued AFTER INSERT ON public.message FOR EACH ROW WHEN (((new.direction = 'outbound'::text) AND (new.status = 'queued'::text))) EXECUTE FUNCTION notify_gateway('send')

### org

_Workspaces and people._ A customer workspace. Every other table points back to one org, and row-level security keeps each org’s rows invisible to the rest.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `name` | text | no |  |  |
| `slug` | text | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Indexes:**

- `org_slug_unique`: UNIQUE org USING btree (slug)

**Policies:**

- `org_tenant_isolation` (ALL): (id = (current_setting('app.org_id'::text, true))::uuid)

### org_membership

_Workspaces and people._ Links a person to an org and gives them a role (admin or agent). Roles live here so one person could join several orgs later.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `user_id` | uuid | no |  |  |
| `role` | text | no | 'agent'::text |  |
| `joined_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `user_id` → `app_user.id` (on delete cascade)

**Indexes:**

- `org_membership_org_user_uidx`: UNIQUE org_membership USING btree (org_id, user_id)

**Policies:**

- `org_membership_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### segment

_Contacts._ A saved audience: a stored filter whose matching people are recomputed whenever it is used.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `kind` | text | no | 'dynamic'::text |  |
| `definition` | jsonb | no | '{}'::jsonb |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `saved` | boolean | no | true |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `segment_org_name_uidx`: UNIQUE segment USING btree (org_id, name)

**Policies:**

- `segment_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### sender_health_event

_Audit and health._ A timeline of what happened to a number’s health: restriction suspected or cleared, possible ban, recovery started.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `sender_identity_id` | uuid | no |  |  |
| `at` | timestamp with time zone | no | now() |  |
| `kind` | text | no |  |  |
| `severity` | text | no | 'info'::text |  |
| `summary` | text | no |  |  |
| `evidence` | jsonb | no | '{}'::jsonb |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `sender_identity_id` → `sender_identity.id` (on delete cascade)

**Indexes:**

- `sender_health_event_sender_idx`: sender_health_event USING btree (sender_identity_id, at)

**Policies:**

- `sender_health_event_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### sender_identity

_WhatsApp numbers._ One of your WhatsApp numbers and its reputation: warm-up stage, health score, risk band, restriction state and recovery pauses.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `provider` | text | no |  |  |
| `label` | text | no |  |  |
| `phone_e164` | text | yes |  |  |
| `owner_user_id` | uuid | yes |  |  |
| `status` | text | no | 'linking'::text |  |
| `capabilities_snapshot` | jsonb | yes |  |  |
| `health` | jsonb | no | '{}'::jsonb |  |
| `warmup_started_at` | timestamp with time zone | yes |  |  |
| `last_inbound_at` | timestamp with time zone | yes |  |  |
| `risk_score` | integer | no | 0 |  |
| `daily_cap_override` | integer | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `recovery_incident` | text | yes |  |  |
| `recovery_started_at` | timestamp with time zone | yes |  |  |
| `recovery_until` | timestamp with time zone | yes |  |  |
| `enforcement` | text | no | 'enforce'::text |  |
| `advisory_reason` | text | yes |  |  |
| `advisory_set_by` | uuid | yes |  |  |
| `advisory_set_at` | timestamp with time zone | yes |  |  |
| `advisory_bypass_count` | integer | no | 0 |  |
| `advisory_last_bypass` | text | yes |  |  |
| `restriction_state` | text | no | 'ok'::text |  |
| `restriction_since` | timestamp with time zone | yes |  |  |

**References:**

- `org_id` → `org.id` (on delete cascade)
- `owner_user_id` → `app_user.id` (on delete set null)
- `advisory_set_by` → `app_user.id` (on delete set null)

**Indexes:**

- `sender_identity_org_idx`: sender_identity USING btree (org_id)
- `sender_identity_phone_uidx`: UNIQUE sender_identity USING btree (org_id, provider, phone_e164)

**Policies:**

- `sender_identity_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

### session

_Workspaces and people._ A signed-in browser session for the web app. Looked up before the org is known, so it has no row-level security.

Row-level security: **off**.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `user_id` | uuid | no |  |  |
| `org_id` | uuid | no |  |  |
| `token_hash` | text | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `last_seen_at` | timestamp with time zone | no | now() |  |
| `ip` | text | yes |  |  |
| `user_agent` | text | yes |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `user_id` → `app_user.id` (on delete cascade)
- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `session_expires_idx`: session USING btree (expires_at)
- `session_token_hash_unique`: UNIQUE session USING btree (token_hash)
- `session_user_idx`: session USING btree (user_id)

### tag

_Contacts._ A label such as "pune" or "interview-stage". Unique per org by name.

Row-level security: on and forced.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `org_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `colour` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**References:**

- `org_id` → `org.id` (on delete cascade)

**Indexes:**

- `tag_org_name_uidx`: UNIQUE tag USING btree (org_id, name)

**Policies:**

- `tag_tenant_isolation` (ALL): (org_id = (current_setting('app.org_id'::text, true))::uuid)

## Database functions

### envelope_key_version

```sql
CREATE OR REPLACE FUNCTION public.envelope_key_version(envelope bytea)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT CASE WHEN length(envelope) >= 2 THEN get_byte(envelope, 1) END $function$
```

### notify_gateway

```sql
CREATE OR REPLACE FUNCTION public.notify_gateway()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_notify('gateway', json_build_object(
    'kind', TG_ARGV[0],
    'id',   NEW.id::text
  )::text);
  RETURN NEW;
END;
$function$
```
