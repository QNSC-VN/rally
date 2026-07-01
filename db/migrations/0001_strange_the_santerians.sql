ALTER TABLE "notifications"."in_app_notifications" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "audit"."audit_logs" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ian_source_event_id" ON "notifications"."in_app_notifications" USING btree ("source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_audit_source_event_id" ON "audit"."audit_logs" USING btree ("source_event_id");