# 35 · The database, its optimisations and its main queries

Written 2026-10-21 for Kushal's own reference. Everything here is taken from the code and the live
database; where something is **not** done yet it says so (section 5).

- **Every table, column, key, index, policy and trigger** is in the generated
  [`generated/database-reference.md`](generated/database-reference.md) (plain Markdown) and
  [`generated/schema.html`](generated/schema.html) (an interactive diagram). Regenerate both with
  `npm run db:docs` after a migration. The tables are **explained in plain words** in
  `packages/db/src/table-notes.ts`; a test (`tests/integration/table-notes.test.ts`) fails if a new
  table has no note.
- The older [`05-data-model.md`](05-data-model.md) explains why the columns exist.

## 1 · The shape in one picture

```mermaid
erDiagram
  ORG ||--o{ ORG_MEMBERSHIP : has
  APP_USER ||--o{ ORG_MEMBERSHIP : joins
  ORG ||--o{ CONTACT : owns
  CONTACT ||--o{ CONTACT_IDENTITY : "reached by"
  CONTACT ||--o{ CONTACT_TAG : carries
  TAG ||--o{ CONTACT_TAG : labels
  CONTACT ||--o{ CONVERSATION : "talks in"
  SENDER_IDENTITY ||--o{ CONVERSATION : "sends from"
  CONVERSATION ||--o{ MESSAGE : holds
  MEDIA_ASSET ||--o{ MESSAGE : "attached to"
  CAMPAIGN ||--o{ CAMPAIGN_RECIPIENT : "queue of"
  CONTACT ||--o{ CAMPAIGN_RECIPIENT : "is sent to"
  CAMPAIGN }o--|| TAG : "audience"
  CAMPAIGN }o--o| MEDIA_ASSET : "picture or GIF"
  CAMPAIGN }o--o| AI_TEMPLATE : "replies follow"
  IMPORT_RUN ||--o{ IMPORT_ROW : "ledger of"
  IMPORT_ROW }o--o| CONTACT : "created or updated"
  ORG ||--o| AI_SETTING : "AI on or off"
  ORG ||--o{ AI_TEMPLATE : saves
```

**The 32 tables, by group** (one line each; the generated reference has the rest):

| Group | Tables |
|---|---|
| Workspaces and people | `org`, `app_user`, `org_membership`, `session`, `api_key` |
| Contacts | `contact`, `contact_identity`, `tag`, `contact_tag`, `custom_field`, `segment` |
| Inbox | `conversation`, `message`, `media_asset`, `internal_note`, `canned_reply`, `conversation_participant`, `conversation_presence` |
| WhatsApp numbers | `sender_identity`, `channel_session`, `channel_auth_state` |
| Campaigns | `campaign`, `campaign_recipient`, `ai_setting`, `ai_template`, `ai_job` |
| Import | `import_run`, `import_row` |
| Audit and health | `audit_log`, `ai_run`, `key_rotation_state`, `sender_health_event` |

That is 32 tables. A person's number or email is not on `contact`: it is a row in `contact_identity`
(kinds `phone`, `email`, `wa_jid`, `wa_lid`, …), so one person can have several ways to be reached.

## 2 · How tenancy (one org never sees another) works

- Every tenant table has `org_id NOT NULL` and a **row-level-security policy**:
  `org_id = current_setting('app.org_id', true)::uuid`. 28 policies, and `FORCE ROW LEVEL SECURITY` so
  even the table owner is held to it.
- A request runs inside a transaction that does `SET LOCAL ROLE crm_app` (a restricted role with no
  `BYPASSRLS`) and `set_config('app.org_id', …)`. A query that forgets `WHERE org_id = …` returns **no
  rows** instead of someone else's. Code: `apps/api/src/tenant.ts`, `apps/gateway/src/tenant.ts`,
  `packages/db/src/security-check.ts` (it checks at boot that the role cannot bypass).
