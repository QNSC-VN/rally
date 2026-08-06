-- Re-project outbox events that were "published" but never landed in audit_logs.
--
-- No schema change: this is a data repair. Until this migration, the relay published
-- each event to SNS and marked the row `published`, and SNS accepted every publish —
-- but the audit queue had no subscription and the one subscription that existed
-- filtered on event types this codebase never emits. Measured on develop over 14
-- days: 12 published, 12 FilteredOut, 0 delivered, 0 failed. SQS reported
-- NumberOfMessagesSent = 0 on the audit queue, and AuditConsumer was the only writer
-- of audit.audit_logs, so every one of those events produced no audit row.
--
-- The events themselves were never lost: cleanup.cron.ts purges sessions,
-- invitations, files and the SCM inbox, and deliberately never touches
-- outbox_events. So the rows are still here and the audit trail can be rebuilt from
-- them, which is the whole reason a transactional outbox is worth having.
--
-- Setting status back to 'pending' hands them to AuditProjectionRelay on its next
-- 5s tick. Reprojection is safe to run more than once: audit_logs.source_event_id
-- carries uq_audit_source_event_id and the repository inserts with
-- ON CONFLICT DO NOTHING, so an event that somehow already has its row is skipped
-- rather than duplicated. The NOT EXISTS below makes that the normal path instead of
-- the fallback.
--
-- attempts and last_error are cleared because they counted failures of a DIFFERENT
-- operation — publishing to SNS. Carrying that count into the projection would give
-- an event a shortened retry budget for work it has never attempted.
--
-- Deliberately NOT touching status = 'failed'. Those rows exhausted their retries
-- against SNS and may be genuinely malformed; reviving them silently would hide that.
-- Both deployed environments currently have none. Query them by hand if any appear:
--   SELECT id, event_type, attempts, last_error FROM messaging.outbox_events
--    WHERE status = 'failed';
UPDATE messaging.outbox_events o
SET status = 'pending',
    published_at = NULL,
    attempts = 0,
    last_error = NULL
WHERE o.status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM audit.audit_logs a
    WHERE a.source_event_id = o.id
  );
