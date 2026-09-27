# 25 · Ingestion in depth — sources, deduping, and testing it by hand

Where contacts come from, how the same thing is prevented from arriving twice, and how to prove
any of it yourself months from now when none of it is fresh.

[07 · Ingestion](07-ingestion.md) is the design and the rationale. **This document is the
operator's half**: what each source actually does, what protects it from duplicates, and the
commands to try it.

> **Status, stated once so nothing here misleads you.**
> **Built:** CSV **and Excel (.xlsx)** upload → dry run → commit, content-hash dedup, identity
> resolution, per-row ledger, and a web **Import tab** with a simple column mapping
> (pick phone/name/email).
> **Not built:** Google Sheets, REST, database, webhooks, scheduled syncs, and the **full**
> mapping wizard (transforms, multiple identities, saved mappings — **D-21**) with row-level
> diff-style dedup (**D-22**). Each section below marks which it is. The ✅ sections you can run
> today; the ⬜ sections are the design to build against.

---

## 1 · The shape of the thing

Every source, built or planned, funnels into the same pipeline. Only the leftmost box differs.

```
  SOURCES                    ONE PIPELINE                        RESULT
  ────────                   ───────────────────────────         ──────

  ✅ csv    ─┐
  ⬜ excel  ─┤
  ⬜ jsonl  ─┤   ┌──────────┐                                  ┌──────────┐
  ⬜ s3     ─┼──▶│ EXTRACT  │  rows out of whatever it is      │ contact  │
             │   └────┬─────┘                                  │          │
  ⬜ gsheets─┤        ▼                                         │ contact_ │
  ⬜ rest   ─┤   ┌──────────┐                                  │ identity │
  ⬜ database┤   │   MAP    │  your columns → our fields       └──────────┘
             │   └────┬─────┘                                       ▲
  ⬜ webhook─┘        ▼                                              │
                 ┌──────────┐                                        │
                 │TRANSFORM │  trim · lower · upper · digits          │
                 └────┬─────┘  (an allowlist — never eval)            │
                      ▼                                               │
                 ┌──────────┐                                         │
                 │ VALIDATE │  phone → E.164, email shape             │
                 └────┬─────┘  a bad row becomes an error, not a stop │
                      ▼                                               │
                 ┌──────────┐                                         │
                 │ RESOLVE  │  is this person already here?  ─────────┘
                 └────┬─────┘  ordered rules, first match wins
                      ▼
                 ┌──────────┐
                 │  LOAD    │  create or update, 500 rows per transaction
                 └────┬─────┘
                      ▼
                 ┌──────────┐
                 │  LEDGER  │  one import_row per row. ALWAYS.
                 └──────────┘
```

**The pipeline never aborts.** A row with an unparseable phone number becomes one error row and
the other 49,999 still import. That is deliberate and it is the difference between this and the
system it replaces, where the first bad row killed the run (M4).

---

## 2 · Deduping: two layers, and you need both

This is the part worth understanding properly, because "don't import the same thing twice" is
actually two different questions with two different answers.

```
        THE SAME FILE                          THE SAME PERSON
        ─────────────                          ───────────────

   contacts.csv    ─┐                    "Priya, 9876500001"   ─┐
   contacts (1).csv ┼─ same bytes        "Priya, +91 98765 00001"┼─ same human
   contacts-FINAL   ─┘                   "Priya, 09876500001"   ─┘

           │                                       │
           ▼                                       ▼
   ┌───────────────┐                       ┌───────────────┐
   │ LAYER 1       │                       │ LAYER 2       │
   │ content hash  │                       │ identity      │
   │ (sha256)      │                       │ resolution    │
   └───────┬───────┘                       └───────┬───────┘
           │                                       │
   "this exact FILE has                    "this exact PERSON is
    already been processed"                 already a contact"
           │                                       │
           ▼                                       ▼
     409 ALREADY_IMPORTED                   outcome: updated
     (with the original run id)             (not a second contact)
```

### Layer 1 — the file (✅ built, CSV)

`sha256` over the **raw bytes**, before any parsing, stored on `import_run` with a **partial**
unique index per org.

