# F4 · Templates

**Covers** FR-28, FR-29, FR-37 · **Tier** V1 (interactive V2/V3)

## Purpose

Reusable, versioned message content with typed variables. The old system had **no template
table at all** — bulk-send bodies were freeform text typed into a browser and never persisted,
so nothing was reusable, auditable or A/B-testable.

## Design notes

**Typed variables.** `{{first_name}}` declares a type, a default and whether it is required.
Rendering fails loudly on a missing required variable rather than sending `{{first_name}}` to
a customer.

**Template ≠ Meta template.** Our template is the internal concept; `meta_template_name` and
`meta_approval_status` link it to an approved Meta template where one exists. A Baileys-only
template needs no approval; the same content sent over Meta does. The dispatcher resolves this
from provider capabilities.

**Versioning is immutable.** Editing creates a new version. Messages reference the version
they were sent with, so reports stay truthful after an edit.

**Spintax and variation** are a template feature because the anti-ban engine needs body
variation — byte-identical bodies at volume are a ban signal (`../08-antiban.md`).

**`provider_meta jsonb`** is deliberately open so carousels, buttons, lists and Flows can be
added without a migration.

## Acceptance criteria

- **AC-1** Templates are versioned; editing creates a version and never mutates a sent message's meaning.
- **AC-2** Variables are typed and validated; rendering a template with a missing required
  variable raises an error and never sends.
- **AC-3** Preview renders against a real or sample contact before saving.
- **AC-4** Meta approval status syncs automatically and is visible; an unapproved template
  cannot be used for a Meta send outside the service window.
- **AC-5** Categories map to channel intent, which drives routing (`../04-architecture.md`).
- **AC-6** Spintax produces varied bodies, and the dispatcher refuses more than N identical
  rendered bodies in a window.
- **AC-7** Locale variants resolve by contact language with a documented fallback.

## API surface

```
GET    /api/v1/templates
POST   /api/v1/templates
GET    /api/v1/templates/{id}          ?version=
PATCH  /api/v1/templates/{id}          creates a new version
POST   /api/v1/templates/{id}/preview  {contact_id | sample_vars}
POST   /api/v1/templates/{id}/sync     push to Meta / refresh approval status
DELETE /api/v1/templates/{id}          deactivate
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-4.1 | Render with a missing required variable | Error; nothing enqueued |
| TC-4.2 | Edit a template after a campaign sent with it | Old messages still report against the old version |
| TC-4.3 | Unapproved Meta template, outside 24h window | Send rejected before the provider is called |
| TC-4.4 | Same template over Baileys, outside any window | Allowed (no approval requirement) |
| TC-4.5 | Spintax over 100 renders | Distinct bodies above the configured threshold |
| TC-4.6 | Contact with an unsupported locale | Falls back per the documented rule |
| TC-4.7 | Variable injection attempt in a value (`{{...}}` inside data) | Escaped; no recursive rendering |
