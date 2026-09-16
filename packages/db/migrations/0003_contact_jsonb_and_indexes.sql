-- Two Postgres gotchas here, neither of which drizzle-kit generates for you:
--   1. text -> jsonb has no automatic cast, so USING is required.
--   2. the column's DEFAULT can't be cast either, so it must be dropped first and
--      re-set afterwards. Doing it in the other order fails with a confusing message
--      that names the column rather than the default.
-- Safe as written because the table is empty. On a populated table this needs a validity
-- check first: a single malformed row would abort the whole migration.
ALTER TABLE "contact" ALTER COLUMN "custom_fields" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "custom_fields" SET DATA TYPE jsonb
  USING COALESCE(NULLIF("custom_fields", ''), '{}')::jsonb;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "custom_fields" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "external_ref" SET DATA TYPE jsonb
  USING NULLIF("external_ref", '')::jsonb;
--> statement-breakpoint
-- Index choices below were measured, not assumed — see docs/05-data-model.md § Indexing.
-- On 200k rows, finding one contact by external id: seq scan 116ms · GIN jsonb_ops 2.0ms ·
-- GIN jsonb_path_ops 0.48ms · B-tree expression 0.09ms, in half the space.

-- custom_fields: GIN is correct HERE because users define their own fields, so we cannot
-- know in advance which key will be filtered on. jsonb_path_ops rather than the default
-- jsonb_ops: it only supports @> containment, which is all we query, and is smaller and
-- roughly 4x faster for it.
CREATE INDEX "contact_custom_fields_gin"
  ON "contact" USING GIN ("custom_fields" jsonb_path_ops);
--> statement-breakpoint

-- external_ref: a plain B-tree on the ONE expression we always query, NOT GIN. Every host
-- app sync looks this up the same way, so GIN's generality would be pure cost — it indexes
-- every key in the document to serve a fixed access pattern.
CREATE INDEX "contact_external_ref_id_idx"
  ON "contact" (("external_ref" ->> 'id'))
  WHERE "external_ref" IS NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN contact.custom_fields IS 'Everything business-specific, shaped by contact_field_def. jsonb + GIN(jsonb_path_ops) so arbitrary user-defined keys are filterable. This column is why the schema stays generic.';
--> statement-breakpoint
COMMENT ON COLUMN contact.external_ref IS '{system, id} pointing at whoever owns this person as a domain object (e.g. the job portal candidate id). B-tree indexed on ->>''id'' rather than GIN: the access pattern is fixed, so a single-expression index is ~5x faster and half the size.';
