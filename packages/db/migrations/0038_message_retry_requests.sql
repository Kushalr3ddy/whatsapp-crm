ALTER TABLE "channel_session" ADD COLUMN "own_decrypt_burst_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "retry_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "last_retry_at" timestamp with time zone;