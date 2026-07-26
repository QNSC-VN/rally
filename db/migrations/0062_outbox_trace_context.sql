-- Carry W3C trace context across the outbox boundary.
--
-- Without it, a trace ends when a request commits its events and a NEW, unrelated
-- trace starts when the worker relays them — so "why did this notification take
-- four minutes" cannot be answered from one trace. The relay reads this column and
-- continues the producing request's trace instead of starting a root span.
--
-- Nullable on purpose: rows written before this column existed (and any writer that
-- has no active span, e.g. a cron-initiated event) simply have no parent, and the
-- relay starts a root span for them as it does today. No backfill needed.
--
-- Expand-only: adds a nullable column, so the old app keeps working against the new
-- schema during migrate-before-flip.
ALTER TABLE "messaging"."outbox_events"
  ADD COLUMN IF NOT EXISTS "traceparent" varchar(64);

COMMENT ON COLUMN "messaging"."outbox_events"."traceparent" IS
  'W3C traceparent of the request that enqueued this event; NULL when there was no active span.';
