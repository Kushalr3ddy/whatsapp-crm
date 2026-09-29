CREATE TABLE IF NOT EXISTS "contact_tag" (
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tag_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tag" ADD CONSTRAINT "tag_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_tag_tag_idx" ON "contact_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tag_org_name_uidx" ON "tag" USING btree ("org_id","name");--> statement-breakpoint
ALTER TABLE "tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tag" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tag_tenant_isolation" ON "tag"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "contact_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_tag" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contact_tag_tenant_isolation" ON "contact_tag"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "tag", "contact_tag" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;