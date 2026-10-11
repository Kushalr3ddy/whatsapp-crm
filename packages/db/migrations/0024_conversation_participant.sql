CREATE TABLE IF NOT EXISTS "conversation_participant" (
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participant_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_added_by_user_id_app_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_participant_user_idx" ON "conversation_participant" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "conversation_participant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_participant" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversation_participant_tenant_isolation" ON "conversation_participant"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation_participant" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
