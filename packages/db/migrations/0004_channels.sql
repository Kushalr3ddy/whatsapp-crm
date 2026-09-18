CREATE TABLE IF NOT EXISTS "channel_auth_state" (
	"sender_identity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_enc" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_auth_state_sender_identity_id_key_pk" PRIMARY KEY("sender_identity_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_identity_id" uuid NOT NULL,
	"connection_state" text DEFAULT 'closed' NOT NULL,
	"last_connected_at" timestamp with time zone,
	"disconnect_reason" text,
	"disconnect_code" integer,
	"reconnect_attempts" integer DEFAULT 0 NOT NULL,
	"qr_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sender_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"phone_e164" text,
	"owner_user_id" uuid,
	"status" text DEFAULT 'linking' NOT NULL,
	"capabilities_snapshot" jsonb,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warmup_started_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"daily_cap_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_auth_state" ADD CONSTRAINT "channel_auth_state_sender_identity_id_sender_identity_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_session" ADD CONSTRAINT "channel_session_sender_identity_id_sender_identity_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sender_identity" ADD CONSTRAINT "sender_identity_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sender_identity" ADD CONSTRAINT "sender_identity_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_session_sender_uidx" ON "channel_session" USING btree ("sender_identity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sender_identity_org_idx" ON "sender_identity" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sender_identity_phone_uidx" ON "sender_identity" USING btree ("org_id","provider","phone_e164");--> statement-breakpoint
-- Tenant isolation, on the same terms as every other tenant table (docs/09-security.md).
-- channel_session and channel_auth_state reach their tenant through sender_identity rather
-- than carrying org_id themselves: they are strictly owned by one sender and have no meaning
-- apart from it, so an EXISTS against the parent is the honest expression of that.
ALTER TABLE "sender_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sender_identity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sender_identity_tenant_isolation" ON "sender_identity"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "channel_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_session" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "channel_session_tenant_isolation" ON "channel_session"
  USING (EXISTS (SELECT 1 FROM "sender_identity" s
                 WHERE s.id = "channel_session"."sender_identity_id"
                   AND s.org_id = current_setting('app.org_id', true)::uuid));
--> statement-breakpoint

ALTER TABLE "channel_auth_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_auth_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "channel_auth_state_tenant_isolation" ON "channel_auth_state"
  USING (EXISTS (SELECT 1 FROM "sender_identity" s
                 WHERE s.id = "channel_auth_state"."sender_identity_id"
                   AND s.org_id = current_setting('app.org_id', true)::uuid));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "sender_identity", "channel_session", "channel_auth_state" TO "crm_app";
--> statement-breakpoint

COMMENT ON TABLE sender_identity IS 'One of OUR numbers and its accumulated reputation. Not a "session" — a session is one connection to it. Conflating the two is why the previous system''s send caps counted the wrong thing.';
--> statement-breakpoint
COMMENT ON COLUMN sender_identity.status IS 'linking | active | degraded | quarantined | retired. quarantined is the anti-ban engine''s emergency brake; retired is a dead number kept so history still resolves.';
--> statement-breakpoint
COMMENT ON COLUMN sender_identity.warmup_started_at IS 'When the send-rate ramp began. Drives the day-N ceiling (20, 36, 65, 117...). Reset after 72h of inactivity — see docs/08-antiban.md.';
--> statement-breakpoint
COMMENT ON COLUMN sender_identity.risk_score IS '0-100, summed from send_risk_event. >=60 auto-pauses campaigns on this sender; >=85 quarantines it.';
--> statement-breakpoint
COMMENT ON COLUMN sender_identity.daily_cap_override IS 'Lets an admin LOWER the daily cap. Cannot raise it above the safety ceiling — no code path exists to do so.';
--> statement-breakpoint
COMMENT ON TABLE channel_auth_state IS 'WhatsApp credentials, one row per key, encrypted. The reason a restart does not cost you every linked number, and why a database restore brings the numbers back with it.';
