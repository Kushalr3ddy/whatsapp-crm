ALTER TABLE "ai_run" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "ai_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_template_id_ai_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ai_template"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
