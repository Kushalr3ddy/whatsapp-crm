ALTER TABLE "campaign_recipient" ADD COLUMN "opening_enc" "bytea";--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "opening_tries" integer DEFAULT 0 NOT NULL;