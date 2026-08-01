-- Notes and Release Notes on a portfolio item.
--
-- Two of the sections the Work Item detail page shows and the Portfolio detail page could
-- not, and the only two of that set that need no structural change: `work_items` already
-- carries the identical pair (`notes`, `release_notes`, schema/work.ts:151-152), so this is
-- the same column on a second table rather than a new concept.
--
-- Nullable with no default, matching `work_items`: an empty rich-text field is absent, not
-- an empty string, and the API distinguishes "not supplied" from "cleared".
--
-- The remaining sections — Attachments, Linked Items, Comments, Tags, Watching — are NOT
-- fixable this way. Each hangs off a table keyed by a plain `work_item_id` column
-- (`comments`, `work_item_attachments`, `work_item_labels`, `work_item_watchers`,
-- `work_item_relations`), so giving a portfolio item any of them means making that table
-- polymorphic on `(entity_type, entity_id)` — the shape `activity_logs` already uses in
-- this schema — and migrating the existing rows and every query that reads them. That is a
-- change to a working feature, so it is deliberately not bundled here.

ALTER TABLE "work"."portfolio_items"
  ADD COLUMN "notes" text,
  ADD COLUMN "release_notes" text;
