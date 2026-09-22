# 07 · Data ingestion framework

Feature-level view in [`06-features/F7-ingestion.md`](06-features/F7-ingestion.md).
This is the framework design.

## Goal

Adding a new kind of data source means **writing one class**, not touching the core.

## The port

```ts
/** One kind of place data can come from. Implement this to add a source type. */
interface SourceConnector {
  /** Stable identifier used in `data_source.type` and in config. */
  readonly type: string;

  /** Zod schema for this connector's config — the settings UI is generated from it. */
  readonly configSchema: ZodSchema;

  /** Cheap credential and reachability check, run before anything is scheduled. */
  test(config: SourceConfig): Promise<TestResult>;

  /** Field names plus sample rows, so the mapping UI is built from fact, not guesswork. */
  discover(config: SourceConfig): Promise<SchemaDescriptor>;

  /** Streams records. Streaming, never array-returning — a 2 GB file must not be buffered. */
  read(config: SourceConfig, cursor?: string): AsyncIterable<RawRecord>;
}
```

Connectors shipped in v1: `excel`, `csv`, `gsheets`, `rest`, `webhook`, `jsonl`.
V2: `database` (JDBC-style pull), `s3-folder`, CRM connectors.

## The pipeline

```
Extract   stream records from the connector
   ↓
Map       declarative field_mapping (versioned, reusable)
   ↓
Transform small allowlisted expression set — trim, phone_e164, date_parse(locale),
          split, lower, lookup, concat.  NEVER eval, never arbitrary code.
   ↓
Validate  Zod per target field. Failures become import_row errors; they do not abort.
   ↓
Resolve   ordered identity rules → existing contact or new
   ↓
Merge     per-field merge_policy from contact_field_def
   ↓
Load      batched upsert, 500 rows per transaction
   ↓
Report    per-row outcome in import_row; summary counts on import_run
```

## The same file must not import twice — and the name is not the file

**Requirement, 2026-09-22.** Re-importing a spreadsheet that has already been imported must be
refused, or recognised as a re-run, **regardless of what it is called**. `contacts.xlsx`,
`contacts (1).xlsx` and `contacts-final-FINAL.xlsx` are one file; `contacts.xlsx` exported
again tomorrow with three new rows is a different one. A filename answers neither question.

**Content hash, not filename, not size, not modified time.** Hash the bytes on upload —
`sha256` over the stored file, the same way `media_asset` already does for attachments — and
store it on `import_run` with a unique index per org. A second upload of identical bytes finds
the existing run.

Three consequences worth settling now rather than discovering later:

| Question | Answer |
|---|---|
| Re-upload of identical bytes | **Refuse with a pointer to the original run**, not a silent success. "Already imported on 12 March as run #41, 812 rows" is useful; a duplicate-but-fine is how a double import gets noticed a week later |
| Same content, different org | Different import. Hashes are scoped per org — cross-tenant dedup would leak the existence of one tenant's file into another's |
| Deliberate re-import | An explicit `force` flag. It exists because the legitimate case is real — a mapping was wrong and the run is being redone — and because without it people rename the file to get past the check, which defeats the whole mechanism |

**Hashing the file is not the same as deduplicating rows**, and both are needed. Two different
files usually overlap: yesterday's export and today's share 800 of 803 rows. That is what the
identity-resolution and merge stages below are for — the file hash stops the *whole file* being
processed twice, and identity rules stop the same *person* becoming two contacts. Neither
replaces the other. The previous system had neither, which is how one candidate became several
contacts (M8).

Hash the bytes **as received**, before any parsing. A spreadsheet re-saved by Excel without any
edit will hash differently, and that is acceptable: it is a genuinely different file, and the
row-level identity rules catch the overlap.

### Not every source is a file, and the hash does not fit all of them

The connectors listed above split into two shapes, and they need **different** duplicate
protection. Conflating them is how a live sheet either re-imports forever or stops syncing.

| Source | Shape | What stops a duplicate |
|---|---|---|
| `csv` `excel` `jsonl` | A file someone uploads | **Content hash**, as above. Built for `csv` |
| `s3-folder` | Files, discovered rather than uploaded | Content hash, per object |
| `gsheets` | A live document that changes under you | **Cursor**, not a hash. Hashing works only to skip an *unchanged* sheet; once a cell moves the hash is new while 900 rows are not |
| `rest` | A paginated pull | **Cursor** — `updated_since`, or the provider's page token |
| `webhook` | Records pushed one at a time | **Per-record idempotency key**. There is no file to hash, and the same record will legitimately arrive twice |
| `database` | A query against someone's schema | Cursor on a monotonic column |

