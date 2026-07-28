import type { WorkItemAttachment } from '../attachment.types';

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');

/**
 * Owns the work_items ←→ storage.files LINK table only. Blob metadata lives in
 * storage.files and is reached through AttachmentsService — this repository
 * never writes it.
 *
 * Every method is workspace-scoped, and these predicates are the only isolation
 * that executes — by design. Rally is single-tenant, so DB-level isolation is an
 * explicit non-goal and migration 0070 dropped the last `tenant_isolation` RLS
 * policies. This comment used to call RLS "currently inert", which invited someone
 * to switch it on; doing so denied every attachment write, because the policies
 * required an `app.workspace_id` setting nothing ever sets.
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
