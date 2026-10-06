CREATE TABLE IF NOT EXISTS "custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "hold_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_org_key_uidx" ON "custom_field" USING btree ("org_id","key");--> statement-breakpoint
ALTER TABLE "custom_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "custom_field_tenant_isolation" ON "custom_field"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
