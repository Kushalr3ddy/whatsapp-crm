CREATE TABLE IF NOT EXISTS "segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'dynamic' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "from_segment_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segment" ADD CONSTRAINT "segment_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "segment_org_name_uidx" ON "segment" USING btree ("org_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign" ADD CONSTRAINT "campaign_from_segment_id_segment_id_fk" FOREIGN KEY ("from_segment_id") REFERENCES "public"."segment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Tenant isolation for the new table, hand-added after generation (drizzle-kit does not emit RLS),
-- matching every other tenant table (migration 0014 for the pattern).
ALTER TABLE "segment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "segment_tenant_isolation" ON "segment"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "segment" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
