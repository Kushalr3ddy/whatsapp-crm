ALTER TABLE "campaign" ADD COLUMN "media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "campaign_picture" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "gif_playback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "source_asset_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign" ADD CONSTRAINT "campaign_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_source_asset_id_media_asset_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
