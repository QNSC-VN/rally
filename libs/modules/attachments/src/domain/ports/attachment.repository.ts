import type { AttachmentRef, EntityAttachment } from '../attachment.types';

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');

/**
 * Owns the entity ←→ storage.files LINK table only. Blob metadata lives in
 * storage.files and is reached through AttachmentsService — this repository
 * never writes it.
 *
 * Keyed by `(entity_type, entity_id)` since migration 0081, so one link table serves work
 * items and portfolio items. Every method takes the `AttachmentRef` pair rather than a bare
 * id, because an id alone no longer identifies a subject.
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
  listByEntity(ref: AttachmentRef, workspaceId: string): Promise<EntityAttachment[]>;

  /** Completed attachments only — pending presigns must not consume quota. */
  countByEntity(ref: AttachmentRef, workspaceId: string): Promise<number>;

  /** Single attachment, scoped to both the owning entity and the workspace. */
  findByEntityAndFile(
    ref: AttachmentRef,
    fileId: string,
    workspaceId: string,
  ): Promise<EntityAttachment | null>;

  link(input: {
    entityType: AttachmentRef['entityType'];
    entityId: string;
    fileId: string;
    workspaceId: string;
    attachedBy: string;
  }): Promise<void>;

  unlink(ref: AttachmentRef, fileId: string, workspaceId: string): Promise<void>;
}
