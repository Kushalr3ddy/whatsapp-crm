CREATE TABLE IF NOT EXISTS "ai_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid,
	"campaign_id" uuid,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_setting" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"daily_message_cap" integer DEFAULT 200 NOT NULL,
	"consent_accepted_at" timestamp with time zone,
	"consent_accepted_by" uuid,
	"bot_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_setting" ADD CONSTRAINT "ai_setting_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_setting" ADD CONSTRAINT "ai_setting_consent_accepted_by_app_user_id_fk" FOREIGN KEY ("consent_accepted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_setting" ADD CONSTRAINT "ai_setting_bot_user_id_app_user_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_org_created_idx" ON "ai_run" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_conversation_idx" ON "ai_run" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "ai_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_setting" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_setting_tenant_isolation" ON "ai_setting"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_setting" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
--> statement-breakpoint
ALTER TABLE "ai_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_run_tenant_isolation" ON "ai_run"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_run" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
