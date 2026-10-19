ALTER TABLE "message" ADD COLUMN "media_error" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "media_failed_at" timestamp with time zone;