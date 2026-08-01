-- Portfolio items get a Revision History.
--
-- `activity_logs` is ALREADY polymorphic on `(entity_type, entity_id)` — the schema
-- comment on that table spells out why — so a new subject needs nothing but a new enum
-- member. No column, no backfill, no query change: this is the cheapest of the five
-- sections the Portfolio detail page was missing, and the only one whose backing table was
-- designed for it from the start.
--
-- `ALTER TYPE … ADD VALUE` cannot run inside a transaction block in older PostgreSQL and
-- is non-transactional even where permitted, so it stands alone in this file. It is
-- idempotent via IF NOT EXISTS.

ALTER TYPE "activity_entity_type" ADD VALUE IF NOT EXISTS 'portfolio_item';
