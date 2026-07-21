import type { WorkItemAttachment } from '../attachment.types';

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');

/**
 * Owns the work_items ←→ storage.files LINK table only. Blob metadata lives in
 * storage.files and is reached through AttachmentsService — this repository
 * never writes it.
 *
 * Every method is workspace-scoped. RLS is currently inert (the app connects as
 * the table owner and never sets app.workspace_id), so these predicates are the
 * only isolation that actually executes.
 */
export interface IAttachmentRepository {
  /** Joined view of the link + its file, for list/detail responses. */
  listByWorkItem(workItemId: string, workspaceId: string): Promise<WorkItemAttachment[]>;

  /** Completed attachments only — pending presigns must not consume quota. */
  countByWorkItem(workItemId: string, workspaceId: string): Promise<number>;

  /** Single attachment, scoped to both the work item and the workspace. */
  findByWorkItemAndFile(
    workItemId: string,
    fileId: string,
    workspaceId: string,
  ): Promise<WorkItemAttachment | null>;

  link(input: {
    workItemId: string;
    fileId: string;
    workspaceId: string;
    attachedBy: string;
  }): Promise<void>;

  unlink(workItemId: string, fileId: string, workspaceId: string): Promise<void>;
}
