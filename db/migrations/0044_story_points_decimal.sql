-- 0044: Make story points fractional (Plan Estimate, SRS §8) and align the
-- iteration burndown read model to numeric so fractional points are not truncated.
--
-- work_items.story_points: integer → numeric(6,2). Widening cast is lossless
-- (existing integer values become N.00).
--
-- iteration_daily_snapshots.{total,completed,remaining}_points: integer →
-- numeric(8,2), matching release_daily_snapshots (which was already numeric).
-- This removes a real drift between the two burndown read models.

ALTER TABLE "work"."work_items"
  ALTER COLUMN "story_points" TYPE numeric(6, 2) USING "story_points"::numeric;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "total_points" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots"
  ALTER COLUMN "total_points" TYPE numeric(8, 2) USING "total_points"::numeric;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "total_points" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "completed_points" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots"
  ALTER COLUMN "completed_points" TYPE numeric(8, 2) USING "completed_points"::numeric;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "completed_points" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "remaining_points" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots"
  ALTER COLUMN "remaining_points" TYPE numeric(8, 2) USING "remaining_points"::numeric;
--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots" ALTER COLUMN "remaining_points" SET DEFAULT '0';
