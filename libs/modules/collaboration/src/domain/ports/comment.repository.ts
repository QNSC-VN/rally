import type { Comment, CreateCommentInput } from '../collaboration.types';

export const COMMENT_REPOSITORY = Symbol('COMMENT_REPOSITORY');

export interface ICommentRepository {
  findById(id: string): Promise<Comment | null>;
  listByWorkItem(workItemId: string, tenantId: string): Promise<Comment[]>;
  create(input: CreateCommentInput): Promise<Comment>;
  update(id: string, body: string): Promise<Comment>;
  softDelete(id: string): Promise<void>;
}
