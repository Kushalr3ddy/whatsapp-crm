-- Tenant isolation and the identity constraints, from the first release.
--
-- Both of these are deliberately enforced by the database rather than by application code.
-- The previous system enforced equivalent rules in JavaScript, in several places, and they
-- disagreed with each other (docs/00-prior-art.md, M7, M8, M23).

--------------------------------------------------------------------------------
-- 1. An identity value can never be blank.
--
-- This is the M7 fix made structural. The old dedup ran
--     WHERE lower(email) = lower($1) OR phone = $2
-- with '' passed for a missing value, so every contact with a blank email matched every
-- other contact with a blank email, silently merging unrelated people. With this CHECK in
-- place, a blank identity cannot be stored, so it cannot be matched on — the bug is not
-- merely discouraged, it is unwritable.
--------------------------------------------------------------------------------
ALTER TABLE "contact_identity"
  ADD CONSTRAINT "contact_identity_value_not_blank"
  CHECK (btrim("value_normalized") <> '');

-- Identity kinds we understand. A typo'd kind would otherwise create a silent second
-- namespace that nothing ever matches against.
ALTER TABLE "contact_identity"
  ADD CONSTRAINT "contact_identity_kind_known"
  CHECK ("kind" IN ('phone', 'email', 'wa_jid', 'wa_lid', 'telegram', 'external'));

--------------------------------------------------------------------------------
-- 2. Row-level security, on every tenant table, from migration one.
--
-- Single-tenant deployments have exactly one org row, so this changes nothing visible —
-- which is the point. The isolation path is identical in both modes and therefore actually
-- exercised, instead of being a thing that gets bolted on later and tested never.
--
-- The application sets the tenant per transaction with
--     SET LOCAL app.org_id = '<uuid>'
-- so a query that forgets its org filter returns nothing rather than returning everything.
-- A missing WHERE clause becomes an empty result, not a data leak.
--------------------------------------------------------------------------------

-- `contact` and `contact_identity` carry org_id directly.
ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_tenant_isolation" ON "contact"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);

ALTER TABLE "contact_identity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_identity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_identity_tenant_isolation" ON "contact_identity"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);

ALTER TABLE "org_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_membership_tenant_isolation" ON "org_membership"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);

-- `org` is scoped by its own id rather than an org_id column.
ALTER TABLE "org" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_tenant_isolation" ON "org"
  USING ("id" = current_setting('app.org_id', true)::uuid);

-- `app_user` is deliberately NOT tenant-scoped: a person may belong to several orgs, and
-- authentication has to find them before any org context exists. What a user can *see* is
-- decided by org_membership, which is scoped above.

--------------------------------------------------------------------------------
-- 3. A role that cannot bypass the policies.
--
-- Table owners and superusers bypass RLS unless FORCE is set, which is why FORCE appears
-- above. Migrations run as the owner; the application should connect as this role in any
-- deployment where the two can be separated.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE "crm_app" NOLOGIN;
  END IF;

  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "crm_app";
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "crm_app"';

EXCEPTION WHEN insufficient_privilege THEN
  -- Managed Postgres providers (Supabase, Neon, Aiven, RDS) do not always let you create
  -- roles. That must not abort the migration — the schema is still correct without it.
  --
  -- What is lost: the app then connects as the table owner, and a SUPERUSER OR TABLE OWNER
  -- BYPASSES ROW-LEVEL SECURITY. Tenant isolation silently stops being enforced while the
  -- policies still look enabled in pg_tables. Fine for a single-tenant deployment or a dev
  -- database; not fine for multi-tenant production. See docs/13-deployment.md.
  RAISE WARNING 'could not create the crm_app role (insufficient privilege). The schema is fine, but the application will connect as the table owner, which BYPASSES row-level security. Acceptable for dev or single-tenant; create the role manually before running multi-tenant.';
END
$$;