- The **name is irrelevant.** `contacts.csv`, `contacts (1).csv` and `contacts-FINAL-v2.csv`
  are one file if the bytes match.
- **One more row makes it a different file**, and it imports normally. That is correct —
  tomorrow's export genuinely is a new file.
- **Scoped per org.** Two tenants uploading the same public spreadsheet is not a duplicate;
  cross-tenant dedup would leak the existence of one tenant's file into another's.
- **Re-saving in Excel changes the hash** even with no edit. Also correct, and harmless: layer
  2 catches the overlap.
- A repeat is **refused with a pointer**, not silently accepted — a duplicate-but-fine is how a
  double import gets noticed a week later, after everyone has been messaged.

Why the index is *partial*: `?force=true` exists for the legitimate re-import (the mapping was
wrong, you are redoing it). Without a force flag people rename the file to get past the check,
which defeats the whole mechanism. But a plain unique index would then refuse the upload the
API had just decided to allow. So a forced re-import **supersedes** the previous run
(`superseded_at`), and the invariant becomes the one actually wanted: *at most one **live** run
per file per org*.

### Layer 2 — the person (✅ built)

Ordered identity rules, **first match wins**. Deliberately not "email OR phone", which cannot
say which one is authoritative when they disagree.

```
  row: { Full Name: "Priya Sharma", Mobile: "09876500001", Email: "PRIYA@Example.com" }

  rule 1: phone  from "Mobile"   ──▶ normalise ──▶ +919876500001 ──▶ look up
                                                                      │
                                                      found? ─── yes ─┤──▶ UPDATE this contact
                                                                      │      (stop — first
                                                                      no     match wins)
                                                                      ▼
  rule 2: email  from "Email"    ──▶ lower ──────▶ priya@example.com ──▶ look up
                                                                      │
                                                      found? ─── no ──┴──▶ CREATE a contact
```

Three rules that make it trustworthy:

1. **Phone normalisation happens on the way in**, never later. `9876500001`, `+91 98765 00001`
   and `09876500001` all become `+919876500001`, so they are one contact. The previous system
   had this function and did not call it on import, which is how one person became several (M8).
2. **Empty never matches.** A blank cell must not resolve to "the contact with no phone" — it is
   skipped as a rule, and if *every* identity column is empty the row is an error.
3. **A sparse file never overwrites richer data.** A blank name will not replace a real one
   (M9). Richer per-field merge policies arrive with `contact_field_def`; fill-if-empty is the
   safe default until then.

### Why both layers, always

Layer 1 without layer 2: yesterday's export and today's share 800 of 803 rows, and every one of
those 800 people gets duplicated.

Layer 2 without layer 1: correct, but you re-process 50,000 rows to discover nothing changed.

**A source with no layer 1 is not unprotected** — it is just slower and noisier. That matters
below, because half the planned sources cannot have a file hash at all.

---

## 3 · The sources, one at a time

### 3.1 `csv` — ✅ built

The only one that runs today. Three steps on purpose.

```
   POST /imports              POST /imports/:id/run          POST /imports/:id/run
   Content-Type: text/csv     { mapping, dryRun: true }      { mapping, dryRun: false }
        │                             │                               │
        ▼                             ▼                               ▼
   store + hash              count what WOULD happen          actually write
   parse headers             write NO contacts                 contacts + identities
        │                             │                               │
        ▼                             ▼                               ▼
   201 { id, headers,        200 { read, created,            200 { ..., dryRun: false }
         sample, sha256 }          updated, errors }          status: committed
```

**The file never round-trips through the browser.** It is uploaded once, and the mapping — a
small JSON object — is what gets posted afterwards. That is why there is no 50 MB JSON body
limit anywhere in this API (M3).

**Dry run is the default.** Omit `dryRun` and you get a preview. A commit has to be asked for.

Limits: 20 MB, `Content-Type: text/csv` or `text/plain`.

### 3.2 `excel` — ⬜ not built

Same shape as CSV in every respect that matters: it is a file, so **layer 1 is the content
hash**, identically.