**Two layers, and both are always needed.** The file hash stops the *whole file* being
processed twice. Identity resolution stops the same *person* becoming two contacts — and that
one applies to every source, including the ones with no hash at all, because yesterday's export
and today's overlap by 800 of 803 rows. Neither replaces the other.

So a live source that has no hash is not unprotected: it re-reads rows, and identity resolution
recognises the people. What it loses is the cheap "nothing has changed, skip the whole thing"
answer, which is what a cursor buys back.

**For a webhook specifically**, the idempotency key is the sender's record id carried on an
`external` identity — the same mechanism `message.provider_message_id` already uses to make a
redelivered WhatsApp notification a no-op at the database level rather than in application code
where it could race.

## The specific fixes

### Server-side only (M3)
`POST /imports` stores the file via the storage driver and returns an `import_run` id. The
browser then posts only a mapping. Nothing round-trips through the client, so there is no
`express.json({limit:'50mb'})` and no 50 MB POST.

### Mandatory dry run
The UI will not let a user commit without a dry run first. It shows:

```
2,431 rows read
  1,204 would create
    986 would update   ← 312 of these would overwrite a non-empty field
    198 would skip     (already identical)
     43 errors         (download to inspect)

sample overwrite:  Priya S. · company  "Acme Corp" → "Acme"  (policy: fill_if_empty ⇒ kept)
```

This preview is what makes M9 — a sparse file silently destroying richer data — impossible to
hit by accident rather than merely discouraged.

### Identity resolution is explicit
Not `email OR phone`. An ordered, individually toggleable rule list:

```yaml
identity_rules:
  - { kind: external, field: external_id }   # tried first
  - { kind: phone,    field: mobile }
  - { kind: email,    field: email }
  - { composite: [name, company] }           # last resort, off by default
```

First rule to match wins. **Empty values never match anything** — enforced by the
`CHECK` on `contact_identity` (M7).

### Phone normalisation is not optional (M8)
`libphonenumber-js` to E.164, with a per-source `default_country`. Unparseable values become
a row error with the original preserved in `import_row.raw`, never a silently stored string.

### Per-row error ledger (M4)
Every row writes an `import_row`. A run **always completes**. Failed rows are downloadable as
a spreadsheet with an appended `_error` column — fix and re-upload just those.

`UNIQUE (import_run_id, row_number)` makes a killed worker resumable from the last committed
batch rather than restartable from zero.

### Presets, not hardcoded maps
The old system hardcoded one job board's column names into `columnAliasMap`, including
question text like `"what is your current CTC in lacs per annum"`. Useful knowledge, wrong
place. Here those ship as **editable mapping presets** a user can apply, inspect and change.

### Scheduled syncs
Repeatable jobs with cursor-based incremental reads, per-source concurrency limits, and
overlap protection (a run still in flight defers the next rather than running concurrently —
which is what the old system's advisory lock was really trying to say, M28).

## Mapping format

```yaml
version: 3
target: contact
default_country: IN
fields:
  display_name:   { from: "Full Name", transform: [trim] }
  identities:
    - { kind: phone, from: "Mobile", transform: [trim, phone_e164] }
    - { kind: email, from: "Email",  transform: [trim, lower] }
  custom_fields:
    notice_period: { from: "Notice Period", transform: [trim] }
    current_ctc:   { from: "Current CTC",   transform: [parse_money] }
  tags:
    - { literal: "imported-2026-09" }
unmapped: keep          # keep | drop  — kept columns land in import_row.raw only
on_error: record        # record | skip — never `abort`
```

`unmapped: keep` preserves the raw row for inspection without inventing columns — the old
system stored every full row as JSON in a parallel table that grew without bound.

## Writing a new connector

1. Implement `SourceConnector` in `packages/ingestion/connectors/<type>/`.
2. Define `configSchema` — the settings form is generated from it.
3. Register it. No core change, no route change, no UI change.
4. It must pass the shared `SourceConnector` contract suite, which asserts: `test()` fails
   cleanly on bad credentials, `discover()` returns stable field names, `read()` streams
   without buffering, cursors resume exactly, and cancellation is honoured mid-stream.

## Security

- Every user-supplied URL (REST source, webhook target) is **SSRF-guarded**: private ranges,
  link-local and cloud metadata IPs denied, redirects re-checked at each hop.
- Uploaded files are validated by magic bytes, not extension, with a size cap, and are
  optionally scanned when `SCANNER_DRIVER` is configured.
- Formula injection: CSV/XLSX exports prefix `= + - @` so a downloaded file cannot execute in
  a spreadsheet. Imported values are never evaluated.
- Credentials for a source are stored via the secrets driver, never in `data_source.config`.
