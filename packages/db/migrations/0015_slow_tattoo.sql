ALTER TABLE "campaign" ADD COLUMN "from_tag_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign" ADD CONSTRAINT "campaign_from_tag_id_tag_id_fk" FOREIGN KEY ("from_tag_id") REFERENCES "public"."tag"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
