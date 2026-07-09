import type { Attachment, CreateAttachmentInput } from '../attachment.types';

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');

export interface IAttachmentRepository {
  findById(id: string, workspaceId: string): Promise<Attachment | null>;

  listByWorkItem(workItemId: string, workspaceId: string): Promise<Attachment[]>;

  countByWorkItem(workItemId: string, workspaceId: string): Promise<number>;

  create(input: CreateAttachmentInput): Promise<Attachment>;

  /** Mark status = 'completed' after successful S3 upload. */
  confirm(id: string): Promise<Attachment>;

  /** Soft-delete. Returns the updated row. */
  softDelete(id: string): Promise<Attachment>;
}
