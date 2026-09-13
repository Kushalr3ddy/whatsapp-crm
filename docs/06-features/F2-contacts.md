# F2 · Contacts & identity

**Covers** FR-1…FR-9 · **Fixes** M7, M8, M9 · **Tier** V1

## Purpose

Hold people, generically. This module is where "the CRM is not an ATS" is either true or
false — it has no domain fields, only user-defined ones.

## User stories

- As a user I add custom fields that suit my business, and the UI adapts.
- As a user I find a contact by any identifier they have ever used.
- As a user I merge two records that turn out to be the same person, seeing first exactly
  what would be overwritten.
- As a user I mark someone do-not-contact and be certain nothing reaches them again.
- As a developer I link a CRM contact to my own system's record and keep them in sync.

## Design notes

**Identity is a separate table.** `contact_identity` is unique on
`(org_id, kind, value_normalized)` with a `CHECK` rejecting empty values — so the old
`lower(email) = lower('')` bug that merged unrelated people (M7) cannot be written.

**Normalisation is mandatory, not optional.** E.164 at write time via `libphonenumber-js`.
The old system had a normaliser and never called it on the import path (M8); here it is
enforced at the database layer by a generated column feeding the unique index.

**Merge policy is declared per field** on `contact_field_def` — `overwrite`,
`fill_if_empty` (default), `never`, `append`. This is M9's fix: a sparse import can no longer
silently destroy richer data.

**`external_ref` is how a host app stays the system of record** — see
`../16-integration-jobportal.md`.

## Acceptance criteria

- **AC-1** A contact supports arbitrary user-defined fields with types, validation and a merge
  policy; the UI is generated from the definitions.
- **AC-2** One contact may hold many identities; inbound resolution is always identity→contact.
- **AC-3** Phone values are stored E.164 with a per-source default country; unparseable values
  are rejected with a clear error, never silently stored.
- **AC-4** Creating a second identity with the same normalised value fails at the database.
- **AC-5** Merge shows a field-by-field preview of the result before committing, and is audited
  and reversible for 30 days.
- **AC-6** `do_not_contact` is checked by the dispatcher as gate zero and cannot be overridden
  by anyone, including an admin.
- **AC-7** Consent is recorded per purpose with source, evidence, IP and timestamp.
- **AC-8** Dynamic segments re-evaluate on read with a cached count, and are consistent with
  what a campaign actually targets.

## API surface

```
GET    /api/v1/contacts            filter, search, cursor paginate
POST   /api/v1/contacts            upsert semantics via identity rules
GET    /api/v1/contacts/{id}
PATCH  /api/v1/contacts/{id}
DELETE /api/v1/contacts/{id}       soft delete
POST   /api/v1/contacts/{id}/identities
POST   /api/v1/contacts/merge      {winner_id, loser_id, field_resolutions}
POST   /api/v1/contacts/{id}/dnc   {reason}
GET    /api/v1/contacts/{id}/consent
POST   /api/v1/contacts/{id}/consent
GET    /api/v1/fields              contact_field_def CRUD
GET    /api/v1/segments            + POST /segments/{id}/preview
GET    /api/v1/tags
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-2.1 | Create two contacts, blank email on both | Both exist; no merge (M7 regression test) |
| TC-2.2 | `+91 98765 43210`, `9876543210`, `919876543210` | All resolve to one contact |
| TC-2.3 | Unparseable phone on import | Row error with a readable reason; nothing stored |
| TC-2.4 | Insert duplicate identity | DB constraint violation, surfaced as a 409 |
| TC-2.5 | Merge preview vs commit | Committed result matches the preview exactly |
| TC-2.6 | Field with `merge_policy: never`, import tries to change it | Value unchanged; row reported as partially skipped |
| TC-2.7 | `do_not_contact` set, admin forces a campaign send | Blocked, with `skip_reason: dnc`; no override path exists |
| TC-2.8 | Dynamic segment count vs campaign recipient count | Identical at the same instant |
| TC-2.9 | Cross-org read of another org's contact id | 404, not 403 (no existence leak) |
