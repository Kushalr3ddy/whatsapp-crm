ALTER TABLE "antiban_setting" ADD COLUMN "recent_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "recent_days" integer;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "leave_out_recent" boolean DEFAULT false NOT NULL;