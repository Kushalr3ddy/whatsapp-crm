ALTER TABLE "campaign" ADD COLUMN "gate_overrides" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "gate_override_reason" text;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "enforcement" text DEFAULT 'enforce' NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "advisory_reason" text;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "advisory_set_by" uuid;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "advisory_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "advisory_bypass_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "advisory_last_bypass" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sender_identity" ADD CONSTRAINT "sender_identity_advisory_set_by_app_user_id_fk" FOREIGN KEY ("advisory_set_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
