-- Projects gain a planned finish date (SRS §7.1/§9). Nullable; the service
-- enforces end_date >= start_date when both are set.
ALTER TABLE "work"."projects" ADD COLUMN IF NOT EXISTS "end_date" date;
