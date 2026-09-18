CREATE TABLE IF NOT EXISTS "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"sender_identity_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"window_expires_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"provider_message_id" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"body_enc" "bytea",
	"body_hmac" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"sent_by" text DEFAULT 'system' NOT NULL,
	"sent_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_sender_identity_id_sender_identity_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identity"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assignee_user_id_app_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_sent_by_user_id_app_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_contact_sender_uidx" ON "conversation" USING btree ("contact_id","sender_identity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_status_idx" ON "conversation" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_provider_id_uidx" ON "message" USING btree ("org_id","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversation_tenant_isolation" ON "conversation"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_tenant_isolation" ON "message"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation", "message" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;--> statement-breakpoint
COMMENT ON COLUMN message.provider_message_id IS 'WhatsApp''s own id. UNIQUE per org — this is what makes delivery idempotent, since WhatsApp retries notifications for up to 7 days and a duplicate must become a no-op at the database level.';
