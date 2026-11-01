CREATE TABLE IF NOT EXISTS "antiban_setting" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" text DEFAULT '22:00' NOT NULL,
	"quiet_hours_end" text DEFAULT '08:00' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sender_identity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "media_after_reply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "planned_gap_ms" integer;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "followup_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "timelock_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "timelock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "timelock_type" text;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_status" text;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_total_quota" integer;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_used_quota" integer;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_cycle_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_cycle_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "capping_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "linked_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "refused_463_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "planned_gap_ms" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "read_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "read_marked_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "antiban_setting" ADD CONSTRAINT "antiban_setting_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_notice" ADD CONSTRAINT "whatsapp_notice_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_notice" ADD CONSTRAINT "whatsapp_notice_sender_identity_id_sender_identity_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_notice_sender_idx" ON "whatsapp_notice" USING btree ("sender_identity_id","received_at");--> statement-breakpoint
ALTER TABLE "whatsapp_notice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_notice" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "whatsapp_notice_tenant_isolation" ON "whatsapp_notice"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_notice" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
--> statement-breakpoint
ALTER TABLE "antiban_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "antiban_setting" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "antiban_setting_tenant_isolation" ON "antiban_setting"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "antiban_setting" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
