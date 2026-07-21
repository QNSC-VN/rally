/**
 * A work-item attachment as callers see it: the link row flattened together
 * with its storage.files row. `id` is the FILE id — it is what every route takes
 * and returns, so the two-table split is invisible from outside the module.
 */
export interface WorkItemAttachment {
  id: string;
  workItemId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}
