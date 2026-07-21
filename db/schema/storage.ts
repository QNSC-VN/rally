/**
 * storage schema — files
 *
 * A single, owner-agnostic record per uploaded object. Ownership is expressed by
 * per-context LINK tables (e.g. work.work_item_attachments) rather than by a
 * polymorphic owner_type/owner_id pair, so every reference stays a real foreign
 * key with real cascade semantics.
 *
 * Adding a new upload surface = one link table + one policy descriptor. It never
 * requires touching this table.
 */
import {
  pgSchema,
  uuid,
  varchar,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fileStatusEnum, fileVisibilityEnum } from './enums';

export const storageSchema = pgSchema('storage');

export const files = storageSchema.table(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),

    /** Object key within the bucket. Unique — one row per object, always. */
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),

    /** Original client filename. Display only — never used to build the key. */
    filename: varchar('filename', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    /**
     * Base64 SHA-256 supplied by the client at presign time and enforced by the
     * bucket at PUT time (x-amz-checksum-sha256), then re-read on confirm. This
     * is the integrity control — a size comparison alone cannot detect a
     * same-length substitution. Also the dedup key (scoped to workspace_id).
     */
    checksumSha256: varchar('checksum_sha256', { length: 64 }),

    visibility: fileVisibilityEnum('visibility').notNull().default('private'),
    status: fileStatusEnum('status').notNull().default('pending'),

    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index('ix_files_workspace').on(t.workspaceId),
    storageKeyUq: uniqueIndex('uq_files_storage_key').on(t.storageKey),

    /**
     * Drives the orphan reaper (presigned but never confirmed). Partial so it
     * stays tiny regardless of how many completed files exist.
     * NOTE: declared here AND in the migration — the previous incarnation of
     * this index existed only in SQL, so drizzle-kit generate kept trying to
     * drop it. Keep both in sync.
     */
    pendingCleanupIdx: index('ix_files_pending_cleanup')
      .on(t.createdAt)
      .where(sql`status = 'pending' AND deleted_at IS NULL`),

    /** Dedup lookup — deliberately workspace-scoped so a checksum can never be
     *  used to reference another tenant's object. */
    checksumIdx: index('ix_files_workspace_checksum')
      .on(t.workspaceId, t.checksumSha256)
      .where(sql`status = 'completed' AND deleted_at IS NULL`),
  }),
);
