CREATE TABLE IF NOT EXISTS "sender_health_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sender_identity_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "restriction_state" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "restriction_since" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sender_health_event" ADD CONSTRAINT "sender_health_event_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sender_health_event" ADD CONSTRAINT "sender_health_event_sender_identity_id_sender_identity_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sender_health_event_sender_idx" ON "sender_health_event" USING btree ("sender_identity_id","at");--> statement-breakpoint
ALTER TABLE "sender_health_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sender_health_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sender_health_event_tenant_isolation" ON "sender_health_event"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "sender_health_event" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