The only real work is parsing, and it needs **a dependency** (`xlsx` or `exceljs`) — which is a
deliberate decision rather than an oversight. The CSV reader is hand-written because the RFC
4180 grammar is small and fully specified; the XLSX format is a zip of XML parts with shared
string tables, styles and a date system, and hand-writing that would be reckless.

Two gotchas that will bite whoever builds it:

- **Excel dates are numbers.** `45678` is a date serial, and there are two epochs (1900 and
  1904). Getting this wrong silently shifts every date by four years.
- **A phone number is not a number.** Excel will happily hand you `9.8765e9` or strip a leading
  zero. Read cells as **text** wherever an identity column is involved, or normalisation gets
  a corrupted value and layer 2 stops recognising people.

### 3.3 `gsheets` — ⬜ not built

**This is the first one where the content hash stops being the right answer**, and it is worth
understanding why before you build it.

```
      A FILE                           A LIVE SHEET
      ──────                           ────────────

  uploaded once                   changes under you, continuously
  bytes are final                 someone is typing in it right now
       │                                   │
       ▼                                   ▼
  hash is stable                  hash changes when ANY cell moves
       │                                   │
       ▼                                   ▼
  "same file?" is                 "same file?" is almost always NO,
  a useful question               while 900 of 903 rows are unchanged
```

Hashing a fetched snapshot is not *useless* — it answers "has this sheet changed at all since I
last looked?", which is a cheap way to skip a no-op sync. But it cannot answer "which rows are
new", and that is the question a scheduled sync needs.

**Use a cursor.** Options, in order of preference:

| Cursor | How | Caveat |
|---|---|---|
| A `Last Modified` column the sheet maintains | `updated_since` | Relies on whoever owns the sheet not breaking it |
| Drive API `modifiedTime` on the file | Skip the whole pull when unchanged | Whole-file granularity only |
| Row count + hash of each row | Detect new and changed rows | Costs a full read every time |

**In practice: snapshot hash to skip an unchanged sheet, per-row identity resolution for
everything else.** Layer 2 does the heavy lifting here, and that is fine — it is what it is for.

Auth: a service account with the sheet shared to it. Store the credential through the
`SecretsDriver` port (⬜, D-9), never in a config column.

### 3.4 `rest` — ⬜ not built

A paginated pull from somebody else's API. No file, so **no layer 1 at all**.

```
   GET /candidates?updated_since=2026-09-22T10:00:00Z&page=1
        │
        ▼
   ┌─────────────┐   more pages?   ┌─────────────┐
   │  page 1     │────── yes ─────▶│  page 2     │─── … ──▶ done
   └──────┬──────┘                 └─────────────┘            │
          │ rows                                              ▼
          ▼                                            save the cursor
   into the pipeline                             (high-water mark or page token)
```

**The cursor is the whole design.** Two kinds, and they fail differently:

- **High-water mark** (`updated_since`): simple, and **loses records** if the source's clock
  skews or it writes rows with an older timestamp after you have moved past. Always re-read a
  small overlap window — a minute or two — and let layer 2 absorb the repeats.
- **Page token**: exact, but opaque and usually expires. Fine within a run, useless as a
  durable cursor between runs.

**Overlap protection matters more than it sounds.** A run still in flight must defer the next
rather than running concurrently — two concurrent pulls with the same cursor process the same
rows twice. The old system used an advisory lock for this, which was the right instinct in the
wrong place (M28).

### 3.5 `database` — ⬜ not built

A query against someone else's schema. Structurally identical to `rest`: cursor on a monotonic
column (`updated_at`, or an auto-increment id).

**The extra hazard here is the query itself.** It is somebody's production database:

- Read-only credentials, always. Not "we promise to only select".
- A statement timeout, so a bad join cannot pin their database.
- `LIMIT` + cursor, never `SELECT *` from a large table in one go.
- Never interpolate anything into the SQL. This is the identifier-allowlist rule from
  [09 · Security](09-security.md), and a source connector is exactly where it gets forgotten.

### 3.6 `webhook` — ⬜ not built

Records pushed to us one at a time. **No file, and no cursor either** — there is nothing to
paginate.

