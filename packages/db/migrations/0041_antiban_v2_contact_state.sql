ALTER TABLE "antiban_setting" ADD COLUMN "closing_message_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "antiban_setting" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "antiban_setting" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "antiban_setting" ADD COLUMN "default_purpose" text;--> statement-breakpoint
ALTER TABLE "antiban_setting" ADD COLUMN "stop_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "antiban_setting" ADD COLUMN "restart_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "many_undelivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "many_undelivered_resumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "decrypt_wave_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "likely_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "decrypt_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "profile_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "profile_probe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "tick_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "tick_verdict" text;