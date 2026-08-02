-- A Milestone's target window is DERIVED from its linked Releases, and stays derived.
--
-- ── the rule ────────────────────────────────────────────────────────────────
-- The BA states it as an EQUALITY, not as a recalculation step:
--   "When one or more Releases are linked, Target Start Date is derived from the earliest Start Date
--    among linked Releases" / "Target End Date ... the latest Release Date"  (P3-MS-FR-011/012)
--   "Target Start Date EQUALS the earliest `startDate` among linked Releases and Target End Date
--    EQUALS the latest `releaseDate`"                                        (Milestones SRS §73)
-- and the no-link case is equally explicit:
--   "When all Release links are removed, Target Start Date and Target End Date become manually
--    editable again; THE SYSTEM DOES NOT INFER A REPLACEMENT DATE."          (§75)
--
-- ── what was wrong ──────────────────────────────────────────────────────────
-- `MilestonesService.recalcTargetDates` was called from create, from update, from the link writes —
-- and from `getMilestone`, a repair on the READ path. It was never called when a linked Release's own
-- dates were edited (`ReleasesService.updateRelease` writes `start_date`/`release_date` and returns),
-- and `listMilestones` reads the persisted columns without recalculating.
--
-- So after moving a Release: opening the Milestone detail self-healed, while the Milestones LIST kept
-- showing the old window. The self-healing is also why nobody noticed — the surface a reviewer checks
-- is the one that repairs itself. The BA recorded this as DEV-006 fixed; it was half fixed.
--
-- ── why a trigger ───────────────────────────────────────────────────────────
-- Three writers can invalidate the window — a release date edit, a link add/remove, and a manual write
-- to a milestone that is linked (which §73 makes read-only) — and the service only covered some of
-- them, from some call sites. An equality that several writers must maintain is what a trigger is for,
-- the same reasoning as `trg_sync_accepted_date` and `timebox_group_id`: `db/seeds/**` writes both
-- tables directly, so a service-only rule is one the fixtures walk around.

-- ── the derivation, in one place ─────────────────────────────────────────────
-- Returns NULL for both bounds when the milestone has no linked release, which the callers below read
-- as "leave the manual dates alone" (§75).
CREATE OR REPLACE FUNCTION "work"."milestone_derived_window"(m_id uuid)
RETURNS TABLE (start_date date, end_date date, link_count bigint) AS $$
  SELECT MIN(r."start_date"), MAX(r."release_date"), COUNT(r."id")
    FROM "work"."milestone_releases" mr
    JOIN "work"."releases" r ON r."id" = mr."release_id"
   WHERE mr."milestone_id" = m_id;
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- ── 1. A milestone's own row can never hold a stale or hand-edited window ────
-- BEFORE INSERT OR UPDATE: while at least one Release is linked, the columns are forced to the derived
-- values, so a manual write to a linked milestone cannot take (§73 makes them read-only) and any
-- recomputation below lands the same answer. With no link the row passes through untouched.
CREATE OR REPLACE FUNCTION "work"."milestone_force_derived_dates"()
RETURNS trigger AS $$
DECLARE w record;
BEGIN
  SELECT * INTO w FROM "work"."milestone_derived_window"(NEW."id");
  IF w.link_count > 0 THEN
    NEW."target_start_date" := w.start_date;
    NEW."target_end_date" := w.end_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_milestone_force_derived_dates" ON "work"."milestones";--> statement-breakpoint

CREATE TRIGGER "trg_milestone_force_derived_dates"
  BEFORE INSERT OR UPDATE OF "target_start_date", "target_end_date" ON "work"."milestones"
  FOR EACH ROW EXECUTE FUNCTION "work"."milestone_force_derived_dates"();--> statement-breakpoint

-- ── 2. Recompute every milestone affected by a link change ───────────────────
CREATE OR REPLACE FUNCTION "work"."milestone_relink_recalc"()
RETURNS trigger AS $$
DECLARE m_id uuid := COALESCE(NEW."milestone_id", OLD."milestone_id");
        w record;
BEGIN
  SELECT * INTO w FROM "work"."milestone_derived_window"(m_id);
  -- Removing the LAST link leaves the dates as they were: §75 forbids inferring a replacement, and
  -- clearing them would be inventing NULL.
  IF w.link_count > 0 THEN
    UPDATE "work"."milestones"
       SET "target_start_date" = w.start_date,
           "target_end_date" = w.end_date,
           "updated_at" = now()
     WHERE "id" = m_id
       AND ("target_start_date" IS DISTINCT FROM w.start_date
            OR "target_end_date" IS DISTINCT FROM w.end_date);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_milestone_relink_recalc" ON "work"."milestone_releases";--> statement-breakpoint

CREATE TRIGGER "trg_milestone_relink_recalc"
  AFTER INSERT OR DELETE ON "work"."milestone_releases"
  FOR EACH ROW EXECUTE FUNCTION "work"."milestone_relink_recalc"();--> statement-breakpoint

-- ── 3. Moving a Release moves every Milestone that spans it ──────────────────
-- The write that had no path to the milestones at all. `WHEN` on the two date columns so an unrelated
-- release edit — a rename, a state change — touches no milestone row.
CREATE OR REPLACE FUNCTION "work"."release_dates_recalc_milestones"()
RETURNS trigger AS $$
BEGIN
  UPDATE "work"."milestones" m
     SET "target_start_date" = w.start_date,
         "target_end_date" = w.end_date,
         "updated_at" = now()
    FROM "work"."milestone_releases" mr
   CROSS JOIN LATERAL "work"."milestone_derived_window"(mr."milestone_id") w
   WHERE mr."release_id" = NEW."id"
     AND m."id" = mr."milestone_id"
     AND w.link_count > 0
     AND (m."target_start_date" IS DISTINCT FROM w.start_date
          OR m."target_end_date" IS DISTINCT FROM w.end_date);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_release_dates_recalc_milestones" ON "work"."releases";--> statement-breakpoint

CREATE TRIGGER "trg_release_dates_recalc_milestones"
  AFTER UPDATE OF "start_date", "release_date" ON "work"."releases"
  FOR EACH ROW
  WHEN (OLD."start_date" IS DISTINCT FROM NEW."start_date"
        OR OLD."release_date" IS DISTINCT FROM NEW."release_date")
  EXECUTE FUNCTION "work"."release_dates_recalc_milestones"();--> statement-breakpoint

-- ── 4. Realign what is already stale ────────────────────────────────────────
-- Local rows happen to be in sync, but any database that has had a release date edited since Phase 3
-- carries a stale window on the list view.
UPDATE "work"."milestones" m
   SET "target_start_date" = w.start_date,
       "target_end_date" = w.end_date
  FROM (SELECT mr."milestone_id",
               MIN(r."start_date") AS start_date,
               MAX(r."release_date") AS end_date
          FROM "work"."milestone_releases" mr
          JOIN "work"."releases" r ON r."id" = mr."release_id"
         GROUP BY mr."milestone_id") w
 WHERE m."id" = w."milestone_id"
   AND (m."target_start_date" IS DISTINCT FROM w.start_date
        OR m."target_end_date" IS DISTINCT FROM w.end_date);
