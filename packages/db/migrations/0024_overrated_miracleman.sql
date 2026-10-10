ALTER TABLE "org" ADD COLUMN "billing_status" text DEFAULT 'exempt' NOT NULL;--> statement-breakpoint
ALTER TABLE "org" ADD COLUMN "billing_note" text;