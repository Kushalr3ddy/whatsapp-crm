CREATE TABLE IF NOT EXISTS "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"storage_driver" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"filename" text,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "media_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_asset_key_uidx" ON "media_asset" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_asset_digest_idx" ON "media_asset" USING btree ("org_id","sha256");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
--------------------------------------------------------------------------------
-- Tenant isolation for stored attachments.
--
-- This protects the ROW. It does not protect the bytes: the file lives on a filesystem
-- Postgres cannot reach, so nothing here stops a process that already has the storage key
-- from reading it. That is why keys are random and unguessable, and why every download
-- resolves through this table rather than trusting a path (docs/21-deferred.md, D-11).
--------------------------------------------------------------------------------
ALTER TABLE "media_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_asset" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "media_asset_tenant_isolation" ON "media_asset"
  USING ("org_id" = current_setting('app.org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "media_asset" TO "crm_app";
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'crm_app role absent or not grantable; skipping grant (see migration 0001)';
END
$$;
