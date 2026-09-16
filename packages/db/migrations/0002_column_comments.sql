-- Column documentation, stored in the database rather than only in docs/05-data-model.md.
--
-- `\d+ contact` in psql shows these, and so does every GUI tool. The point is that someone
-- inspecting the schema directly gets the reasoning without having to find the repo — and
-- that the explanation cannot drift out of the database the way a separate file can.

COMMENT ON TABLE  org IS 'A tenant. Single-tenant deployments have exactly one row; the isolation path is identical either way, which keeps it exercised.';
COMMENT ON COLUMN org.id IS 'Tenant identity. Referenced by org_id everywhere and by every RLS policy.';
COMMENT ON COLUMN org.slug IS 'URL-safe short name for subdomains and API paths. Unique because it is addressable.';

COMMENT ON TABLE  app_user IS 'Someone who signs in. Deliberately NOT tenant-scoped: one person may belong to several orgs, and authentication must find them before any org context exists.';
COMMENT ON COLUMN app_user.password_hash IS 'Argon2id hash. NULL when an external identity provider authenticates them (AUTH_DRIVER=oidc) — no password ever exists here in that mode.';
COMMENT ON COLUMN app_user.status IS 'active | disabled. Disabling preserves history instead of deleting the row and orphaning every audit reference.';
COMMENT ON COLUMN app_user.last_login_at IS 'Supports dormant-account alerts, and helps date a compromise.';

COMMENT ON TABLE  org_membership IS 'Binds a user to an org with a role. The role lives here, not on the user, so one person can be an admin in one org and an agent in another with no schema change.';
COMMENT ON COLUMN org_membership.role IS 'admin | agent. Drives the central authorisation layer; never checked ad-hoc per route.';

COMMENT ON TABLE  contact IS 'A person the org talks to. Carries NO domain fields — no candidate, no customer, no patient. That absence is what stops this becoming an ATS.';
COMMENT ON COLUMN contact.display_name IS 'Nullable: an inbound message can arrive from a number with no name attached, so a contact exists before you know who it is.';
COMMENT ON COLUMN contact.custom_fields IS 'Everything business-specific, shaped by contact_field_def. This column is why the schema stays generic.';
COMMENT ON COLUMN contact.external_ref IS '{system, id} pointing at whoever owns this person as a domain object (e.g. the job portal candidate id). First rule in identity resolution during import.';
COMMENT ON COLUMN contact.do_not_contact IS 'Gate zero on every send path. Overridable by nobody, including an admin — it protects a phone number''s reputation as much as a legal position.';
COMMENT ON COLUMN contact.dnc_reason IS 'replied_stop | manual | complaint. Distinguishes the contact''s own choice from an operator decision.';
COMMENT ON COLUMN contact.last_inbound_at IS 'Last message FROM them. Feeds the reply-ratio calculation, the strongest ban-risk signal (docs/08-antiban.md).';
COMMENT ON COLUMN contact.last_outbound_at IS 'Last message TO them. Drives the cooldown gate.';
COMMENT ON COLUMN contact.deleted_at IS 'Soft delete. Conversations and messages reference contacts, so a hard delete would orphan history.';

COMMENT ON TABLE  contact_identity IS 'One way of reaching a contact. A contact has many; inbound resolution always goes identity -> contact, never a scan of contact.';
COMMENT ON COLUMN contact_identity.kind IS 'phone | email | wa_jid | wa_lid | telegram | external. CHECK-constrained: a typo''d kind would create a silent second namespace nothing ever matches against.';
COMMENT ON COLUMN contact_identity.value_normalized IS 'Canonical form — E.164 for phones, lowercased for email. A CHECK makes blank unstorable, so a blank value can never be matched on. The old dedup passed empty strings and silently merged unrelated people.';
COMMENT ON COLUMN contact_identity.is_primary IS 'Which identity to prefer when several exist for one kind.';
COMMENT ON COLUMN contact_identity.verified_at IS 'When ownership was confirmed (inbound message, clicked link). Unverified identities are weaker evidence when merging.';
