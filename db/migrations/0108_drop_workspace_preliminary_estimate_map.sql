-- Drops the workspace-level preliminary_estimate_map column. The per-project estimate
-- scale (work.project_settings, SRS §6.2) replaced it: migration 0106 added the
-- per-project table, 0107 backfilled its rows from this column, and the Stage 5a code
-- change removed the last reader/writer, so the column is now unused.
--
-- Ordering matters: this ships AFTER the Stage 5a code rolls, so no still-rolling replica
-- that reads the column meets a missing-column error (expand/contract — code first,
-- column second). Historical migrations 0071 / 0101 / 0107 referenced this column and are
-- unchanged; they run before 0108 on a fresh database, so the column exists when they
-- need it and is dropped only here.

ALTER TABLE "workspace"."workspace_settings"
  DROP COLUMN IF EXISTS "preliminary_estimate_map";