- The audit log is append-only for the app role (`REVOKE UPDATE, DELETE`).
- **Files are the exception row-level security cannot reach**: bytes live on disk (or a bucket), so
  `resolveMedia` walks media → message → conversation → org by hand, and a campaign picture is
  authorised by `media_asset.campaign_picture` for the same org (`resolveCampaignPicture`).
- Three triggers and two functions exist, all for the gateway: `notify_gateway()` fires on a queued
  message and on link or unlink requests so the gateway wakes at once (`LISTEN/NOTIFY`), and
  `envelope_key_version()` backs an index used by key rotation.

## 3 · Optimisations that are implemented

| What | Where | Why it matters |
|---|---|---|
| **One lookup per person, per org, unique.** `UNIQUE (org_id, kind, value_normalized)` on `contact_identity` | `contact_identity_lookup_uidx` | Importing or receiving a message finds the existing person in one index probe, and the database itself refuses a duplicate. Phone and email are *identities* attached to a permanent contact id, so changing a number never changes the id. |
| **Same file never stored or imported twice** (SHA-256) | `media_asset_digest_idx`, `import_run_digest_uidx` (partial, `WHERE superseded_at IS NULL`) | A CV forwarded into five chats is stored once; the same spreadsheet cannot be imported twice. |
| **Import ledger is resumable and idempotent** | `import_row_number_uidx (import_run_id, row_number)` | A killed import restarts from the last committed batch; a retried commit changes nothing twice. |
| **Campaign recipients are the queue** | `campaign_recipient_pending_idx (campaign_id, status)`, `campaign_recipient_uidx (campaign_id, contact_id)` | The gateway pulls only `pending` rows. A person can never be in one campaign twice. |
| **Safe concurrent dispatch** | `FOR UPDATE … SKIP LOCKED` in `dispatchCampaign` | Two sweeps never claim the same recipient; no waiting, no double message. |
| **Only the queued outbound messages are indexed** | `message_queued_idx (created_at) WHERE direction='outbound' AND status='queued'` | A partial index stays tiny while the table grows; the send sweep reads it directly. |
| **Thread reads in order** | `message_conversation_idx (conversation_id, created_at)` | Opening a chat is an index range scan. |
| **Provider ids are unique** | `message_provider_id_uidx (org_id, provider_message_id)` | A message WhatsApp delivers twice is stored once. |
| **One conversation per contact per number** | `conversation_contact_sender_uidx` | A campaign message lands in the existing thread, not a parallel one. |
| **Tag filtering both ways** | `contact_tag (contact_id, tag_id)` primary key + `contact_tag_tag_idx (tag_id)` | "Who has this tag" and "which tags has this person" are both indexed. |
| **Custom fields searchable** | `contact_custom_fields_gin` (GIN, `jsonb_path_ops`) | A field value (city, skill) can be searched without a table scan of the JSON. |
| **Whole-book tagging in one statement** | `bulkTag` (`INSERT … SELECT … ON CONFLICT DO NOTHING`) | Tagging 50,000 people is one set-based statement, idempotent, not 50,000 round trips. The same rule (`searchPredicate`) resolves the list, the count and the bulk action, so "what you see" is "what gets tagged". |
| **Progress in one pass** | `campaignProgress` uses `count(*) FILTER (WHERE …)` | All six status counts in one scan instead of six queries. |
| **A list page is one query, not N+1** | `GET /contacts` builds `identities` and `tags` with correlated `json_agg` subselects | 50 contacts with their numbers and tags in one round trip. |
| **Keyset paging, not offsets** | `GET /contacts?cursor=` on `created_at` | Page 500 costs the same as page 1 (newest-added order only; other orders return the first page). |
| **No per-row tag dropdowns** | one shared `<datalist id="all-tags">` on the Contacts page | The page was 5.7 MB at 50 people and 129 tags before; now it does not grow with people × tags. |
| **Encrypted bodies still searchable for duplicates** | `message.body_hmac` (a blind index from the KMS) | The identical-body anti-ban check compares HMACs without decrypting. |
| **Identical-body check cached per batch** | `identicalSeen` map in `dispatchCampaign` | A no-variation blast costs one query for the check, not one per recipient. |
| **Safe previews, small and cacheable** | `GET /media/:id/thumb`: decoded and re-encoded to 320 px WebP (`sharp`), `Cache-Control: private, max-age=3600` | Lists show pictures at a few KB each, and the original is never shown inline. |
| **GIFs are converted once, at upload** | `storeCampaignPicture` runs ffmpeg and stores the clip next to the GIF (`source_asset_id`) | Sending never waits on a conversion; every recipient gets the stored clip. |
| **Same picture, one stored copy** | the campaign picture path reuses `storeOutboundMedia`'s SHA-256 dedupe | Re-uploading the same offer image is free. |
| **Page data fetched in parallel** | `Promise.all` in the AI, Contacts and campaign pages | One wait instead of four. |
| **Generation is rate-limited per organisation** | 5 a minute in `routes/ai.ts`; description capped at 8,000 characters | Protects the model provider's limits and the bill. |
| **One AI request at a time per org** | `ai_job` queue | A slow or rate-limited model never gets several at once. |
| **Counts are separate and cheap** | `GET /contacts/count` | The bulk-tag preview and "Check how many" do not fetch rows. |

