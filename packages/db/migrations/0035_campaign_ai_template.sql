ALTER TABLE "campaign" ADD COLUMN "ai_template_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ai_template_id_ai_template_id_fk" FOREIGN KEY ("ai_template_id") REFERENCES "public"."ai_template"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
