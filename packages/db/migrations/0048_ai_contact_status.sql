ALTER TABLE "campaign_recipient" ADD COLUMN "ai_status" text;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "ai_status_at" timestamp with time zone;