## 4 · The main queries (as they are in the code)

**Find a person by phone or email (import and inbound).** `packages/core/src/ingestion.ts`
```sql
SELECT contact_id FROM contact_identity
WHERE org_id = $1 AND kind = $2 AND value_normalized = $3 LIMIT 1;   -- unique index, one probe
```

**The contact list: search, tag, date range (added or last imported), order.** One shared rule,
`searchPredicate` in `packages/core/src/tagging.ts`, used by the list, the count and bulk tagging:
```sql
c.org_id = $org AND c.deleted_at IS NULL
AND ($q IS NULL OR c.display_name ILIKE $like
     OR EXISTS (SELECT 1 FROM jsonb_each_text(c.custom_fields) cf WHERE cf.value ILIKE $like)
     OR EXISTS (SELECT 1 FROM contact_identity ci2 WHERE ci2.contact_id = c.id AND ci2.value_normalized ILIKE $like))
AND ($tag IS NULL OR EXISTS (SELECT 1 FROM contact_tag ct2 WHERE ct2.contact_id = c.id AND ct2.tag_id = $tag))
AND (dates unset
     OR (added    AND c.created_at >= $from AND c.created_at < $to + 1)
     OR (imported AND EXISTS (SELECT 1 FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
                              WHERE ir.contact_id = c.id AND r.created_at >= $from AND r.created_at < $to + 1)))
```
Order options: `c.created_at DESC|ASC`, `lower(c.display_name) ASC`, or the latest import
(`(SELECT max(r.created_at) FROM import_row ir JOIN import_run r … WHERE ir.contact_id = c.id) DESC`).

**Tag everyone a search finds (one statement).** `bulkTag`
```sql
WITH ins AS (
  INSERT INTO contact_tag (org_id, contact_id, tag_id)
  SELECT $org, c.id, $tag FROM contact c WHERE <the same predicate>
  ON CONFLICT (contact_id, tag_id) DO NOTHING RETURNING 1)
SELECT count(*)::int FROM ins;
```

**Campaign progress.** `campaignProgress`
```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE status='pending') AS pending, count(*) FILTER (WHERE status='queued') AS queued,
       count(*) FILTER (WHERE status='sent') AS sent, count(*) FILTER (WHERE status='failed') AS failed,
       count(*) FILTER (WHERE status='skipped') AS skipped
FROM campaign_recipient WHERE campaign_id = $1 AND org_id = $2;
```

