ALTER TABLE "sender_identity" ADD COLUMN "recovery_incident" text;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "recovery_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD COLUMN "recovery_until" timestamp with time zone;