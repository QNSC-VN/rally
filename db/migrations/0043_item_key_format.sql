-- 0043: Reformat item keys to the product UI/UX convention — type prefix + hyphen,
-- with no zero-padding (e.g. US000042 → US-42, DE000001 → DE-1, TA000003 → TA-3).
-- This matches the mockups / SRS FormattedID style (US-4821, FE-318) that the app
-- surfaces in the backlog, boards and detail views.
--
-- The generator (ProjectsService.generateItemKey) now emits `${prefix}-${seq}`.
-- The per-type project counter (work.project_counters.last_item_number) stores the
-- numeric sequence and is format-agnostic, so only the display key changes here;
-- counters are intentionally left untouched.
--
-- Idempotent: only rows still in the legacy zero-padded form (^[A-Z]+[0-9]+$) are
-- rewritten. Already-hyphenated keys (US-42) do not match the guard and are skipped,
-- so re-running this migration is a no-op.

UPDATE "work"."work_items"
SET "item_key" = regexp_replace("item_key", '^([A-Z]+)0*([0-9]+)$', '\1-\2')
WHERE "item_key" ~ '^[A-Z]+[0-9]+$';
--> statement-breakpoint
UPDATE "work"."tasks"
SET "item_key" = regexp_replace("item_key", '^([A-Z]+)0*([0-9]+)$', '\1-\2')
WHERE "item_key" ~ '^[A-Z]+[0-9]+$';
