CREATE TABLE IF NOT EXISTS "key_rotation_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_by_user_id" uuid,
	"last_run_at" timestamp with time zone,
	"reencrypted_total" integer DEFAULT 0 NOT NULL,
	"last_unreadable" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "key_rotation_state" ADD CONSTRAINT "key_rotation_state_paused_by_user_id_app_user_id_fk" FOREIGN KEY ("paused_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "key_rotation_state" ADD CONSTRAINT "key_rotation_state_singleton" CHECK ("id" = 1);--> statement-breakpoint
INSERT INTO "key_rotation_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Lets "which rows are still on an old key" be answered without scanning every message: the second
-- byte of every envelope is the key version that wrote it.
CREATE INDEX IF NOT EXISTS "message_body_keyver_idx" ON "message" ((get_byte("body_enc", 1))) WHERE "body_enc" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_auth_state_keyver_idx" ON "channel_auth_state" ((get_byte("value_enc", 1)));--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE ON "key_rotation_state" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
