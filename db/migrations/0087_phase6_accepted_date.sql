-- ============================================================================
-- Migration 0087: work_items.accepted_date — the timestamp Velocity is built on
-- ============================================================================
-- Phase 6 Reports needs to know WHEN an item reached Accepted, not merely that it
-- is accepted now. Velocity splits every point into Accepted During / Accepted
-- After / Not Accepted by comparing that timestamp against the iteration's end
-- boundary, and the Burndown's Accepted Points series is cumulative by it. The
-- schedule_state column alone cannot answer either question.
--
-- Contract (Phase 6 Velocity SRS §8):
--   • set when the item ENTERS accepted;
--   • RETAINED when it moves onward to release (release is post-acceptance);
--   • CLEARED when the item is reopened to any non-accepted state;
--   • set again on a later re-acceptance.
-- activity_logs keeps every transition regardless — this column is only ever the
-- CURRENT outcome.
--
-- WHY A TRIGGER AND NOT ONLY THE SERVICE
--
-- `db/seeds/**` and any raw SQL write work_items without going through
-- WorkItemDrizzleRepository, exactly like the portfolio_items CHECK constraints in
-- 0071 exist because seeds bypass the portfolio service. An Accepted row with a
-- NULL accepted_date is a data-quality error the Velocity report must refuse to
-- guess about, so the floor belongs in the database. The service still writes the
-- value in the same UPDATE so activity_logs records the transition — the trigger is
-- the backstop, not the historian.
--
-- The trigger deliberately NEVER invents a date for a row that was already accepted
-- before this migration. It stamps now() only on the transition INTO acceptance, so
-- legacy rows that the backfill below could not resolve stay NULL and surface as the
-- data-quality gap the SRS asks DEV to report rather than fabricate.

ALTER TABLE "work"."work_items" ADD COLUMN IF NOT EXISTS "accepted_date" timestamptz;--> statement-breakpoint

-- Velocity groups by iteration and filters on the timestamp; Burndown filters it by
-- date. Partial: only Story/Defect rows are ever classified, and the column is NULL
-- for everything that has not been accepted.
CREATE INDEX IF NOT EXISTS "ix_wi_accepted_date"
  ON "work"."work_items" ("iteration_id", "accepted_date")
  WHERE "type" IN ('story', 'defect') AND "deleted_at" IS NULL;--> statement-breakpoint

-- ── Backfill from the audit trail ───────────────────────────────────────────
--
-- The only auditable source is activity_logs, whose `changes` jsonb is a single
-- { field, old, new } object (see ActivityChange) and whose action for this field is
-- 'work_item.schedule_state_changed'.
--
-- "The acceptance that is still standing" = the EARLIEST transition into 'accepted'
-- that happens after the LAST transition out of the accepted family. Taking the
-- latest accepted-ish transition instead would return the accepted→release move and
-- report the release date as the acceptance date.
--
-- Runs BEFORE the trigger is created so the backfilled value cannot be second-guessed.
WITH reopened AS (
  SELECT entity_id, MAX(created_at) AS at
    FROM "work"."activity_logs"
   WHERE entity_type = 'work_item'
     AND action = 'work_item.schedule_state_changed'
     AND changes->>'new' NOT IN ('accepted', 'release')
   GROUP BY entity_id
),
accepted AS (
  SELECT DISTINCT ON (l.entity_id) l.entity_id, l.created_at AS at
    FROM "work"."activity_logs" l
    LEFT JOIN reopened r ON r.entity_id = l.entity_id
   WHERE l.entity_type = 'work_item'
     AND l.action = 'work_item.schedule_state_changed'
     AND l.changes->>'new' = 'accepted'
     AND (r.at IS NULL OR l.created_at > r.at)
   ORDER BY l.entity_id, l.created_at ASC
)
UPDATE "work"."work_items" w
   SET accepted_date = a.at
  FROM accepted a
 WHERE w.id = a.entity_id
   AND w.schedule_state IN ('accepted', 'release')
   AND w.accepted_date IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "work".sync_accepted_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.schedule_state IN ('accepted', 'release') THEN
    -- Entering the accepted family (or created into it): stamp, unless the caller
    -- supplied a deliberate value (backfill, migration, audited correction).
    IF TG_OP = 'INSERT' OR OLD.schedule_state NOT IN ('accepted', 'release') THEN
      NEW.accepted_date := COALESCE(NEW.accepted_date, now());
    END IF;
    -- Already accepted and staying so (accepted → release included): do nothing.
    -- In a BEFORE trigger NEW already carries the existing value for any column the
    -- UPDATE did not set, so "retained" needs no assignment — and a statement that
    -- DOES set it is an explicit correction we must not overwrite.
  ELSE
    -- Reopened to any non-accepted state: there is no current acceptance.
    NEW.accepted_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_sync_accepted_date" ON "work"."work_items";--> statement-breakpoint

CREATE TRIGGER "trg_sync_accepted_date"
  BEFORE INSERT OR UPDATE ON "work"."work_items"
  FOR EACH ROW EXECUTE FUNCTION "work".sync_accepted_date();
