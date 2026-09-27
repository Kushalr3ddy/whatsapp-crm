ALTER TABLE "channel_session" ADD COLUMN "unlink_requested_at" timestamp with time zone;--> statement-breakpoint
-- Fires when the API asks for a number to be unlinked. Reuses notify_gateway (migration 0006),
-- which sends the channel_session id under the given kind; the gateway looks the sender up from it.
CREATE TRIGGER channel_session_unlink_requested
  AFTER INSERT OR UPDATE OF unlink_requested_at ON "channel_session"
  FOR EACH ROW WHEN (NEW.unlink_requested_at IS NOT NULL)
  EXECUTE FUNCTION notify_gateway('unlink');