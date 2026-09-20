-- The audit log: an append-only record of every state change.
--
-- Three things below that drizzle does not generate, and that the table is not worth having
-- without.

CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" USING btree ("action");
--> statement-breakpoint
-- 1. Tenant isolation, like every other org-scoped table.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint

-- 2. Append-only, enforced rather than described.
--
-- Without this, "append-only" is a comment. The application role may INSERT and SELECT and
-- nothing else, so a compromised application cannot rewrite history to cover its tracks —
-- which is the single property that makes an audit log worth keeping.
--
-- Note what this does NOT cover: the table owner, and anyone with direct database access.
-- An audit log in the same database as the data it describes can always be edited by whoever
-- holds the database. Defending against that needs append-only storage somewhere else, and is
-- out of scope here (docs/21-deferred.md, D-13).
--
-- The retention job needs DELETE and therefore cannot run as this role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE UPDATE, DELETE ON "audit_log" FROM "crm_app";
    GRANT SELECT, INSERT ON "audit_log" TO "crm_app";
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'could not restrict audit_log to append-only for crm_app; it may be connecting as the table owner, which bypasses this.';
END $$;--> statement-breakpoint

-- 3. A guard against the one mistake that silently ruins an audit trail.
--
-- `at` must record when something happened, not when a backfill ran. A row dated in the
-- future is always a bug — a clock problem or a caller passing its own timestamp — and is
-- worth refusing loudly rather than storing.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_at_not_future"
  CHECK ("at" <= now() + interval '1 minute');