```
   POST /ingest/:sourceId              │  the same record WILL arrive twice
   X-Signature: sha256=…               │  — senders retry on timeout, and
   { "id": "cand_8812", … }            │  you cannot ask them not to
           │
           ▼
   verify HMAC ──── bad ──▶ 401, and do not tell them why
           │
           ▼
   idempotency key = the sender's own record id
           │
           ├── seen before? ──▶ 200 OK, do nothing (NOT an error)
           │
           ▼
   into the pipeline as an `external` identity
```

**The idempotency key is the sender's record id, carried as an `external` identity.** This is
exactly the mechanism `message.provider_message_id` already uses: `UNIQUE (org_id,
provider_message_id)` makes a redelivered WhatsApp notification a no-op **at the database
level** rather than in application code where it could race. Copy that, do not invent something
new.

**A duplicate delivery is a success, not an error.** Return 200. A sender that gets a 4xx for a
retry will usually retry harder.

**Verify the signature before parsing the body**, and compare in constant time. An unsigned
webhook endpoint is an open write path into your contact database.

### 3.7 Summary

| Source | Layer 1 (whole batch) | Layer 2 (per person) | Built |
|---|---|---|---|
| `csv` | content hash | identity rules | ✅ |
| `excel` | content hash | identity rules | ⬜ |
| `jsonl` | content hash | identity rules | ⬜ |
| `s3-folder` | content hash per object | identity rules | ⬜ |
| `gsheets` | snapshot hash *(skip-if-unchanged only)* | identity rules | ⬜ |
| `rest` | **none** — cursor | identity rules | ⬜ |
| `database` | **none** — cursor | identity rules | ⬜ |
| `webhook` | **none** — per-record idempotency key | identity rules | ⬜ |

**Layer 2 is the only column with no gaps.** That is not an accident — it is why identity
resolution is in the shared pipeline rather than in each connector.

---

## 4 · Test it yourself, by hand

Everything here runs today against the CSV path. Start the stack first:

```bash
npm run dev:all --no-web
```

