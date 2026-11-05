-- The old anti-ban engine is removed. Data first, so nothing it was holding stays held, then the columns it owned.
--
-- A number the engine had degraded or quarantined is simply active: those states no longer exist.
UPDATE "sender_identity" SET "status" = 'active', "updated_at" = now() WHERE "status" IN ('degraded', 'quarantined');--> statement-breakpoint
-- A queued message held by one of the engine's gates is released and goes out in the next sweep. `sender_not_connected` is not
-- the engine's and stays.
UPDATE "message" SET "hold_reason" = NULL
WHERE "status" = 'queued'
  AND ("hold_reason" IN ('quarantined', 'recipient_hours') OR "hold_reason" LIKE 'recovery_pause%' OR "hold_reason" LIKE 'paced:%');--> statement-breakpoint
-- A campaign the detector paused stays paused, for a person to resume: only the reason it shows goes. `ban_suspected` and
-- `unlinked` are not the engine's and stay.
UPDATE "campaign" SET "pause_reason" = NULL, "updated_at" = now() WHERE "pause_reason" LIKE 'restriction%';--> statement-breakpoint
-- The timeline keeps only what the connection handling still writes.
DELETE FROM "sender_health_event" WHERE "kind" NOT IN ('forbidden_suspected', 'hard_ban_suspected', 'unlinked_on_phone');--> statement-breakpoint
ALTER TABLE "sender_identity" DROP CONSTRAINT "sender_identity_advisory_set_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_session" DROP COLUMN IF EXISTS "disconnect_code";--> statement-breakpoint
ALTER TABLE "channel_session" DROP COLUMN IF EXISTS "reconnect_attempts";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "health";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "warmup_started_at";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "last_inbound_at";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "risk_score";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "daily_cap_override";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "recovery_incident";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "recovery_started_at";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "recovery_until";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "enforcement";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "advisory_reason";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "advisory_set_by";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "advisory_set_at";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "advisory_bypass_count";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "restriction_state";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "restriction_since";--> statement-breakpoint
ALTER TABLE "sender_identity" DROP COLUMN IF EXISTS "advisory_last_bypass";--> statement-breakpoint
COMMENT ON TABLE "sender_identity" IS 'One of OUR numbers. Not a "session": a session is one connection to it.';--> statement-breakpoint
COMMENT ON COLUMN "sender_identity"."status" IS 'linking | active | retired | removed. The lifecycle of the number; whether it is connected right now is channel_session.connection_state.';
