ALTER TABLE "message" ADD COLUMN "dnc_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "dnc_override_reason" text;