import type { Attachment, CreateAttachmentInput } from '../collaboration.types';

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');

export interface IAttachmentRepository {
  findById(id: string): Promise<Attachment | null>;
  listByWorkItem(workItemId: string, tenantId: string): Promise<Attachment[]>;
  create(input: CreateAttachmentInput): Promise<Attachment>;
  softDelete(id: string): Promise<void>;
}
