ALTER TABLE "channel_session" ADD COLUMN "link_requested_mode" text;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "link_requested_phone" text;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "link_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "link_challenge" jsonb;--> statement-breakpoint
ALTER TABLE "channel_session" ADD COLUMN "link_error" text;--> statement-breakpoint
-- The command channel between the API and the gateway.
--
-- A durable table plus NOTIFY, rather than a message broker. Durable because a send must
-- survive the gateway being down — the row stays `queued` and is swept on boot. NOTIFY on top
-- so the normal case is instant rather than waiting for the next poll. This is what a
-- Postgres-only deployment should use, and it needs no extra service (docs/13-deployment.md).
CREATE OR REPLACE FUNCTION notify_gateway() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('gateway', json_build_object(
    'kind', TG_ARGV[0],
    'id',   NEW.id::text
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Fires when the API asks for a number to be linked.
CREATE TRIGGER channel_session_link_requested
  AFTER INSERT OR UPDATE OF link_requested_at ON "channel_session"
  FOR EACH ROW WHEN (NEW.link_requested_at IS NOT NULL AND NEW.link_challenge IS NULL)
  EXECUTE FUNCTION notify_gateway('link');
--> statement-breakpoint

-- Fires when the API queues an outbound message.
CREATE TRIGGER message_queued
  AFTER INSERT ON "message"
  FOR EACH ROW WHEN (NEW.direction = 'outbound' AND NEW.status = 'queued')
  EXECUTE FUNCTION notify_gateway('send');
--> statement-breakpoint

-- The gateway's boot sweep: find work left behind while it was down.
CREATE INDEX "message_queued_idx" ON "message" ("created_at")
  WHERE "direction" = 'outbound' AND "status" = 'queued';