Get a key with `contacts:read` and `contacts:write` — see
[24 · Testing it by hand](24-local-testing.md#get-a-credential) — and keep it in `$KEY`.

### 4.1 Make a file with problems in it

Deliberately including the things that go wrong, because a file that imports cleanly proves
very little:

```bash
cat > /tmp/candidates.csv <<'CSV'
Full Name,Mobile,Email
Priya Sharma,9876500001,PRIYA@Example.com
Rahul Verma,+91 98765 00002,rahul@example.com
Anita Desai,09876500003,anita@example.com
Broken Row,not-a-phone,broken@example.com
No Identity,,
CSV
```

Five rows: three good with the **same number written three different ways**, one unparseable
phone, one with nothing to identify anybody by.

### 4.2 Upload it

```bash
curl -s -X POST "localhost:3000/api/v1/imports?filename=candidates.csv" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: text/csv' \
  --data-binary @/tmp/candidates.csv | jq
```

You get back an `id`, the `sha256`, the `headers`, and a three-row `sample` — the sample is
there so a mapping is built from what the file actually contains rather than guesswork.

```bash
RUN=<the id from above>
```

### 4.3 Try to upload it again — this is the dedup check

```bash
# Same bytes, different name. Must be refused.
curl -s -X POST "localhost:3000/api/v1/imports?filename=candidates%20(1).csv" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: text/csv' \
  --data-binary @/tmp/candidates.csv | jq '{code, detail, previousRunId}'
```

**409 `ALREADY_IMPORTED`**, naming the original run. Now prove the name really is irrelevant and
the content really is not:

```bash
# Add one row → a genuinely different file → accepted.
echo 'Vikram Rao,9876500004,vikram@example.com' >> /tmp/candidates.csv
curl -s -X POST "localhost:3000/api/v1/imports" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: text/csv' --data-binary @/tmp/candidates.csv | jq '.data.rowCount'
```

And the deliberate re-import:

```bash
curl -s -X POST "localhost:3000/api/v1/imports?force=true" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: text/csv' --data-binary @/tmp/candidates.csv | jq '.data.reimportOf'
```

`reimportOf` names the run this one supersedes.

### 4.4 Dry run — look before you commit

```bash
curl -s -X POST "localhost:3000/api/v1/imports/$RUN/run" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{
    "dryRun": true,
    "mapping": {
      "version": 1,
      "displayName": { "from": "Full Name", "transform": ["trim"] },
      "identities": [
        { "kind": "phone", "from": "Mobile", "transform": ["trim"] },
        { "kind": "email", "from": "Email",  "transform": ["trim", "lower"] }
      ],
      "defaultCountry": "IN",
      "unmapped": "keep"
    }
  }' | jq
```

Expect `{ read: 5, created: 3, errors: 2, dryRun: true }` — and **zero contacts written**:

```bash
npm run db:query "SELECT count(*) FROM contact"
```

### 4.5 Commit, and check the normalisation

Same request with `"dryRun": false`. Then the thing actually worth checking:

```bash
npm run db:query \
  "SELECT value_normalized FROM contact_identity WHERE kind='phone' ORDER BY 1"
```

Three numbers written three ways, one format out. **That is layer 2 working** — without it those
three become three contacts, and later three conversations with the same person.

### 4.6 Read the error ledger

```bash
curl -s "localhost:3000/api/v1/imports/$RUN" -H "Authorization: Bearer $KEY" \
  | jq '.data.errors'
```

Two rows, each with `rowNumber`, a readable `error`, and `raw` — the original values, so the
row can be fixed and re-uploaded **without the original file**.

Every row gets a ledger entry, not just failures:

```bash
npm run db:query "SELECT outcome, count(*) FROM import_row GROUP BY outcome"
```

### 4.7 Prove the same person is not duplicated

```bash
cat > /tmp/overlap.csv <<'CSV'
Full Name,Mobile,Email
Priya Sharma,+919876500001,priya.sharma@example.com
Brand New,9876500099,new@example.com
CSV
```

Upload and commit it. Expect **`created: 1`, `updated: 1`** — Priya is recognised from her
number even though it is written differently and her email has changed, and only the genuinely
new person is created.

### 4.8 Check the trail

```bash
npm run db:query \
  "SELECT action, target_id FROM audit_log WHERE action LIKE 'import%' ORDER BY at"
```

`import.uploaded`, then `import.dry_run`, then `import.committed`. Storing somebody's
spreadsheet and changing the contact database are different acts and are recorded separately.

---

## 5 · When something looks wrong

| Symptom | Almost certainly |
|---|---|
| `409 ALREADY_IMPORTED` on a file you changed | You changed the *name*, not the bytes. The hash is the identity |
| Everything is an error: "no usable identity" | The mapping's `from` names do not match the headers. Check `headers` in the upload response — a byte-order mark or trailing space is the usual culprit |
| `created` is far higher than expected | Identity resolution is not matching. Check normalisation: is `defaultCountry` right for the file? |
| Rows silently missing | Blank lines are skipped by design. Compare `rowCount` from the upload against your spreadsheet's row count minus the header |
| `422 MALFORMED_CSV` | An unterminated quote, usually from a value containing a `"` that was not doubled. The error names the line |
| Import succeeded, contacts absent | It was a dry run. That is the default — pass `"dryRun": false` |
| `409 ALREADY_COMMITTED` | A run commits once. Upload the file again (with `?force=true`) to re-run it |

---

## 6 · What to build next, in order

1. **`excel`** — same dedup, same pipeline, needs an xlsx parser dependency. The most asked for.
2. **`POST /contacts`** — not a file at all, but it is how JobPortal pushes one candidate over
   HTTP, and `contacts:write` already exists as an enforceable scope with nothing behind it.
3. **`webhook`** — the same push, generalised, with HMAC and idempotency.
4. **The `SourceConnector` port and its contract suite** — worth doing once there are three
   sources, not before. Two implementations do not prove an abstraction.
5. **Scheduled syncs** — cursors, overlap protection, per-source concurrency. Needs the
   `QueueDriver` port (⬜).
