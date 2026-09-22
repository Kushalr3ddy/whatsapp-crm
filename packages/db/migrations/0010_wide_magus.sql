CREATE TABLE IF NOT EXISTS "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"contact_id" uuid,
	"error" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_type" text DEFAULT 'csv' NOT NULL,
	"filename" text,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"headers" jsonb,
	"mapping" jsonb,
	"summary" jsonb,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_row" ADD CONSTRAINT "import_row_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_row" ADD CONSTRAINT "import_row_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_run" ADD CONSTRAINT "import_run_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_row_number_uidx" ON "import_row" USING btree ("import_run_id","row_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_row_outcome_idx" ON "import_row" USING btree ("import_run_id","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_run_digest_uidx" ON "import_run" USING btree ("org_id","sha256") WHERE superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_run_org_idx" ON "import_run" USING btree ("org_id","created_at");
--> statement-breakpoint
--------------------------------------------------------------------------------
-- Tenant isolation for imports.
--
-- An import_run names a file in storage and an import_row holds a copy of somebody's personal
-- data as it arrived. Both are as sensitive as the contacts they produce, so both are scoped
-- like every other tenant table.
--------------------------------------------------------------------------------
ALTER TABLE "import_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_run_tenant_isolation" ON "import_run"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint

ALTER TABLE "import_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_row" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_row_tenant_isolation" ON "import_row"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "import_run", "import_row" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
