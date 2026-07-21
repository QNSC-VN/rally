-- 0053: Generalize attachments — split work.attachments into storage.files
--       (owner-agnostic blob metadata) + work.work_item_attachments (link).
--
-- WHY: work.attachments carried both the blob metadata and `work_item_id NOT
-- NULL`, so every additional upload surface (avatars, workspace logos, comment
-- attachments, inline description images) would have needed either a duplicate
-- table or a nullable-column discriminator. Splitting means a new surface is
-- one link table + one policy descriptor, and never a change to the blob table.
--
-- A polymorphic owner_type/owner_id pair was deliberately rejected: it cannot
-- carry a foreign key, and it pushes tenant scoping into application-level
-- registry lookups. Link tables keep real FKs and real ON DELETE CASCADE.
--
-- Also fixes, in the same move:
--   * storage_key had no unique constraint (two rows could claim one object)
--   * no checksum column — integrity was a size comparison only, which cannot
--     detect a same-length substitution
--   * ix_attach_pending_cleanup existed only in SQL, never in the Drizzle
--     schema, so `drizzle-kit generate` kept emitting a DROP for it
--   * no FKs at all: deleting a work item orphaned both rows and objects

CREATE SCHEMA IF NOT EXISTS "storage";
--> statement-breakpoint

CREATE TYPE "public"."file_status" AS ENUM ('pending', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."file_visibility" AS ENUM ('private', 'public');
--> statement-breakpoint

CREATE TABLE "storage"."files" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"    uuid NOT NULL,
  "storage_key"     varchar(1024) NOT NULL,
  "filename"        varchar(500) NOT NULL,
  "mime_type"       varchar(255) NOT NULL,
  "size_bytes"      bigint NOT NULL,
  "checksum_sha256" varchar(64),
  "visibility"      "public"."file_visibility" DEFAULT 'private' NOT NULL,
  "status"          "public"."file_status" DEFAULT 'pending' NOT NULL,
  "uploaded_by"     uuid NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at"    timestamp with time zone,
  "deleted_at"      timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX "ix_files_workspace" ON "storage"."files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_files_storage_key" ON "storage"."files" USING btree ("storage_key");
--> statement-breakpoint
-- Partial: stays small no matter how many completed files accumulate.
CREATE INDEX "ix_files_pending_cleanup" ON "storage"."files" USING btree ("created_at")
  WHERE status = 'pending' AND deleted_at IS NULL;
--> statement-breakpoint
-- Workspace-scoped so a checksum can never reference another tenant's object.
CREATE INDEX "ix_files_workspace_checksum" ON "storage"."files" USING btree ("workspace_id", "checksum_sha256")
  WHERE status = 'completed' AND deleted_at IS NULL;
--> statement-breakpoint

CREATE TABLE "work"."work_item_attachments" (
  "work_item_id" uuid NOT NULL,
  "file_id"      uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "attached_by"  uuid NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "work_item_attachments_pkey" PRIMARY KEY ("work_item_id", "file_id")
);
--> statement-breakpoint

ALTER TABLE "work"."work_item_attachments"
  ADD CONSTRAINT "fk_wia_work_item" FOREIGN KEY ("work_item_id")
  REFERENCES "work"."work_items"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work"."work_item_attachments"
  ADD CONSTRAINT "fk_wia_file" FOREIGN KEY ("file_id")
  REFERENCES "storage"."files"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX "ix_wia_work_item" ON "work"."work_item_attachments" USING btree ("work_item_id");
--> statement-breakpoint
-- Drives the reaper's "is this file still referenced by anything?" check.
CREATE INDEX "ix_wia_file" ON "work"."work_item_attachments" USING btree ("file_id");
--> statement-breakpoint
CREATE INDEX "ix_wia_workspace" ON "work"."work_item_attachments" USING btree ("workspace_id");
--> statement-breakpoint

-- ── Backfill ──────────────────────────────────────────────────────────────
-- Only 'completed' rows carry meaning. 'pending' rows are abandoned presigns
-- whose objects may not exist; the reaper would have deleted them within 24h
-- anyway, so they are dropped rather than migrated.
--
-- Deduplicated on storage_key to satisfy uq_files_storage_key: the old table
-- had no unique constraint, so duplicates are possible in principle. Keeps the
-- earliest row per key.
INSERT INTO "storage"."files" (
  "id", "workspace_id", "storage_key", "filename", "mime_type", "size_bytes",
  "visibility", "status", "uploaded_by", "created_at", "confirmed_at", "deleted_at"
)
SELECT DISTINCT ON ("storage_key")
  "id", "workspace_id", "storage_key", "filename", "mime_type", "size_bytes",
  'private', 'completed', "uploaded_by", "created_at", "created_at", "deleted_at"
FROM "work"."attachments"
WHERE "status" = 'completed'
ORDER BY "storage_key", "created_at" ASC;
--> statement-breakpoint

-- Link rows only for attachments whose file row actually landed above, and whose
-- work item still exists (the old table had no FK, so danglers are possible).
INSERT INTO "work"."work_item_attachments" (
  "work_item_id", "file_id", "workspace_id", "attached_by", "created_at"
)
SELECT a."work_item_id", f."id", a."workspace_id", a."uploaded_by", a."created_at"
FROM "work"."attachments" a
JOIN "storage"."files" f ON f."id" = a."id"
JOIN "work"."work_items" wi ON wi."id" = a."work_item_id"
WHERE a."status" = 'completed'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- expand-contract-ok: deploy runs migrate-before-flip, so the OLD app is briefly
-- live against this schema and its attachment endpoints will 500 until the new
-- task set rolls out. Accepted deliberately: prod has not launched (no users),
-- develop has no attachment data worth protecting, and the blast radius is five
-- endpoints for the length of one ECS rollout. Everything else keeps working.
-- If this ever needs to be zero-downtime, split it: ship the new tables +
-- dual-write first, flip the app, then drop this table in a later migration.
DROP TABLE "work"."attachments"; -- expand-contract-ok: pre-launch, see note above
--> statement-breakpoint

-- attachment_status is now unused (file_status replaces it). activity_entity_type
-- keeps its 'attachment' value — activity log rows still describe attachments.
DROP TYPE IF EXISTS "public"."attachment_status";
--> statement-breakpoint

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Mirrors the policy every other workspace-scoped table carries (0005).
-- NOTE: as of this migration the application does NOT set app.workspace_id and
-- connects as the table owner, so these policies are inert defence-in-depth —
-- isolation is enforced in the repository layer. Tracked separately; the policy
-- is added here so this table is not the one that gets missed when that is fixed.
ALTER TABLE "storage"."files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "storage"."files"
  AS PERMISSIVE FOR ALL
  USING  (workspace_id = NULLIF(current_setting('app.workspace_id', TRUE), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', TRUE), '')::uuid);
--> statement-breakpoint
ALTER TABLE "work"."work_item_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work"."work_item_attachments"
  AS PERMISSIVE FOR ALL
  USING  (workspace_id = NULLIF(current_setting('app.workspace_id', TRUE), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', TRUE), '')::uuid);