**Dispatch: turn pending recipients into queued messages (safe under concurrency).** `dispatchCampaign`
```sql
SELECT cr.id, cr.contact_id, c.display_name, c.custom_fields
FROM campaign_recipient cr JOIN contact c ON c.id = cr.contact_id AND c.org_id = cr.org_id
WHERE cr.campaign_id = $1 AND cr.org_id = $2 AND cr.status = 'pending'
ORDER BY cr.id LIMIT $limit
FOR UPDATE OF cr SKIP LOCKED;
-- then per recipient: INSERT INTO message (..., content_type, media_id) and
-- UPDATE campaign_recipient SET status='queued', message_id=... in the same transaction.
-- The campaign's picture is read once: SELECT media_asset_id FROM campaign WHERE id = $1.
```

**Find an existing identical file (pictures, attachments).** `storeOutboundMedia`
```sql
SELECT id, content_type, size_bytes FROM media_asset WHERE org_id = $1 AND sha256 = $2 LIMIT 1;
```

**Campaign pictures for "use one I uploaded before".** `listCampaignPictures`
```sql
SELECT ma.id, ma.filename, ma.content_type, ma.size_bytes, (ma.content_type='image/gif') AS gif, ma.created_at,
       (SELECT count(*) FROM campaign c WHERE c.media_asset_id = ma.id) AS uses
FROM media_asset ma WHERE ma.org_id = $1 AND ma.campaign_picture ORDER BY ma.created_at DESC LIMIT 24;
```

**Which file does a campaign message carry (a GIF sends its converted clip).** `resolveSendAsset`
```sql
SELECT ma.id, ma.content_type,
       (SELECT v.id FROM media_asset v WHERE v.source_asset_id = ma.id AND v.org_id = $2 AND v.gif_playback LIMIT 1) AS clip_id
FROM media_asset ma WHERE ma.id = $1 AND ma.org_id = $2;
```

**AI templates.** `packages/core/src/ai-templates.ts`
```sql
SELECT id, name, description, instructions, audience, first_message, use_count, last_used_at, updated_at
FROM ai_template WHERE org_id = $1 ORDER BY last_used_at DESC NULLS LAST, updated_at DESC LIMIT 200;   -- ai_template_org_used_idx
UPDATE ai_template SET use_count = use_count + 1, last_used_at = now() WHERE id = $1 AND org_id = $2;
```

## 5 · Known gaps, so nobody assumes they are done

These are **not** implemented; each is cheap to add when the data gets big.

| Gap | Effect | Fix when it matters |
|---|---|---|
| No index on `contact (org_id, created_at DESC)` | The newest-first contact list sorts after filtering by `contact_org_idx (org_id)`. Fine at thousands, slower at hundreds of thousands. | `CREATE INDEX ON contact (org_id, created_at DESC) WHERE deleted_at IS NULL` |
| No index on `import_row (contact_id)` | "Last imported" order and the imported-date filter read all import rows. | `CREATE INDEX ON import_row (contact_id)` |
| Search uses `ILIKE '%…%'` | Cannot use a normal index; it scans the org's contacts. | `pg_trgm` GIN index on `display_name` and `value_normalized` |
| Contact list paging by cursor only for "newest first" | Other orders show the first 50. | Keyset on the chosen order, or offset for small books |
| No index on `message (campaign_id)` | Campaign-level message queries scan by conversation. | Add if campaign pages get slow |
| Generation rate limit is in memory, per API process | Resets on restart; not shared across two API processes. | Move the counter into Postgres or Redis when there are two API hosts |
| `ai_template` is not yet linked to chats | Only campaigns carry `ai_template_id` so far (D-85, P4 pending). | Add `conversation.ai_template_id` |

## 6 · How to refresh this

```bash
npm run db:docs          # rewrites docs/generated/schema.html and docs/generated/database-reference.md from the live database
```
Run it after `npm run db:migrate`. A new table needs a note in `packages/db/src/table-notes.ts`.
