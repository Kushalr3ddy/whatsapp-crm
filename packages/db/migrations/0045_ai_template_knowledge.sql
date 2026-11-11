ALTER TABLE "ai_template" ADD COLUMN "knowledge" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "sensitive" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "fallback_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "fallback_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "visible_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "audience_targets" jsonb;--> statement-breakpoint
ALTER TABLE "ai_template" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_template" ADD CONSTRAINT "ai_template_fallback_user_id_app_user_id_fk" FOREIGN KEY ("fallback_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
