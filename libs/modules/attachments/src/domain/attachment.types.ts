/**
 * What an attachment hangs off (migration 0083). The same `entity_ref_type` vocabulary
 * `comments` uses — one list of things that can own child records, not one per table.
 */
export type AttachmentEntityType = 'work_item' | 'portfolio_item';

export interface AttachmentRef {
  entityType: AttachmentEntityType;
  entityId: string;
}

/**
 * An attachment as callers see it: the link row flattened together with its storage.files
 * row. `id` is the FILE id — it is what every route takes and returns, so the two-table
 * split is invisible from outside the module.
 */
export interface EntityAttachment extends AttachmentRef {
  id: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}
