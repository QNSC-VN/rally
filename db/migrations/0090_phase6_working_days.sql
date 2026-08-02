-- ============================================================================
-- Migration 0090: workspace_settings.working_days — the Burndown x-axis calendar
-- ============================================================================
-- The Iteration Burndown SRS §2 says "the approved chart renders the configured
-- working-day calendar" and IB-BR-03 indexes the Ideal line by working day, not
-- calendar day. No such configuration existed: workspace_settings carried only
-- timezone, locale, date format and the preliminary-estimate map.
--
-- Confirmed against the approved mockup: its burndown x-axis runs 10-14…10-18,
-- 10-21…10-25, 10-28 — weekends absent. So Mon–Fri is the intended default, and it is
-- a DEFAULT rather than a constant on purpose. Hard-coding Mon–Fri in the report
-- service would make a Sun–Thu working week a code change, and would put the same
-- decision in a second place the day a holiday calendar arrives.
--
-- ISO day-of-week numbering (1 = Monday … 7 = Sunday), matching Postgres
-- `EXTRACT(ISODOW FROM date)` so the report query can filter without translating.
--
-- Holidays are deliberately NOT here. They are a separate list with their own
-- lifecycle, and the SRS scopes neither a settings screen nor holiday data for this
-- phase. `working_days` is enough to render the approved chart correctly.

ALTER TABLE "workspace"."workspace_settings"
  ADD COLUMN IF NOT EXISTS "working_days" smallint[] NOT NULL DEFAULT '{1,2,3,4,5}';--> statement-breakpoint

-- A workspace with no working days would make every Ideal line undefined and every
-- burndown empty, and an out-of-range value would silently drop a day.
ALTER TABLE "workspace"."workspace_settings"
  ADD CONSTRAINT "ck_workspace_working_days" CHECK (
    array_length("working_days", 1) BETWEEN 1 AND 7
    AND "working_days" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  );
