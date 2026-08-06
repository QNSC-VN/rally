-- Recover outbox events that were dead-lettered against the DELETED SNS topic.
--
-- No schema change: a data repair, and the second half of 0102's recovery. 0102 reset rows
-- that were `published` but never audited; this one handles rows that reached `failed`.
--
-- Why they exist at all — the ordering, measured on develop:
--
--   1. `Infrastructure · Apply` destroyed the SNS topic.
--   2. The OLD worker was still running, still publishing to it. Every publish failed, the
--      resilience breaker for `sns.publishOutboxEvent` opened, and each row burned all five
--      attempts within seconds: `last_error = 'Execution prevented because the circuit
--      breaker is open'`, `status = 'failed'`.
--   3. `Backend · Deploy` then rolled the new worker.
--
-- Six develop rows were stranded that way. `failed` is excluded from the relay's fetch, so
-- they would have stayed stranded silently — the projection looked healthy because there
-- was nothing pending left to project.
--
-- This window is inherent to the sequence the repo documents: infra applies first, and the
-- deploy is gated behind it (`wait-for-infra`). For a change that REMOVES a dependency the
-- running code still uses, that order is backwards — the safe sequence is deploy the code
-- that no longer needs it, then remove it. See the note in CLAUDE.md; that ordering rule is
-- the durable fix, and this migration is the cleanup for the one time it bit us.
--
-- Prod has not applied yet, so its worker will pass through the same window. This runs in
-- the migrator ahead of the service roll, which is too early to catch prod's own casualties
-- — but it is idempotent and harmless, and 0102 plus this pair mean the ONLY manual step
-- left for prod is re-running it if any row lands in `failed` with this error. Query:
--   SELECT id, event_type, attempts, last_error FROM messaging.outbox_events
--    WHERE status = 'failed';
--
-- The `last_error` predicate is what makes this safe. The new relay never calls
-- `resilience.execute`, so a breaker message cannot describe a projection failure: this
-- cannot revive a row that failed for a real, current reason. The NOT EXISTS keeps it
-- idempotent alongside `uq_audit_source_event_id`.
UPDATE messaging.outbox_events o
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    published_at = NULL
WHERE o.status = 'failed'
  AND o.last_error LIKE '%circuit breaker is open%'
  AND NOT EXISTS (
    SELECT 1
    FROM audit.audit_logs a
    WHERE a.source_event_id = o.id
  );
