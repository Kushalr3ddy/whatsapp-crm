# F11 · Admin & settings

**Covers** FR-67, FR-68, FR-69 · **Fixes** M15, M16, M17, M19 · **Tier** V1

## Purpose

Everything an operator configures, and everything they need to see when something is wrong.

## Scope

### Users, roles, permissions
Invite, deactivate, reassign. Roles carry scopes; authorisation is one central layer, never
per-route ad-hoc checks — the old system let any recruiter edit any job description because
the check simply was not there.

With `AUTH_DRIVER=oidc`, authentication is delegated to an external IdP but **authorisation
stays local**: external claims map onto internal roles, so the permission model is identical
either way (`../18-providers.md`).

### Branding
Product name, logo, colours, favicon, sender display name — all configuration. The old system
hardcoded "Hiring Studios" into every page title and the AI prompt, which is exactly the kind
of thing that makes software un-reusable.

### Messaging policy
Quiet hours, timezone, cooldown windows, opt-out keywords, locale packs, routing rules. What decides
how fast a number sends is the anti-ban policy (`../08-antiban.md`), not an admin setting.

### Data & retention
Retention windows per data class, hard-delete job schedule, per-contact data export and delete
(the mechanism for any "remove/give me my data" request, whatever regime requires it), export of
all org data.

### Providers — `GET /admin/providers`
Which driver is active for each port, its health, and its last error. This exists so an
operator can see that email is misconfigured *before* a password reset silently fails.

### Audit log viewer
Filter by actor, action, target, date. Read-only; append-only underneath.

## Acceptance criteria

- **AC-1** Authorisation is enforced in one layer; an authz matrix test covers every role
  against every endpoint.
- **AC-2** Branding is fully configurable with no code change and no rebuild.
- **AC-3** Config is schema-validated at boot; a missing required value is a hard crash with a
  readable message, never a silent fallback (M17).
- **AC-4** No endpoint exposes database schema or internal structure (M15).
- **AC-5** Admin actions are audited with before/after state.
- **AC-6** Never-overridable safety limits are not editable through any admin surface, and a
  test asserts no code path exists.
- **AC-7** Retention jobs delete on schedule and write a summary audit row.
- **AC-8** Per-contact data export returns everything held about a person; delete removes it and
  is irreversible. (Serves any jurisdiction's access/erasure request; the product mandates none.)
- **AC-9** Seed and fixture data is synthetic; a CI scan fails on PII-shaped content (M19).

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-11.1 | Every role × every endpoint | Matches the documented matrix exactly |
| TC-11.2 | Boot with a required secret missing | Process exits non-zero with a clear message (M17) |
| TC-11.3 | Admin attempts to raise a daily cap above the safety ceiling | Rejected; no path exists |
| TC-11.4 | Change branding | Applied without restart |
| TC-11.5 | Retention window passes | Data deleted; audit summary row written |
| TC-11.6 | Per-contact delete | Contact data gone; references nulled, not orphaned |
| TC-11.7 | Non-admin hits an admin endpoint | 403; attempt audited |
| TC-11.8 | Break the email driver, open `/admin/providers` | Shows unhealthy with the last error |
