-- The key version of an encrypted value is the second byte of its envelope. Reading it with a bare
-- get_byte() throws on a value shorter than two bytes, and an index expression that can throw makes
-- an insert of one bad value fail. This returns NULL for such a value instead, so the index and the
-- re-encryption queries can never be the thing that breaks a write or a batch.
CREATE OR REPLACE FUNCTION envelope_key_version(envelope bytea) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN length(envelope) >= 2 THEN get_byte(envelope, 1) END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "message_body_keyver_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "channel_auth_state_keyver_idx";
--> statement-breakpoint
CREATE INDEX "message_body_keyver_idx" ON "message" ((envelope_key_version("body_enc"))) WHERE "body_enc" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "channel_auth_state_keyver_idx" ON "channel_auth_state" ((envelope_key_version("value_enc")));
